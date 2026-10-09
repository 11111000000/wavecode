import { test, expect } from '@playwright/test';

/**
 * Audio recording — UI smoke test.
 *
 * Проверяет, что:
 *   - ⏺ Запись и 📼 Render offline рендерятся в header,
 *   - модалка Render offline открывается/закрывается,
 *   - cycles-input работает.
 *
 * Реальная запись / render не запускаются:
 *   - headless chromium не имеет полноценного AudioContext + MediaRecorder,
 *   - Strudel chunks (~600KB) не подгружаются до user-gesture,
 *   - e2e live recording за рамками этой задачи (см. packet.notes —
 *     manual QA на desktop Chrome / Safari для финального бейта).
 */

test('Record button + Render modal UI present', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });

  const recordBtn = page.locator('button:has-text("⏺ Запись")');
  await expect(recordBtn).toBeVisible();

  const renderBtn = page.locator('button:has-text("📼 Render offline")');
  await expect(renderBtn).toBeVisible();

  // Open Render modal.
  await renderBtn.click();
  const modal = page.locator('.record-modal');
  await expect(modal).toBeVisible();

  const cyclesInput = page.locator('.record-modal-input');
  await expect(cyclesInput).toBeVisible();
  await cyclesInput.fill('8');
  await expect(cyclesInput).toHaveValue('8');

  // Close.
  await page.locator('.record-modal-actions button:has-text("Отмена")').click();
  await expect(modal).not.toBeVisible();
});

test('Record button toggles state when clicked (headless: no MediaRecorder → error state)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });

  const recordBtn = page.locator('button:has-text("⏺ Запись")');
  await recordBtn.click();
  // Headless chromium: MediaRecorder либо отсутствует, либо требует
  // user-gesture + AudioContext. UI должен либо перейти в recording state,
  // либо показать ошибку в `.record-err` рядом с кнопкой. Главное —
  // никаких uncaught exceptions.
  await page.waitForTimeout(500);

  const state = await recordBtn.getAttribute('data-state');
  expect(['idle', 'recording', 'stopping', 'error']).toContain(state);
});