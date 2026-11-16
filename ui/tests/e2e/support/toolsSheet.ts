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

/**
 * Открыть лист «Инструменты», если он ещё закрыт.
 *
 * Идемпотентность — не удобство, а необходимость после
 * wavecode-pinned-tools. Вход в лист теперь один: кнопка «Ещё» в
 * рельсе. Подложка листа (`.wc-sheet-backdrop`, z-sheet) лежит ПОВЕРХ
 * рельса, поэтому пока лист открыт, клик по кнопке рельса
 * перехватывается подложкой. Раньше вход был и в верхней панели, а
 * она над подложкой, — второй клик по ней работал. Теперь повторный
 * клик по рельсу при открытом листе — это таймаут, а не «открыть
 * ещё раз».
 *
 * Семантика «открыть, если закрыто» совпадает с тем, что делает
 * человек: увидеть лист, а не «нажать на кнопку подложки».
 */
export async function openToolsSheet(page: Page): Promise<void> {
  const sheet = page.locator('.wc-tools-sheet');
  if (await sheet.isVisible()) return;
  const opener = page.locator(TOOLS_OPENER).first();
  await opener.click();
  await expect(sheet).toBeVisible({ timeout: 5_000 });
}

/**
 * Закрыть лист «Инструменты».
 *
 * Esc, а не клик по кнопке рельса: кнопка под подложкой, и клик по
 * ней не доедет (см. openToolsSheet). Esc — тот же путь, которым лист
 * закрывает пользователь.
 */
export async function closeToolsSheet(page: Page): Promise<void> {
  const sheet = page.locator('.wc-tools-sheet');
  if ((await sheet.count()) === 0) return;
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
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
  await closeToolsSheet(page);
  return value;
}

/**
 * Открыть лист «Микшер».
 *
 * Микшер — инструмент второго уровня, поэтому живёт в листе
 * «Инструменты». Хелпер открывает лист (если он ещё закрыт) и
 * кликает карточку «Микшер».
 */
export async function openMixer(page: Page): Promise<void> {
  await openToolsSheet(page);
  await page.locator('.wc-tool-card', { hasText: 'Микшер' }).first().click();
  await expect(page.locator('.wc-sheet[data-kind="mixer"]')).toBeVisible({ timeout: 5_000 });
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
