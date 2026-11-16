import { expect, type Page } from '@playwright/test';

/**
 * support/toolsSheet.ts — хелперы для листа «Инструменты».
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6): выбор композиции уехал из
 * транспортной строки в лист «Инструменты» (см. PresetPicker.tsx), а
 * строка транспорта теперь это ровно «play · темп · позиция».
 *
 * wavecode-pinned-tools: у листа остался ОДИН вход — кнопка «Ещё» в
 * рельсе. Раньше их было два: тот же «Ещё» внизу и голая иконка-сетка
 * в верхней панели. Верхняя открывала ровно тот же лист и выглядела
 * как «кнопка, которая открывает непонятно что». Теперь вход один и
 * он стоит рядом с инструментами, которыми этот лист управляет.
 *
 * Лист закрывается сразу после выбора композиции: пользователь выбрал
 * композицию — он хочет видеть и слышать её, а не перекрытый лист.
 */

/** Кнопка «Ещё» в рельсе — единственный вход в лист «Инструменты». */
export const TOOLS_OPENER = '.wc-rail__more';

/** Открыть лист «Инструменты». */
export async function openToolsSheet(page: Page): Promise<void> {
  const opener = page.locator(TOOLS_OPENER).first();
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
  await page.locator(TOOLS_OPENER).first().click();
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
