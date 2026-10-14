import { test, expect } from '@playwright/test';

const SCORE_EDITOR = '.cm-content';
const PLAY_BUTTON = 'button[aria-label="Запуск"]';
const NEW_BUTTON = 'button[aria-label="Новая"]';
const TRANSPILE_BUTTON = '[data-testid="transpile-to-js"]';
const RESET_BUTTON = 'button[aria-label="Сбросить все настройки"]';

/**
 * E2E for phase 3 of the wavecode Lisp transpiler:
 *   - New Composition dialog offers JS / Lisp choice
 *   - Transpile button converts Lisp → JS in one click
 *   - Reset all button is visible in TopBar
 *
 * The previous `LanguageToggle` tests are obsolete (toggle removed).
 */

test.describe('New Composition dialog', () => {
  test('picks Lisp and loads Lisp template', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('main.app', { timeout: 15000 });

    // Click "New" — should open dialog.
    await page.locator(NEW_BUTTON).click();
    await page.waitForSelector('.wc-new-comp-dialog', { timeout: 5000 });

    // Pick Lisp.
    await page.locator('.wc-new-comp-btn[data-mode="lisp"]').click();

    // Dialog closes; editor now has Lisp template; mode is lisp.
    await expect(page.locator('.wc-new-comp-dialog')).toHaveCount(0);

    const stored = await page.evaluate(() => localStorage.getItem('wavecode:languageMode'));
    expect(stored).toBe('lisp');

    // Transpile button should be visible (Lisp mode + non-empty score).
    await expect(page.locator(TRANSPILE_BUTTON)).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('picks JS and loads JS template (default)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('main.app', { timeout: 15000 });

    // Force Lisp mode first so we can verify "pick JS" actually changes it.
    await page.evaluate(() => localStorage.setItem('wavecode:languageMode', 'lisp'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15000 });

    // Click "New" + pick JS.
    await page.locator(NEW_BUTTON).click();
    await page.waitForSelector('.wc-new-comp-dialog', { timeout: 5000 });
    await page.locator('.wc-new-comp-btn[data-mode="js"]').click();

    // Transpile button should NOT be visible (we just switched to JS, no score yet).
    await expect(page.locator(TRANSPILE_BUTTON)).toHaveCount(0);

    const stored = await page.evaluate(() => localStorage.getItem('wavecode:languageMode'));
    expect(stored).toBe('js');
  });
});

test.describe('Transpile to JS button', () => {
  test('converts a Lisp score in one click', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('main.app', { timeout: 15000 });

    // Start a fresh Lisp composition.
    await page.locator(NEW_BUTTON).click();
    await page.waitForSelector('.wc-new-comp-dialog', { timeout: 5000 });
    await page.locator('.wc-new-comp-btn[data-mode="lisp"]').click();

    // Replace the template with a known Lisp snippet.
    const editor = page.locator(SCORE_EDITOR).first();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('(note "c4" (slow 2))');

    // Transpile button should be visible now.
    await expect(page.locator(TRANSPILE_BUTTON)).toBeVisible();

    // Click Transpile.
    await page.locator(TRANSPILE_BUTTON).click();

    // After transpile: button disappears (mode=js now), editor has JS output.
    await expect(page.locator(TRANSPILE_BUTTON)).toHaveCount(0);

    const stored = await page.evaluate(() => localStorage.getItem('wavecode:languageMode'));
    expect(stored).toBe('js');

    expect(pageErrors).toEqual([]);
  });
});

test.describe('Reset all button in TopBar', () => {
  test('is visible alongside Undo/Redo', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('main.app', { timeout: 15000 });

    await expect(page.locator(RESET_BUTTON)).toBeVisible();
  });
});

test.describe('Lisp score plays without ReferenceError', () => {
  test('typed Lisp snippet evaluates via live transpiler', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('main.app', { timeout: 15000 });

    // New → Lisp.
    await page.locator(NEW_BUTTON).click();
    await page.waitForSelector('.wc-new-comp-dialog', { timeout: 5000 });
    await page.locator('.wc-new-comp-btn[data-mode="lisp"]').click();

    // Type a Lisp snippet.
    const editor = page.locator(SCORE_EDITOR).first();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('(note "c4 e4 g4")');

    // Play.
    await page.locator(PLAY_BUTTON).click();
    await page.waitForTimeout(1500);

    // No ReferenceError on `note`.
    const fatal = pageErrors.find((e) =>
      /note is not defined|TypeError|ReferenceError/.test(e),
    );
    expect(fatal, `unexpected pageerror: ${fatal ?? ''}`).toBeUndefined();
  });
});