import { test, expect } from '@playwright/test';

test('Selecting the Creep preset loads its score and plays audio', async ({ page }) => {
  const consoleLogs = [];
  const errors = [];
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('=== selecting Creep preset ===');
  const presetSelect = page.locator('select.preset-select');
  await expect(presetSelect).toBeVisible();
  await presetSelect.selectOption('creep');

  // CodeMirror renders the score inside .cm-content.
  // The Creep preset's score begins with the comment marker from BUILTIN_PRESETS.
  const editorText = await page.locator('.cm-content').textContent();
  console.log('=== editor text (first 200 chars) ===');
  console.log((editorText || '').slice(0, 200));
  expect(editorText || '').toContain('Creep (Radiohead)');

  console.log('=== clicking Eval ===');
  await page.locator('button[aria-label="Запуск"]').click();
  await page.waitForTimeout(5000);

  const audioStatus = await page.locator('dl.status-grid dd').nth(1).textContent();
  console.log('audio status:', audioStatus);

  console.log('=== console logs ===');
  consoleLogs.forEach((l) => console.log(l));
  console.log('=== errors ===');
  errors.forEach((e) => console.log(e));

  await page.screenshot({
    path: '/home/az/.paseo/worktrees/refactor-wavecode-restore-strudel/ui/tests/e2e/screenshots/presets-creep.png',
    fullPage: true,
  });

  expect(errors).toHaveLength(0);
  expect(audioStatus).toBe('playing');
});