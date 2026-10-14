import { test, expect } from '@playwright/test';

/**
 * e2e for math/wavecode-preset-id-hydration.
 *
 * Bug: после выбора пресета X и reload'а вкладки играла X (score
 * восстановлен из IDB), но в <select> всегда светилось "Creep".
 * Root: presetId был локальным сигналом AppShell без гидрации.
 *
 * Fix: persist `wavecode-selected-preset-v1` (localStorage), hydrate
 * через useAppBootstrap после `repo.loadScore()`.
 *
 * Воспроизводим три сценария:
 *  1. Выбор X → reload → dropdown показывает X (НЕ Creep).
 *  2. localStorage = несуществующий id → reload → fallback на Creep
 *     + persist (мёртвый id больше не восстанавливается).
 *  3. После resetSelectedPreset — dropdown = Creep, ключ стёрт.
 */

test('selected preset survives reload (and is not always Creep)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
  });

  await page.goto('http://127.0.0.1:5173/#/app', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });

  // Drop any prior state to start clean.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('select.preset-select', { timeout: 15000 });

  // First-launch state: default Creep.
  await expect(page.locator('select.preset-select')).toHaveValue('creep');

  // Pick a non-Creep preset and confirm persistence.
  await page.locator('select.preset-select').selectOption('ambient-drone');
  await expect(page.locator('select.preset-select')).toHaveValue('ambient-drone');
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('wavecode-selected-preset-v1'));
  expect(stored).toBe('ambient-drone');

  // Reload — score restores from IDB, presetId from localStorage.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('select.preset-select', { timeout: 15000 });

  // The critical assertion: dropdown shows the persisted id, not Creep.
  await expect(page.locator('select.preset-select')).toHaveValue('ambient-drone');

  // The score in the editor should match the ambient-drone preset.
  const editorText = await page.locator('.cm-content').textContent();
  expect(editorText || '').toMatch(/ambient/i);

  expect(errors).toHaveLength(0);
});

test('deleted custom preset falls back to Creep on next reload', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/#/app', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });

  // Pretend a custom preset used to exist and was selected, but has been
  // wiped from localStorage (e.g., user cleared custom-presets-v1).
  await page.evaluate(() => {
    window.localStorage.setItem('wavecode-selected-preset-v1', 'custom-ghost');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('select.preset-select', { timeout: 15000 });

  // hydrateSelectedPreset detects the dead id and falls back to Creep,
  // AND persists the fallback (so the next reload is clean).
  await expect(page.locator('select.preset-select')).toHaveValue('creep');
  const storedAfter = await page.evaluate(() =>
    window.localStorage.getItem('wavecode-selected-preset-v1'));
  expect(storedAfter).toBe('creep');
});