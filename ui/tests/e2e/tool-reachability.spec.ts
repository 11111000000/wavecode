import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';

/**
 * wavecode-zen-minimal-ui (ревизия 2, пункт 12) — достижимость
 * инструментов.
 *
 * Реестр инструментов — единственный источник правды о навигации.
 * Здесь мы проверяем, что обещанная структура действительно есть:
 *
 *   - рельс из трёх пунктов (Нотная, Шаги, ИИ);
 *   - один лист «Инструменты» со всем остальным и поиском;
 *   - палитра команд по ⌘K / Ctrl+K, находящая тот же инструмент;
 *   - каждый инструмент второго уровня открывается из листа.
 *
 * wavecode-unified-input-entry: «Ввод» ушёл из рельса в tier 2. В
 * рельсе он стоял рядом с «ИИ», и оба читались как «два способа
 * получить музыку», хотя это разные категории: ИИ — адресат, Ввод —
 * способ захвата. Теперь ввод открывает круглая кнопка «Ввод».
 *
 * Если кто-то спрячет инструмент или вернёт восемь вкладок — тест
 * упадёт здесь, а не в жалобе пользователя.
 */

const RAIL_ITEMS = ['Нотная', 'Шаги', 'ИИ'];

test.describe('zen navigation', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('рельс показывает ровно три пункта', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    const rail = page.locator('.wc-rail');
    await expect(rail).toBeVisible();
    await expect(rail.locator('.wc-rail__item')).toHaveCount(3);

    for (const label of RAIL_ITEMS) {
      await expect(page.locator(`.wc-rail__item[aria-label="${label}"]`)).toHaveCount(1);
    }

    // «Ввод» в рельсе больше нет — он живёт в листе «Инструменты»
    // и в палитре команд.
    await expect(page.locator('.wc-rail__item[aria-label="Ввод"]')).toHaveCount(0);
  });

  test('восьми вкладок нижней панели больше нет', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });
    await expect(page.locator('.wc-tabbar')).toHaveCount(0);
    await expect(page.locator('.wc-tab')).toHaveCount(0);
  });

  test('лист «Инструменты» содержит поиск и карточки', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator('.wc-topbar [aria-label="Инструменты"]').first().click();
    await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.wc-tools-sheet__search input')).toBeVisible();

    // Лист держит ВСЕ инструменты реестра: 3 из рельса (Нотная, Шаги,
    // ИИ) + 6 второго уровня (ввод, пианино, микшер, визуализация,
    // экспорт, консоль). Плюс поиск сужает список.
    //
    // «Ввод» переехал в tier 2 вместе с уходом из рельса
    // (wavecode-unified-input-entry), а «Микрофон» исчез совсем —
    // свист живёт вкладкой «Свист» листа ввода.
    await expect(page.locator('.wc-tool-card')).toHaveCount(9);

    await page.locator('.wc-tools-sheet__search input').fill('микшер');
    await expect(page.locator('.wc-tool-card')).toHaveCount(1);
    await expect(page.locator('.wc-tool-card').first()).toContainText('Микшер');
  });

  test('инструмент из листа открывается', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator('.wc-topbar [aria-label="Инструменты"]').first().click();
    await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });
    await page.locator('.wc-tool-card', { hasText: 'Микшер' }).first().click();

    await expect(page.locator('.wc-tools-sheet')).toHaveCount(0);
    await expect(page.locator('.wc-sheet[data-kind="mixer"]')).toBeVisible({ timeout: 5_000 });
  });

  test('палитра команд находит инструмент по ⌘K', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('.wc-palette')).toBeVisible({ timeout: 5_000 });

    await page.locator('.wc-palette__input').fill('микшер');
    await expect(page.locator('.wc-palette__item')).toHaveCount(1);

    await page.keyboard.press('Enter');
    await expect(page.locator('.wc-palette')).toHaveCount(0);
    await expect(page.locator('.wc-sheet[data-kind="mixer"]')).toBeVisible({ timeout: 5_000 });
  });
});
