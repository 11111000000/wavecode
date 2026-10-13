import { test, expect } from '@playwright/test';

/**
 * wavecode-step-append-sync — e2e regression suite.
 *
 * Verifies the user-visible promise of the packet:
 *   - Loading a preset, then opening the step sequencer and tapping cells
 *     must NOT replace the editor score. The audio engine must keep
 *     playing the loaded preset (no scheduler rebuild).
 *   - When the user taps `↑ load & play` in the empty editor, the score
 *     becomes just the grid snippet. With a non-empty score, the grid
 *     layers are spliced/appended — original layers must still appear in
 *     the resulting CodeMirror document.
 */

const openStepGrid = async (page: import('@playwright/test').Page) => {
  await page.locator('button.wc-chip:has-text("Step")').first().click();
  await page.waitForSelector('.step-grid', { timeout: 5_000 });
};

const audioStatus = (page: import('@playwright/test').Page) =>
  page.locator('dl.status-grid dd').nth(1).textContent();

test('tapping a cell does NOT clobber the loaded preset (score preserved, audio still playing)', async ({ page }) => {
  const consoleLogs: string[] = [];
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
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

  // Open the step sequencer.
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

test('tapping ↑ load & play with a loaded preset wraps grid layers into the existing stack', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  await page.locator('select.preset-select').selectOption('creep');
  await expect(page.locator('.cm-content')).toContainText('Creep');

  await openStepGrid(page);

  // Tap a few cells to make the grid snippet non-trivial.
  const cells = page.locator('.step-cell');
  await cells.nth(0).click(); // bd step 1
  await cells.nth(9).click(); // sd step 2
  await cells.nth(18).click(); // hh step 3

  // Click ↑ load & play.
  await page.locator('.step-grid button:has-text("load")').click();

  // Wait for the new score to flush through CodeMirror.
  await page.waitForTimeout(1_500);

  const text = (await page.locator('.cm-content').textContent()) ?? '';
  // The original Creep comment must still be present.
  expect(text).toContain('Creep');
  // The new editor score should start with `stack(`, which means the
  // grid snippet got merged into the existing stack — not appended as
  // brand-new content that displaces Creep.
  expect(text).toMatch(/^stack\(/);
});

test('empty editor + grid tap + load→editor equals standalone grid snippet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  // Clear the editor.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');

  await openStepGrid(page);
  const cells = page.locator('.step-cell');
  await cells.nth(0).click();
  await cells.nth(9).click();
  await page.locator('.step-grid button:has-text("load")').click();
  await page.waitForTimeout(800);

  const text = (await page.locator('.cm-content').textContent()) ?? '';
  expect(text).toMatch(/^stack\(/);
  expect(text).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\)/);
  expect(text).toMatch(/s\("~ sd ~ ~ ~ ~ ~ ~"\)/);
});
