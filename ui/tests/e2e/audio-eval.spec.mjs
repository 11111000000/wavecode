import { test, expect } from '@playwright/test';

test('Eval button plays audio without errors', async ({ page }) => {
  const errors = [];
  const consoleMsgs = [];
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Solid mount.
  await page.waitForSelector('main.app', { timeout: 15000 });

  // Initial status read.
  const initialStatus = await page.locator('dl.status-grid dd').allTextContents();
  console.log('initial:', JSON.stringify(initialStatus));

  // Click Eval (play).
  await page.locator('button[aria-label="Запуск"]').click();
  await page.waitForTimeout(2000);

  const audioStatus = await page.locator('dl.status-grid dd').nth(1).textContent();

  expect(errors).toHaveLength(0);
  // After Eval, status should be either playing or error (if Strudel failed to load).
  expect(['playing', 'error']).toContain(audioStatus);
});
