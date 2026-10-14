import { test, expect } from '@playwright/test';

const LISP_TOGGLE = '.wavecode-language-toggle__btn[data-mode="lisp"]';
const JS_TOGGLE = '.wavecode-language-toggle__btn[data-mode="js"]';
const SCORE_EDITOR = '.cm-content';
const PLAY_BUTTON = 'button[aria-label="Запуск"]';

test('Language toggle switches mode and persists to localStorage', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForSelector(LISP_TOGGLE, { timeout: 10000 });

  // Initial: JS active.
  await expect(page.locator(JS_TOGGLE)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator(LISP_TOGGLE)).toHaveAttribute('aria-checked', 'false');

  // Switch to Lisp.
  await page.locator(LISP_TOGGLE).click();
  await expect(page.locator(LISP_TOGGLE)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator(JS_TOGGLE)).toHaveAttribute('aria-checked', 'false');

  // localStorage persists the choice across reload.
  const stored = await page.evaluate(() => localStorage.getItem('wavecode:languageMode'));
  expect(stored).toBe('lisp');

  // Reload — Lisp should still be active (lispHighlight extension
  // re-evaluates on view construction).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(LISP_TOGGLE, { timeout: 10000 });
  await expect(page.locator(LISP_TOGGLE)).toHaveAttribute('aria-checked', 'true');

  // Switch back to JS.
  await page.locator(JS_TOGGLE).click();
  await expect(page.locator(JS_TOGGLE)).toHaveAttribute('aria-checked', 'true');

  expect(pageErrors).toEqual([]);
});

test('Lisp transpiler evaluates a simple score without errors', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForSelector(LISP_TOGGLE, { timeout: 10000 });

  // Switch to Lisp mode.
  await page.locator(LISP_TOGGLE).click();

  // Type a Lisp score into the editor.
  const editor = page.locator(SCORE_EDITOR).first();
  await editor.click();
  // Select-all (Ctrl-A) + delete + type a Lisp snippet.
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('(note "c4 e4 g4")');

  // Click Play.
  await page.locator(PLAY_BUTTON).click();
  await page.waitForTimeout(1500);

  // No pageerror, no fatal audio errors. The repl may or may not actually
  // be playing sound in headless Chromium (no audio device), but no
  // ReferenceError on `note` or "transpiler crashed" should be raised.
  const fatalError = pageErrors.find((e) =>
    /note is not defined|transpiler|TypeError|ReferenceError/.test(e),
  );
  expect(fatalError, `unexpected pageerror: ${fatalError ?? ''}`).toBeUndefined();

  // We don't assert on audio status — the AudioContext may not start
  // without a real user gesture in some CI environments.
});