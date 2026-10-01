import { test, expect } from '@playwright/test';

test('Score is autosaved to IndexedDB and restored after page reload', async ({ page }) => {
  const consoleLogs = [];
  const errors = [];
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // First, reset persisted state by clicking the "Reset all" button (🧹)
  // so the typed marker below is the only thing that could possibly match after reload.
  // Confirm dialog must be accepted.
  page.once('dialog', (d) => d.accept());
  await page.locator('button[title="Сбросить всё"]').click();
  await page.waitForTimeout(2000);
  await page.waitForSelector('main.app', { timeout: 15000 });

  const MARKER = 'wavecode-persist-marker-9f3a7c';
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.waitForTimeout(200);
  await page.keyboard.type(MARKER, { delay: 10 });

  // Wait for the 500ms autosave debounce in App.tsx plus a comfortable margin.
  await page.waitForTimeout(2000);

  const beforeReload = await editor.textContent();
  console.log('=== before reload ===');
  console.log((beforeReload || '').slice(0, 200));
  expect(beforeReload || '').toContain(MARKER);

  console.log('=== reloading ===');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForTimeout(2000);

  const afterReload = await page.locator('.cm-content').textContent();
  console.log('=== after reload ===');
  console.log((afterReload || '').slice(0, 200));

  console.log('=== console logs ===');
  consoleLogs.forEach((l) => console.log(l));
  console.log('=== errors ===');
  errors.forEach((e) => console.log(e));

  expect(errors).toHaveLength(0);
  expect(afterReload || '').toContain(MARKER);
});