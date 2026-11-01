import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';

/**
 * Mini-notation toolbar — mobile-only sticky strip of snippet buttons
 * (note(, s(, stack(, <, >, etc.). Inserts the snippet at the cursor
 * via CodeMirror's view.dispatch and parks the cursor right after.
 *
 * The strip used to be mobile-only (hidden on desktop via CSS). It is
 * now part of the score panel on every viewport — `.mini-toolbar` has
 * an unconditional `display: flex` — so the desktop case asserts that
 * it is present rather than that it is hidden.
 */
test('mobile (375×667): mini-toolbar is visible and tapping `note(` inserts the snippet into the editor', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  // CodeMirror mounts async; give it a moment to render and for onReady to fire.
  await page.waitForSelector('.cm-content', { timeout: 15000 });

  // On mobile the strip is closed by default (wavecode-toast-overhead-
  // and-toolbar-toggle): it lives behind the `✎ snippet` disclosure.
  const toggle = page.locator('.snippet-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();

  const toolbar = page.locator('.mini-toolbar');
  await expect(toolbar).toBeVisible();

  // Default code is empty for a fresh user; clear any IDB-restored text
  // by selecting all + delete so we have a deterministic baseline.
  // .cm-scroller is the visible editor surface; .cm-content is taller
  // than its clipped viewport, so clicking the latter aims at the
  // centre of a box that is mostly scrolled out of sight.
  const editor = page.locator('.cm-scroller');
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

test('desktop (1280): mini-toolbar is available too', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForSelector('.cm-content', { timeout: 15000 });

  // The toolbar is no longer desktop-hidden — it ships in the score
  // panel on every viewport.
  const toolbar = page.locator('.mini-toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('button.mini-toolbar-btn').first()).toBeVisible();
});
