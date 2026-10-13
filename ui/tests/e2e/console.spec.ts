import { test, expect, type Page } from '@playwright/test';

/**
 * Console e2e — verifies the Toast + ConsoleButton + ConsoleSheet
 * surfaces from `math/wavecode-debug-console` reflect errors
 * emitted by the runtime.
 *
 * Actual selectors (verified against current source — Phase 3):
 *   - [data-testid="console-btn"]                fixed FAB
 *   - [data-testid="console-btn-badge"]          count chip (hidden when 0)
 *   - role="dialog" aria-label="Console"        the sheet itself
 *   - [data-testid="console-body"]               scrollable body
 *   - [data-testid="console-empty"]              "No errors." fallback
 *   - nav[role="tablist"] button[role="tab"]     3 tabs (errors / all / by-source)
 *   - [data-testid="console-clear-btn"]          Clear button
 *   - button.console-close-btn                   Close X
 *   - .console-entry.console-entry-error         per-line styling
 *   - .toast-stack                                toast container
 *   - .toast-item[data-severity="error"]         clickable error toast
 *
 * Test strategy (5 tests):
 *   1. `console.error('test')` from the page is captured by the
 *      logger ring buffer and surfaces in the Errors tab (no badge —
 *      the logger doesn't bump unreadErrors; only window.onerror /
 *      unhandledrejection do).
 *   2. An unhandled rejection DOES bump the badge (consoleGlobals
 *      listens to those two event sources and pushes a toast).
 *   3. Opening the sheet via the button clears the badge (markAllRead
 *      fires as a side-effect of setConsoleOpen(true)).
 *   4. Cmd/Ctrl+` hotkey toggles the sheet.
 *   5. The Clear button empties the buffer (Errors tab shows the
 *      "No errors." fallback).
 *
 * Why the original stub is wrong:
 *   The original test (Subagent 5 / commit 02f2f49) asserted that
 *   `console.error('E2E TEST CONSOLE ERROR — synthwave lives')`
 *   increments the badge. That premise is false — the badge counts
 *   TOASTS, and toasts come only from window.onerror /
 *   unhandledrejection, never from direct console.* calls. Direct
 *   console.* still hit the ring buffer (logger.install patches
 *   console.log/info/warn/error) and DO show up in the Errors tab,
 *   but they don't bump unreadErrors.
 *
 *   Also: the original stub used `wc-console-btn` /
 *   `wc-console-sheet` selectors which were never shipped — the
 *   actual test-ids are `console-btn` / `console-body` (no prefix).
 *   The stub's `BASE_URL` was 5173 (dev) but every other e2e spec
 *   uses 4173 (preview). This file adopts 4173 for consistency.
 *
 * Note on dedupe:
 *   consoleGlobals dedupes window.onerror / unhandledrejection on
 *   `fingerprint = title|body` for 1000ms. To bump the badge more
 *   than once within a test, use unique error messages (a counter).
 */

const BASE_URL = 'http://127.0.0.1:4173';

async function bootApp(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  // Give onMount a beat to call installConsoleGlobals + load persisted errors.
  await page.waitForTimeout(1500);
}

async function getBadgeText(page: Page): Promise<string> {
  // The badge element is hidden when count is 0 (Show conditional in
  // ConsoleButton.tsx). When absent, treat as '0' for assertions.
  const badge = page.locator('[data-testid="console-btn-badge"]');
  if ((await badge.count()) === 0) return '0';
  return (await badge.textContent()) ?? '';
}

