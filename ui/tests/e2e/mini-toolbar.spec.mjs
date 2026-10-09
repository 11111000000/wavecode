import { test, expect } from '@playwright/test';

/**
 * Mini-notation toolbar — mobile-only sticky strip of snippet buttons
 * (note(, s(, stack(, <, >, etc.). Inserts the snippet at the cursor
 * via CodeMirror's view.dispatch and parks the cursor right after.
 *
 * On desktop (≥721px) the strip is hidden via CSS.
 */
test('mobile (375×667): mini-toolbar is visible and tapping `note(` inserts the snippet into the editor', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  // CodeMirror mounts async; give it a moment to render and for onReady to fire.
  await page.waitForSelector('.cm-content', { timeout: 15000 });

  const toolbar = page.locator('.mini-toolbar');
  await expect(toolbar).toBeVisible();

  // Default code is empty for a fresh user; clear any IDB-restored text
  // by selecting all + delete so we have a deterministic baseline.
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await expect(page.locator('.cm-content')).toHaveText('');

  // Park cursor at end of (now empty) doc and tap `note(`.
  const noteBtn = toolbar.locator('button.mini-toolbar-btn', { hasText: 'note(' });
  await expect(noteBtn).toBeVisible();
  await noteBtn.click();

  await expect(page.locator('.cm-content')).toContainText('note(');
});

test('desktop (1280): mini-toolbar is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForSelector('.cm-content', { timeout: 15000 });

  const toolbar = page.locator('.mini-toolbar');
  await expect(toolbar).toBeHidden();
});
