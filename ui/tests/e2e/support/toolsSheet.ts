import { expect, type Page } from '@playwright/test';

/**
 * support/toolsSheet.ts — хелперы для листа «Инструменты».
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6): выбор композиции уехал из
 * транспортной строки в лист «Инструменты» (см. PresetPicker.tsx), а
 * строка транспорта теперь это ровно «play · темп · позиция».
 *
 * Спеки, которым нужно выбрать композицию, раньше делали
 * `page.locator('select.preset-select').selectOption(...)` — селекта
 * в транспортной строке больше нет. Теперь он живёт в листе, который
 * открывается кнопкой «Инструменты» в верхней панели (на мобиле и
 * десктопе это одна и та же кнопка — рельс на мобиле держит только
 * четыре пункта первого уровня).
 *
 * Лист закрывается сразу после выбора композиции: пользователь выбрал
 * композицию — он хочет видеть и слышать её, а не перекрытый лист.
 */

/** Открыть лист «Инструменты». */
export async function openToolsSheet(page: Page): Promise<void> {
  const opener = page.locator('.wc-topbar [aria-label="Инструменты"]').first();
  await opener.click();
  await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });
}

/**
 * Выбрать композицию по id и дождаться, что лист закроется.
 */
export async function selectPreset(page: Page, id: string): Promise<void> {
  await openToolsSheet(page);
  await page.locator('[data-testid="preset-select"]').selectOption(id);
  await expect(page.locator('.wc-tools-sheet')).toHaveCount(0);
}

/**
 * Текущая выбранная композиция (id). Открывает лист, если он закрыт:
 * селект не отрендерен, пока лист закрыт.
 */
export async function currentPresetId(page: Page): Promise<string> {
  await openToolsSheet(page);
  const value = await page.locator('[data-testid="preset-select"]').inputValue();
  await page.locator('.wc-topbar [aria-label="Инструменты"]').first().click();
  return value;
}

/**
 * Дождаться, что музыка играет; если не играет — запустить.
 *
 * Выбор композиции САМ запускает воспроизведение (`loadPresetById` →
 * `evalScore`), поэтому сразу после `selectPreset` кнопка транспорта
 * уже «Стоп». Нажать «Запуск» в этот момент — значит остановить
 * только что запущенную музыку. Сначала ждём статус, и только если он
 * не пришёл — жмём кнопку.
 */
export async function ensurePlaying(page: Page): Promise<void> {
  const status = page.locator('[data-testid="status-audio"]');
  const playing = await expect(status)
    .toContainText('играет', { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (playing) return;
  await page.locator('button[aria-label="Запуск"]').click();
  await expect(status).toContainText('играет', { timeout: 15_000 });
}
