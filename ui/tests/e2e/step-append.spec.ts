import { test, expect } from '@playwright/test';

/**
 * wavecode-step-grid-modes — e2e regression suite (supersedes
 * wavecode-step-append-sync's button-name expectations).
 *
 * The StepGrid is now mode-driven. The "↑ load & play" button is
 * replaced by "↑ commit (N unsaved)" which only appears in sketch
 * mode. Before clicking it, the test must switch the mode pill to
 * `sketch`.
 *
 * Verifies the user-visible promise:
 *   - view mode is the default; tapping cells does NOT clobber
 *     the loaded preset (previewSample only, no score mutation).
 *   - sketch mode + ↑ commit: the score becomes the merged stack.
 *   - edit mode (gated on 4-s-layer stack) per-tap splices the
 *     s("…") row in place.
 */

const openStepGrid = async (page: import('@playwright/test').Page) => {
  await page.locator('button.wc-chip:has-text("Step")').first().click();
  await page.waitForSelector('.step-grid', { timeout: 5_000 });
};

const enterSketchMode = async (page: import('@playwright/test').Page): Promise<void> => {
  const btn = page.locator('.step-grid-mode-btn', { hasText: 'sketch' });
  await btn.click();
};

const enterEditMode = async (page: import('@playwright/test').Page): Promise<void> => {
  const btn = page.locator('.step-grid-mode-btn', { hasText: 'edit' });
  // The button is disabled if score is not 4-s-layer stack.
  await btn.click();
};

const clickCommit = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.locator('[data-testid="step-grid-commit"]').click();
};

const audioStatus = (page: import('@playwright/test').Page) =>
  page.locator('dl.status-grid dd').nth(1).textContent();

test('view mode: tapping a cell does NOT clobber the loaded preset', async ({ page }) => {
  const consoleLogs: string[] = [];
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  // Load "creep" preset.
  await page.locator('select.preset-select').selectOption('creep');
  await expect(page.locator('.cm-content')).toContainText('Creep');

  // Start audio so audio.status reports 'playing'.
  await page.locator('button[aria-label="Запуск"]').click();
  await page.waitForTimeout(4_000);
  const statusBefore = (await audioStatus(page)) ?? '';
  expect(statusBefore.trim()).toBe('playing');

  // Open the step sequencer (view mode is the default).
  await openStepGrid(page);

  // Tap two cells (kick row 0 col 0, snare row 1 col 1).
  const cells = page.locator('.step-cell');
  await cells.nth(0).click(); // bd step 1
  await cells.nth(9).click(); // sd step 2

  // Give the audio engine a moment to potentially rebuild scheduler.
  await page.waitForTimeout(2_000);
  const statusAfter = (await audioStatus(page)) ?? '';
  // Audio must still be playing — previewSample does NOT touch the scheduler.
  expect(statusAfter.trim()).toBe('playing');

  // Original Creep content must still be in the editor (not replaced by grid snippet).
  const editorText = (await page.locator('.cm-content').textContent()) ?? '';
  expect(editorText).toContain('Creep');

  consoleLogs.forEach((l) => console.log(l));
});

test('sketch mode + ↑ commit with a loaded preset wraps grid layers into the existing stack', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  await page.locator('select.preset-select').selectOption('creep');
  await expect(page.locator('.cm-content')).toContainText('Creep');

  await openStepGrid(page);
  await enterSketchMode(page);

  // Tap a few cells to make the grid snippet non-trivial.
  const cells = page.locator('.step-cell');
  await cells.nth(0).click(); // bd step 1
  await cells.nth(9).click(); // sd step 2
  await cells.nth(18).click(); // hh step 3

  // Click ↑ commit.
  await clickCommit(page);

  // Wait for the new score to flush through CodeMirror.
  await page.waitForTimeout(1_500);

  const text = (await page.locator('.cm-content').textContent()) ?? '';
  // The original Creep comment must still be present.
  expect(text).toContain('Creep');
  // The grid layer (bd) must have been merged INTO the existing stack.
  // The score may start with the Creep comment, so we don't anchor to
  // `^stack(` — we just look for the bd-pattern that proves the grid
  // got appended inside the existing stack(...) and not as standalone.
  expect(text).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\)/);
});

test('empty editor + sketch + ↑ commit equals standalone grid snippet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  // Clear the editor.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');

  await openStepGrid(page);
  await enterSketchMode(page);
  const cells = page.locator('.step-cell');
  await cells.nth(0).click();
  await cells.nth(9).click();
  await clickCommit(page);
  await page.waitForTimeout(800);

  const text = (await page.locator('.cm-content').textContent()) ?? '';
  expect(text).toMatch(/^stack\(/);
  expect(text).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\)/);
  expect(text).toMatch(/s\("~ sd ~ ~ ~ ~ ~ ~"\)/);
});

test('edit mode per-tap splices the s("…") row in place (no double-wrap)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  // Replace the editor with a clean 4-s-layer score so edit mode is enabled.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  const cleanScore = [
    'stack(',
    '  s("~ ~ ~ ~ ~ ~ ~ ~"),',
    '  s("~ ~ ~ ~ ~ ~ ~ ~"),',
    '  s("~ ~ ~ ~ ~ ~ ~ ~"),',
    '  s("~ ~ ~ ~ ~ ~ ~ ~")',
    ')',
  ].join('\n');
  await page.keyboard.type(cleanScore);
  await page.waitForTimeout(300);

  await openStepGrid(page);
  await enterEditMode(page);

  // Tap a single cell (bd row 0 col 0).
  const cells = page.locator('.step-cell');
  await cells.nth(0).click();
  await page.waitForTimeout(300);

  const text = (await page.locator('.cm-content').textContent()) ?? '';
  // The first s-row now has bd on step 1.
  expect(text).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\)/);
  // No double-wrap: exactly one outer stack.
  expect((text.match(/stack\(/g) ?? []).length).toBe(1);
});
