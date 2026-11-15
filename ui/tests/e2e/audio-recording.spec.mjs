import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';

/**
 * Recording surfaces — UI smoke test.
 *
 * Старая версия файла проверяла кнопки «⏺ Запись» и «📼 Render
 * offline» в header'е плюс модалку `.record-modal`. Обе кнопки
 * удалены в коммите edad0e4 («chore(ui): drop recording code that was
 * never mounted»): `RecordButton.tsx` больше нет в дереве, а
 * `.record-modal` не рендерится ни одним компонентом. Проверять их
 * больше нечего — и обещать их в UI нельзя (см. Panels.tsx на
 * лендинге).
 *
 * Что живёт в приложении сегодня:
 *   - транспортная панель (`TransportBar`) — фиксированная полоса
 *     сверху, под шапкой; в ней кнопка Play/Stop и выбор композиции;
 *   - кнопка «Запись» (REC) в панели пианино — нажатия клавиш пишутся
 *     в score;
 *   - вкладка Mic — запись голоса и ударов через микрофон (её
 *     разбирает отдельный `mic-phase3.spec.mjs`).
 *
 * Реальное аудио не запускается:
 *   - headless chromium не имеет полноценного AudioContext + MediaRecorder,
 *   - Strudel chunks (~600KB) не подгружаются до user-gesture,
 *   - e2e live recording за рамками этой задачи (manual QA на desktop
 *     Chrome / Safari — финальный бейт).
 */

test('Transport bar sits at the top of the shell and carries the play control', async ({ page }) => {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });

  const transport = page.locator('[data-testid="transport-bar"]');
  await expect(transport).toBeVisible();

  // Play живёт в фиксированной полосе сверху, а не «внизу справа».
  const playBtn = page.locator('[data-testid="transport-play-btn"]');
  await expect(playBtn).toBeVisible();
  await expect(playBtn).toHaveAttribute('data-state', 'play');
  await expect(playBtn).toHaveAttribute('aria-label', 'Запуск');

  const transportBox = await transport.boundingBox();
  const scoreBox = await page.locator('.score-panel').first().boundingBox();
  expect(transportBox).not.toBeNull();
  expect(scoreBox).not.toBeNull();
  if (!transportBox || !scoreBox) throw new Error('no bounding box for transport/score');
  expect(transportBox.y).toBeLessThan(scoreBox.y);

  // Выбор композиции — в той же полосе.
  await expect(page.locator('[data-testid="preset-select"]')).toBeVisible();
});

test('Piano sheet exposes the «Запись» REC toggle — the live recording control', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });

  // Пианино — инструмент второго уровня: на мобиле в лист «Инструменты»
  // ведёт кнопка в верхней панели (нижний рельс держит только четыре
  // пункта), на desktop — кнопка «Ещё» в рельсе.
  await page.locator('.wc-topbar [aria-label="Инструменты"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.wc-tool-card', { hasText: 'Пианино' }).first().click();
  await page.waitForTimeout(500);

  const recBtn = page.locator('button.piano-rec-btn[aria-label="Запись"]');
  await expect(recBtn).toBeVisible();
  await expect(recBtn).toHaveAttribute('aria-pressed', 'false');

  // Включение REC вооружает запись нажатий в score.
  await recBtn.click();
  await expect(recBtn).toHaveAttribute('aria-pressed', 'true');
});