test('console.error("test") from page surfaces in Errors tab (no badge — logger does not bump unreadErrors)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });

  await bootApp(page);

  // Direct console.error is captured by the logger's patched
  // console.error (logger.install in main.tsx). It pushes an
  // entry to the ring buffer and bumps the sink tick. It does NOT
  // bump unreadErrors (that signal is fed only by pushToast).
  await page.evaluate(() => {
    console.error('E2E-CONSOLE-ERROR-MARKER-9f3a7c');
  });
  await page.waitForTimeout(200);

  // The badge MUST be absent (count == 0). Direct console.error
  // routes to the ring buffer, not to a toast.
  expect(await getBadgeText(page), 'direct console.error must NOT bump unreadErrors').toBe('0');

  // Open the sheet via the button. Errors tab is default.
  await page.locator('[data-testid="console-btn"]').click();
  const sheet = page.locator('[role="dialog"][aria-label="Console"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });

  const body = page.locator('[data-testid="console-body"]');
  await expect(body).toContainText('E2E-CONSOLE-ERROR-MARKER-9f3a7c');

  // The injected entry must be classed as an error.
  const errorEntries = body.locator('.console-entry-error');
  await expect(errorEntries.first()).toBeVisible({ timeout: 2000 });
  await expect(errorEntries.first()).toContainText('E2E-CONSOLE-ERROR-MARKER-9f3a7c');

  // Three tabs present.
  await expect(sheet.locator('button[role="tab"]')).toHaveCount(3);

  // Close via the X button.
  await page.locator('button.console-close-btn').click();
  await expect(sheet).not.toBeVisible({ timeout: 2000 });

  // No uncaught pageerrors during the run.
  // Filter out the deliberately-injected marker as well as boot-
  // phase noise (Strudel sample preload, audio engine init).
  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio|\[sampler\]|\[cyclist\]|\[wavecode\]|E2E-CONSOLE-ERROR-MARKER/i.test(e),
  );
  expect(realErrors, `unexpected pageerrors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});

test('unhandled rejection pushes error toast and bumps the badge', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await bootApp(page);

  // Baseline: badge hidden (no errors yet).
  expect(await getBadgeText(page)).toBe('0');

  // Use a UNIQUE error message so consoleGlobals' 1s dedupe window
  // doesn't swallow it. A counter inside the page ensures uniqueness.
  await page.evaluate(() => {
    const err = new Error(`E2E-REJECT-MARKER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    // Promise.reject without a catch → unhandledrejection.
    Promise.reject(err);
  });

  // Wait for the toast to render.
  const toast = page.locator('.toast-stack .toast-item[data-severity="error"]');
  await expect(toast).toBeVisible({ timeout: 3000 });
  await expect(toast).toContainText(/Unhandled rejection/);

  // Badge must now show a positive count.
  const badgeText = await getBadgeText(page);
  const badgeCount = parseInt(badgeText.trim(), 10);
  expect(badgeCount, `badge text "${badgeText}" should parse to positive integer`).toBeGreaterThan(0);

  // Two more UNIQUE rejections should push the count higher.
  await page.evaluate(() => {
    const t = Date.now();
    Promise.reject(new Error(`E2E-REJECT-A-${t}`));
  });
  // Wait past the dedupe window so the next one is not suppressed.
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    Promise.reject(new Error(`E2E-REJECT-B-${Date.now()}`));
  });
  await page.waitForTimeout(200);

  const newBadgeText = await getBadgeText(page);
  const newBadgeCount = parseInt(newBadgeText.trim(), 10);
  expect(newBadgeCount, `badge should be > previous count after extra rejections (was ${badgeCount}, now ${newBadgeCount})`).toBeGreaterThan(badgeCount);

  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio|\[sampler\]|\[cyclist\]|\[wavecode\]/i.test(e),
  );
  expect(realErrors, `unexpected pageerrors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});

test('opening the console clears the badge (markAllRead side-effect of setConsoleOpen(true))', async ({ page }) => {
  await bootApp(page);

  // Trigger a toast to bump the badge.
  await page.evaluate(() => {
    Promise.reject(new Error(`E2E-MARKALLREAD-${Date.now()}-${Math.random()}`));
  });
  await page.waitForTimeout(300);

  // Badge should be > 0 before opening.
  const beforeBadge = await getBadgeText(page);
  expect(parseInt(beforeBadge.trim(), 10), 'badge must be > 0 before opening').toBeGreaterThan(0);

  // Open the sheet — setConsoleOpen(true) auto-fires markAllRead.
  await page.locator('[data-testid="console-btn"]').click();
  const sheet = page.locator('[role="dialog"][aria-label="Console"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });

  // Badge element must be gone (Show hides it when count == 0).
  await expect(page.locator('[data-testid="console-btn-badge"]')).toHaveCount(0);
  expect(await getBadgeText(page)).toBe('0');

  // Close via Esc (App.tsx doesn't bind Esc on the sheet, but the
  // backdrop click + X work; X is the most explicit).
  await page.locator('button.console-close-btn').click();
  await expect(sheet).not.toBeVisible({ timeout: 2000 });
});

test('Cmd/Ctrl+` hotkey toggles the console sheet', async ({ page }) => {
  await bootApp(page);

  // Ensure focus is NOT on an input — consoleGlobals suppresses the
  // hotkey when target is INPUT / TEXTAREA / contenteditable. Focus
  // the body element explicitly.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.focus();
  });

  // Hotkey with Control modifier (matches metaKey||ctrlKey in
  // consoleHotkey.matchesHotkey — see ui/src/presentation/components/consoleHotkey.ts).
  // Use the keyboard.down/up sequence so Playwright registers the
  // modifier flag on the keydown event. press('Control+`') can drop
  // the modifier depending on the browser, so explicit down is safer.
  const dialog = page.locator('[role="dialog"][aria-label="Console"]');
  await expect(dialog).toHaveCount(0);

  await page.keyboard.down('Control');
  await page.keyboard.press('Backquote');
  await page.keyboard.up('Control');
  await expect(dialog).toBeVisible({ timeout: 3000 });

  // Pressing the hotkey again should toggle it closed.
  await page.keyboard.down('Control');
  await page.keyboard.press('Backquote');
  await page.keyboard.up('Control');
  await expect(dialog).toHaveCount(0);
});

test('clear button empties the buffer (Errors tab shows "No errors.")', async ({ page }) => {
  await bootApp(page);

  // Seed the buffer with a unique marker.
  const marker = `E2E-CLEAR-MARKER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.evaluate((m) => {
    console.error(m);
    console.warn(`${m}-warn`);
  }, marker);
  await page.waitForTimeout(200);

  // Open the sheet and confirm the entries are visible.
  await page.locator('[data-testid="console-btn"]').click();
  const body = page.locator('[data-testid="console-body"]');
  await expect(body).toBeVisible({ timeout: 3000 });
  await expect(body).toContainText(marker);

  // Click Clear — logger.clear() drops the buffer; consoleStore
  // markAllRead also runs in onClick? No — handleClear calls
  // logger.clear() + consoleStore.clearToasts() (NOT markAllRead).
  // The error/warn entries must vanish.
  await page.locator('[data-testid="console-clear-btn"]').click();

  // Errors tab now shows the empty-state fallback.
  const empty = page.locator('[data-testid="console-empty"]');
  await expect(empty).toBeVisible({ timeout: 2000 });
  await expect(empty).toContainText('No errors');

  // Footer counts reset to "0 entries · 0 errors".
  await expect(page.locator('.console-counts')).toContainText(/0 entries.*0 errors/);
});