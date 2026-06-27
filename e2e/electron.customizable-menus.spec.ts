/**
 * Customizable toolbar (#701) — regression coverage for the unified
 * CustomizableToolbar: the "⋯" overflow menu, its Customize… (wiggle) edit
 * mode, and hidden-item persistence. Covers the two surfaces that use it:
 *
 *   1. Main toolbar           → menuId "toolbar"        (data-testid="main-toolbar")
 *   2. FileListPanel header   → menuId "files-header"   (data-testid="file-list-panel")
 *
 * Both expose the same "More options" (⋯) trigger; tests scope by container.
 * The toolbar shows a "Drag to customize toolbar" heading in edit mode; the
 * file header intentionally omits it. Tests run against the built `out/` in an
 * isolated PROSE_USER_DATA_DIR so no real settings are touched. Assertions are
 * negative-controlled (open → default → customize → close → reopen → verify).
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

// The two ⋯ triggers, each scoped to its container so the selector is unambiguous.
const TOOLBAR_MORE = '[data-testid="main-toolbar"] [aria-label="More options"]'
const FILES_MORE = '[data-testid="file-list-panel"] [aria-label="More options"]'

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
// Main toolbar — menuId "toolbar"
// ---------------------------------------------------------------------------

test.describe('toolbar customizable menu', () => {
  test('shows document actions and Customize… trigger by default', async () => {
    await page.click(TOOLBAR_MORE)
    await page.waitForSelector('[role="menu"]')

    // Document actions sit past the default bar/menu boundary → in the ⋯ menu.
    await expect(page.getByRole('menuitem', { name: 'New Document' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Open...' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    // Pinned action lives at the bottom of the menu.
    await expect(page.getByRole('menuitem', { name: 'Close' })).toBeVisible()
    // Customize trigger is always present.
    await expect(page.getByRole('menuitem', { name: /Customize/i })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('[role="menu"]')).not.toBeVisible()
  })

  test('enters and exits edit mode via Customize… and Done', async () => {
    await page.click(TOOLBAR_MORE)
    await page.waitForSelector('[role="menu"]')

    // Customize… enters wiggle mode without closing (onSelect preventDefault).
    await page.getByRole('menuitem', { name: /Customize/i }).click()

    await expect(page.locator('[role="menu"]')).toBeVisible()
    await expect(page.locator('text=Drag to customize toolbar')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Done/i })).toBeVisible()

    await page.getByRole('menuitem', { name: /Done/i }).click()
    await expect(page.locator('[role="menu"]')).not.toBeVisible()
  })

  test('hides a menu item and persists across close/reopen', async () => {
    await page.click(TOOLBAR_MORE)
    await page.waitForSelector('[role="menu"]')
    await page.getByRole('menuitem', { name: /Customize/i }).click()
    await expect(page.locator('text=Drag to customize toolbar')).toBeVisible()

    // Hide "New Document" via its eye toggle.
    const hideBtn = page.locator('button[aria-label="Hide New Document"]')
    await expect(hideBtn).toBeVisible()
    await hideBtn.click()
    await page.getByRole('menuitem', { name: /Done/i }).click()
    await expect(page.locator('[role="menu"]')).not.toBeVisible()

    // Reopen — "New Document" should be gone from the menu.
    await page.click(TOOLBAR_MORE)
    await page.waitForSelector('[role="menu"]')
    await expect(page.getByRole('menuitem', { name: 'New Document' })).not.toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="menu"]')).not.toBeVisible()

    // Restore: re-enter edit mode and re-show it (edit mode lists hidden rows too).
    await page.click(TOOLBAR_MORE)
    await page.waitForSelector('[role="menu"]')
    await page.getByRole('menuitem', { name: /Customize/i }).click()
    await expect(page.locator('text=Drag to customize toolbar')).toBeVisible()
    const showBtn = page.locator('button[aria-label="Show New Document"]')
    await expect(showBtn).toBeVisible()
    await showBtn.click()
    await expect(page.locator('button[aria-label="Hide New Document"]')).toBeVisible()
    await page.getByRole('menuitem', { name: /Done/i }).click()
    await expect(page.locator('[role="menu"]')).not.toBeVisible()

    await page.click(TOOLBAR_MORE)
    await page.waitForSelector('[role="menu"]')
    await expect(page.getByRole('menuitem', { name: 'New Document' })).toBeVisible()
    await page.keyboard.press('Escape')
  })
})

// ---------------------------------------------------------------------------
// FileListPanel header — menuId "files-header" (compact, no heading)
// ---------------------------------------------------------------------------

test.describe('files-header customizable views', () => {
  test.beforeEach(async () => {
    const panelVisible = await page.locator('[data-testid="file-list-panel"]').isVisible()
    if (!panelVisible) {
      await page.click('[aria-label="Show files"], [aria-label="Hide files"]')
      await page.waitForSelector('[data-testid="file-list-panel"]')
    }
  })

  test('shows the ⋯ button with a Customize… option', async () => {
    await page.click(FILES_MORE)
    await page.waitForSelector('[role="menu"]')
    await expect(page.getByRole('menuitem', { name: /Customize/i })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="menu"]')).not.toBeVisible()
  })

  test('enters and exits edit mode for view toggles', async () => {
    await page.click(FILES_MORE)
    await page.waitForSelector('[role="menu"]')

    await page.getByRole('menuitem', { name: /Customize/i }).click()
    // The file header omits the customize heading; edit mode is identified by the
    // Done control (and the draggable rows it now shows).
    await expect(page.getByRole('menuitem', { name: /Done/i })).toBeVisible()

    await page.getByRole('menuitem', { name: /Done/i }).click()
    await expect(page.locator('[role="menu"]')).not.toBeVisible()
  })
})
