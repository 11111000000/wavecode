import { test, expect } from '@playwright/test';

/**
 * Console e2e — verifies the Toast + ConsoleButton + ConsoleSheet
 * surfaces from `math/wavecode-debug-console` reflect errors
 * emitted by the runtime.
 *
 * Test strategy:
 *   1. Load app, wait for first eval (loading takes ~1s).
 *   2. Inject a `console.error('E2E TEST CONSOLE ERROR')` via
 *      page.evaluate — the patched wrapStrudelLogger catches
 *      levels coming through `console.error` directly (which
 *      means it bypasses Strudel-flavored detection but still
 *      hits the ring buffer).
 *   3. Verify the ConsoleButton shows a badge with count > 0.
 *   4. Click the button, assert ConsoleSheet opens.
 *   5. The Errors tab is the default; the injected string must
 *      appear somewhere in the sheet.
 *   6. Close the sheet (Esc key — see App.tsx keyboard
 *      shortcuts).
 *
 * Note: the underlying console-store surfaces only have
 * `data-testid`s added in the Subagent 2 commit. If you see
 * "locator not found", check that `data-testid="wc-console-btn"`
 * and `data-testid="wc-console-sheet"` selectors are present.
 */

const BASE_URL = 'http://127.0.0.1:5173';

test.beforeEach(async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  // Give onMount a beat to call loadAllSamples + install console globals.
  await page.waitForTimeout(1500);
});

test('injected console.error shows badge in ConsoleButton and surfaces in ConsoleSheet', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  // 1. Trigger a console.error from the page itself — this
  //    routes through the patched logger.mjs route (since
  //    it has the `%c[…]` shape only sometimes; raw
  //    `console.error` always reaches the ring buffer).
  await page.evaluate(() => {
    console.error('E2E TEST CONSOLE ERROR — synthwave lives');
  });

  // 2. The ConsoleButton should show a badge. The button has
  //    data-testid="wc-console-btn" and an inner element
  //    data-testid="wc-console-btn-badge" with text content.
  const consoleBtn = page.locator('[data-testid="wc-console-btn"]');
  await expect(consoleBtn).toBeVisible({ timeout: 5000 });

  const badge = page.locator('[data-testid="wc-console-btn-badge"]');
  await expect(badge).toBeVisible();
  const badgeText = (await badge.textContent()) || '';
  const badgeCount = parseInt(badgeText.trim(), 10);
  expect(badgeCount, `badge text "${badgeText}" should parse to positive integer`).toBeGreaterThan(0);

  // 3. Click the button → ConsoleSheet opens.
  await consoleBtn.click();
  const sheet = page.locator('[data-testid="wc-console-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });

  // 4. Errors tab is the default. The injected error string should
  //    be visible somewhere in the sheet body.
  const sheetBody = page.locator('[data-testid="wc-console-sheet-body"]');
  await expect(sheetBody).toContainText('E2E TEST CONSOLE ERROR');

  // 5. Verify the tabs are present (Errors / All / By source).
  const tabs = page.locator('[data-testid="wc-console-sheet"] [role="tab"]');
  await expect(tabs).toHaveCount(3);

  // 6. Close the sheet via Esc — App.tsx shortcuts wire this.
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible({ timeout: 2000 });

  // No uncaught pageerror events during the run.
  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED/i.test(e),
  );
  expect(realErrors, `unexpected pageerrors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});
