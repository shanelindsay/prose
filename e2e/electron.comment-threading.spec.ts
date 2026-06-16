/**
 * Comment threading (#699) — replies, real resolved state, AI participation.
 *
 * Tests:
 * 1. reply_to_comment tool appends an AI reply to the persisted thread.
 * 2. resolve_comment sets resolved:true in the store instead of deleting the record.
 * 3. Resolved threads are not re-marked on restore (restoreComments skips resolved).
 * 4. list_comments returns replies + resolved state.
 *
 * Uses an isolated PROSE_USER_DATA_DIR profile; runs against the out/ build.
 * No LLM calls — all tools invoked via window.__prose_tools.executeTool.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

test.beforeAll(async () => {
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-699-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-699-docs-'))

  const result = await launchApp({
    env: {
      PROSE_USER_DATA_DIR: qaUserDataDir,
      PROSE_DOCS_DIR: qaDocsDir,
    },
  })
  app = result.app
  page = result.page

  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app.close().catch(() => {})
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the current pendingComments from the comment store. */
async function getCommentStore(testPage: Page): Promise<Array<Record<string, unknown>>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return testPage.evaluate(() => (window as any).__prose_tools.getCommentStore())
}

/**
 * Find any non-empty paragraph node and add a comment to it.
 * Returns the new comment ID.
 */
async function addComment(testPage: Page, commentText: string): Promise<string> {
  const read = await executeProseTool(testPage, 'read_document', {})
  expect(read.success, 'read_document').toBe(true)
  interface DocNode { id: string; content?: string; children?: DocNode[] }
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  const node = flatten((read.data as { nodes: DocNode[] }).nodes).find(
    (n) => n.content && n.content.trim().length > 5,
  )
  expect(node, 'find non-empty node').toBeTruthy()

  const result = await executeProseTool(testPage, 'add_comment', {
    nodeId: node!.id,
    comment: commentText,
  })
  expect(result.success, `add_comment: ${JSON.stringify(result)}`).toBe(true)
  return (result.data as { id: string }).id
}

/** Count live comment marks visible in the editor DOM. */
async function countCommentMarks(testPage: Page): Promise<number> {
  return testPage.evaluate(() => document.querySelectorAll('.comment-mark').length)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('reply_to_comment appends AI reply to thread', async () => {
  await page.click('.ProseMirror')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('The quick brown fox jumps over the lazy dog.')

  const commentId = await addComment(page, 'Check the rhythm of this sentence.')

  const replyResult = await executeProseTool(page, 'reply_to_comment', {
    id: commentId,
    text: 'The rhythm is fine — the stress pattern scans well.',
  })
  expect(replyResult.success, `reply_to_comment: ${JSON.stringify(replyResult)}`).toBe(true)
  const replyId = (replyResult.data as { replyId: string }).replyId
  expect(typeof replyId).toBe('string')
  expect(replyId.length).toBeGreaterThan(0)

  // Verify the reply landed in the comment store
  const comments = await getCommentStore(page)
  const thread = comments.find((c) => c.id === commentId)
  expect(thread, 'thread in store').toBeTruthy()
  const replies = thread!.replies as Array<{ id: string; author: string; text: string }>
  expect(replies).toHaveLength(1)
  expect(replies[0].author).toBe('ai')
  expect(replies[0].text).toContain('rhythm is fine')
  expect(replies[0].id).toBe(replyId)
})

test('resolve_comment sets resolved:true and removes mark', async () => {
  await page.click('.ProseMirror')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('A sentence to comment on for resolve testing.')

  const commentId = await addComment(page, 'Resolve this thread.')

  // Mark should be present before resolve
  const marksBefore = await countCommentMarks(page)
  expect(marksBefore).toBeGreaterThan(0)

  const resolveResult = await executeProseTool(page, 'resolve_comment', {
    id: commentId,
  })
  expect(resolveResult.success, `resolve_comment: ${JSON.stringify(resolveResult)}`).toBe(true)

  // Mark should be gone from the editor
  const marksAfter = await countCommentMarks(page)
  expect(marksAfter).toBe(0)

  // Thread must persist in the store with resolved:true
  const comments = await getCommentStore(page)
  const thread = comments.find((c) => c.id === commentId)
  expect(thread, 'thread persists after resolve').toBeTruthy()
  expect(thread!.resolved).toBe(true)
})

test('list_comments includes replies and resolved state', async () => {
  await page.click('.ProseMirror')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Content for list_comments threading test.')

  const commentId = await addComment(page, 'List comments should show replies.')

  await executeProseTool(page, 'reply_to_comment', {
    id: commentId,
    text: 'Acknowledged.',
  })

  const listResult = await executeProseTool(page, 'list_comments', {})
  expect(listResult.success).toBe(true)
  const listData = listResult.data as {
    comments: Array<{ id: string; replies: unknown[]; resolved: boolean }>
  }
  const entry = listData.comments.find((c) => c.id === commentId)
  expect(entry, 'comment in list').toBeTruthy()
  expect(entry!.replies).toHaveLength(1)
  expect(entry!.resolved).toBe(false)
})

test('resolved threads do not get re-marked on restoreComments', async () => {
  // Write a markdown file so we can reopen the tab to trigger restoreComments
  const mdPath = join(qaDocsDir, 'resolve-restore-test.md')
  writeFileSync(mdPath, '# Restore Test\n\nThis text will be commented.\n')

  const openResult = await executeProseTool(page, 'open_file', { path: mdPath })
  expect(openResult.success, 'open_file').toBe(true)
  await waitForEditor(page)

  const commentId = await addComment(page, 'Should not re-appear after resolve.')
  await executeProseTool(page, 'resolve_comment', { id: commentId })

  // Close and reopen the file to trigger comment restoration
  await page.keyboard.press('Control+w')
  await waitForEditor(page)
  const reopen = await executeProseTool(page, 'open_file', { path: mdPath })
  expect(reopen.success).toBe(true)
  await waitForEditor(page)

  // The resolved comment must not be re-marked
  const marksAfterReopen = await countCommentMarks(page)
  expect(marksAfterReopen).toBe(0)
})
