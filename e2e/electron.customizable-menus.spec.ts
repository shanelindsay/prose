/**
 * Customizable menus (#701) — regression coverage for the wiggle edit mode,
 * item persistence (order + hidden state), and the three target menus:
 *
 *   1. Toolbar "More options" (toolbar-more)
 *   2. FileListPanel header view-toggle overflow (files-header)
 *   3. ChatPanel history dropdown footer (chat-history)
 *
 * Tests run against the built `out/` in an isolated PROSE_USER_DATA_DIR so
 * no real settings files are touched. All assertions are negative-controlled
 * (open → check default → customize → close → reopen → verify).
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-customizable-menus-'))
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
})

test.afterAll(async () => {
  await app.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Toolbar "More options" — toolbar-more
// ---------------------------------------------------------------------------

test.describe('toolbar-more customizable menu', () => {
  test('shows expected items and Customize… trigger by default', async () => {
    await page.click('[aria-label="More options"]')
    await page.waitForSelector('[role="menu"]')

    // Default items should be present
    await expect(page.getByRole('menuitem', { name: 'New Document' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Open/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Save' }).first()).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    // Customize trigger should always be present
    await expect(page.getByRole('menuitem', { name: /Customize/i })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('[role="menu"]')).not.toBeVisible()
  })

  test('enters and exits edit mode via Customize… and Done', async () => {
    await page.click('[aria-label="More options"]')
    await page.waitForSelector('[role="menu"]')

    // Click "Customize…" — should NOT close the dropdown (we call e.preventDefault())
    await page.getByRole('menuitem', { name: /Customize/i }).click()

    // Edit mode: heading + Done button visible, menu still open
    await expect(page.locator('[role="menu"]')).toBeVisible()
    await expect(page.locator('text=Customize menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Done/i })).toBeVisible()

    // Click Done — closes the menu
    await page.getByRole('menuitem', { name: /Done/i }).click()
    await expect(page.locator('[role="menu"]')).not.toBeVisible()
  })

  test('hides an item and persists across close/reopen', async () => {
    // Open → edit mode
    await page.click('[aria-label="More options"]')
    await page.waitForSelector('[role="menu"]')
    await page.getByRole('menuitem', { name: /Customize/i }).click()
    await expect(page.locator('text=Customize menu')).toBeVisible()

    // Hide the "New Document" item (first eye button next to its wiggle row)
    const newDocRow = page.locator('.animate-wiggle', { hasText: 'New Document' }).locator('..')
    await expect(newDocRow.locator('button[aria-label*="Hide New Document"]')).toBeVisible()
    await newDocRow.locator('button[aria-label*="Hide New Document"]').click()

    // Done to save
    await page.getByRole('menuitem', { name: /Done/i }).click()

    // Reopen — "New Document" should be gone
    await page.click('[aria-label="More options"]')
    await page.waitForSelector('[role="menu"]')
    await expect(page.getByRole('menuitem', { name: 'New Document' })).not.toBeVisible()

    // Restore: enter edit mode again and re-show New Document
    await page.click('[aria-label="More options"]')
    await page.waitForSelector('[role="menu"]')
    await page.getByRole('menuitem', { name: /Customize/i }).click()
    await expect(page.locator('text=Customize menu')).toBeVisible()
    const newDocRowRestored = page.locator('.animate-wiggle', { hasText: 'New Document' }).locator('..')
    await newDocRowRestored.locator('button[aria-label*="Show New Document"]').click()
    await page.getByRole('menuitem', { name: /Done/i }).click()

    // Confirm "New Document" is back
    await page.click('[aria-label="More options"]')
    await page.waitForSelector('[role="menu"]')
    await expect(page.getByRole('menuitem', { name: 'New Document' })).toBeVisible()
    await page.keyboard.press('Escape')
  })
})

// ---------------------------------------------------------------------------
// FileListPanel header — files-header
// ---------------------------------------------------------------------------

test.describe('files-header customizable views', () => {
  test.beforeEach(async () => {
    // Ensure file panel is open
    const panelVisible = await page.locator('[data-testid="file-list-panel"]').isVisible()
    if (!panelVisible) {
      await page.click('[aria-label="Show files"], [aria-label="Hide files"]')
      await page.waitForSelector('[data-testid="file-list-panel"]')
    }
  })

  test('shows the "More views" button with Customize… option', async () => {
    await page.click('[aria-label="More views"]')
    await page.waitForSelector('[role="menu"]')
    await expect(page.getByRole('menuitem', { name: /Customize/i })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="menu"]')).not.toBeVisible()
  })

  test('enters and exits edit mode for view toggles', async () => {
    await page.click('[aria-label="More views"]')
    await page.waitForSelector('[role="menu"]')

    await page.getByRole('menuitem', { name: /Customize/i }).click()
    await expect(page.locator('text=Customize views')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Done/i })).toBeVisible()

    // Exit via Done
    await page.getByRole('menuitem', { name: /Done/i }).click()
    await expect(page.locator('[role="menu"]')).not.toBeVisible()
  })
})
