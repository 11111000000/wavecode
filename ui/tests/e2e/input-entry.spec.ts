import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';

/**
 * Единый ввод — wavecode-unified-input-entry.
 *
 * До правки ввод жил в четырёх местах: круглая кнопка «Голос» (она
 * же REC, она же тап-пад в ритме), пункт рельса «Ввод» (тот же
 * док), пункт листа «Микрофон» (свист) и переключатель «Голос |
 * Ритм» внутри дока. Пользователь не мог отличить «голос записывает
 * мелодию» от «микрофон снимает высоту тона» — обе кнопки назывались
 * устройством, а устройство было одно.
 *
 * Теперь:
 *
 *   - одна круглая кнопка «Ввод» — и она ВСЕГДА открывает лист ввода;
 *   - в листе три вкладки: Речь | Свист | Ритм;
 *   - в рельсе осталось три пункта: Нотная | Шаги | ИИ;
 *   - отдельного инструмента «Микрофон» нет.
 *
 * Тест фиксирует именно эту структуру: если кто-то вернёт старый
 * вход или размножит кнопки, тест упадёт здесь, а не в жалобе
 * пользователя.
 */

const RAIL_ITEMS = ['Нотная', 'Шаги', 'ИИ'];
const INPUT_TABS = ['Речь', 'Свист', 'Ритм'];

test.describe('единый ввод', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('круглая кнопка «Ввод» — единственная точка входа и открывает лист', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    // Ровно одна плавающая кнопка ввода — и она ничего не делает,
    // кроме как открывать лист.
    const fab = page.locator('.voice-mini-fab');
    await expect(fab).toHaveCount(1);
    await expect(page.locator('.voice-mini-fab[aria-label="Ввод"]')).toHaveCount(1);

    // До нажатия листа нет.
    await expect(page.locator('.wc-sheet[data-kind="input"]')).toHaveCount(0);

    await page.locator('.voice-mini-fab[aria-label="Ввод"]').click();
    await expect(page.locator('.wc-sheet[data-kind="input"]')).toBeVisible({ timeout: 5_000 });

    // Кнопка не меняет смысл: она открывает лист, а не начинает
    // запись сама. Признак — `data-state`.
    await expect(page.locator('.voice-mini-fab[data-mode="input"]')).toHaveAttribute('data-state', 'open');
  });

  test('в листе ровно три вкладки — Речь, Свист, Ритм', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator('.voice-mini-fab[aria-label="Ввод"]').click();
    await expect(page.locator('.wc-sheet[data-kind="input"]')).toBeVisible({ timeout: 5_000 });

    const tabs = page.locator('.input-tab');
    await expect(tabs).toHaveCount(3);
    for (const label of INPUT_TABS) {
      await expect(page.locator('.input-tab', { hasText: label })).toHaveCount(1);
    }

    // Полоса вкладок — единственный способ выбрать модальность.
    await expect(page.locator('.input-tabs[role="tablist"]')).toHaveCount(1);
  });

  test('каждая вкладка показывает своё тело и свою кнопку действия', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator('.voice-mini-fab[aria-label="Ввод"]').click();
    await expect(page.locator('.wc-sheet[data-kind="input"]')).toBeVisible({ timeout: 5_000 });

    // «Речь» открыта первой: кнопка записи и статусная строка
    // с глаголом («Готов к записи…» и т.п.).
    await expect(page.locator('.input-tab[data-active="true"]')).toHaveCount(1);
    await expect(page.locator('.input-tab', { hasText: 'Речь' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.speech-input__rec')).toBeVisible();
    await expect(page.locator('.speech-input__status-text')).toBeVisible();

    // «Свист» — микрофон по высоте тона.
    await page.locator('.input-tab', { hasText: 'Свист' }).click();
    await expect(page.locator('.speech-input')).toHaveCount(0);
    await expect(page.locator('.mic-ux-panel')).toBeVisible();

    // «Ритм» — сетка и кнопка «Отметить» (тап-пад уехал из FAB
    // внутрь вкладки: кнопка рядом со тем, что она делает).
    await page.locator('.input-tab', { hasText: 'Ритм' }).click();
    await expect(page.locator('.mic-ux-panel')).toHaveCount(0);
    await expect(page.locator('.rhythm-capture')).toBeVisible();
    await expect(page.locator('.rhythm-capture__tap')).toBeVisible();
  });

  test('старых входов больше нет', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    // «Ввод» ушёл из рельса: рядом с «ИИ» он читался как второй
    // способ получить музыку.
    await expect(page.locator('.wc-rail__item[aria-label="Ввод"]')).toHaveCount(0);
    await expect(page.locator('.wc-rail__item')).toHaveCount(RAIL_ITEMS.length);

    // Отдельного «Микрофона» в листе «Инструменты» нет — свист
    // живёт вкладкой.
    await page.locator('.wc-topbar [aria-label="Инструменты"]').first().click();
    await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.wc-tool-card', { hasText: 'Микрофон' })).toHaveCount(0);

    // «Ввод» в листе есть — и он открывает тот же лист ввода.
    await page.locator('.wc-tool-card', { hasText: 'Ввод' }).first().click();
    await expect(page.locator('.wc-sheet[data-kind="input"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.input-tab')).toHaveCount(3);
  });

  test('лист ввода закрывается по Esc', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator('.voice-mini-fab[aria-label="Ввод"]').click();
    await expect(page.locator('.wc-sheet[data-kind="input"]')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('.wc-sheet[data-kind="input"]')).toHaveCount(0);
  });
});
