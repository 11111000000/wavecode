import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';
import { TOOLS_OPENER } from './support/toolsSheet';

/**
 * wavecode-zen-minimal-ui (ревизия 2, пункт 12) — достижимость
 * инструментов.
 *
 * Реестр инструментов — единственный источник правды о навигации.
 * Здесь мы проверяем, что обещанная структура действительно есть:
 *
 *   - рельс из трёх базовых пунктов (Нотная, Шаги, ИИ);
 *   - один лист «Инструменты» со всем остальным и поиском;
 *   - палитра команд по ⌘K / Ctrl+K, находящая тот же инструмент;
 *   - каждый инструмент второго уровня открывается из листа.
 *
 * wavecode-unified-input-entry: «Ввод» ушёл из рельса в tier 2. В
 * рельсе он стоял рядом с «ИИ», и оба читались как «два способа
 * получить музыку», хотя это разные категории: ИИ — адресат, Ввод —
 * способ захвата. Теперь ввод открывает круглая кнопка «Ввод».
 *
 * wavecode-pinned-tools: владелец пожаловался на дублирование («вот
 * вкладка, которая открывает непонятно как что») и на то, что
 * часто используемые инструменты спрятаны за два клика. Отсюда
 * три проверки ниже:
 *
 *   - вход в лист ОДИН (было две кнопки на один лист);
 *   - лист не повторяет рельс (было три карточки, совпадавшие с
 *     рельсом);
 *   - булавка на карточке переносит инструмент в рельс, и закрепление
 *     переживает перезагрузку.
 *
 * Если кто-то спрячет инструмент, вернёт восемь вкладок или добавит
 * вторую кнопку «Инструменты» — тест упадёт здесь, а не в жалобе
 * пользователя.
 */

const RAIL_ITEMS = ['Нотная', 'Шаги', 'ИИ'];

/** Инструменты второго уровня — те, что живут в листе. */
const SHEET_ITEMS = ['Ввод', 'Пианино', 'Микшер', 'Визуализация', 'Экспорт', 'Консоль'];

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

  test('вход в лист один — кнопка «Ещё» в рельсе', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    // Было две кнопки «Инструменты»: «Ещё» в рельсе и иконка-сетка
    // в верхней панели. Обе открывали один и тот же лист.
    await expect(page.locator('[aria-label="Инструменты"]')).toHaveCount(1);
    await expect(page.locator(TOOLS_OPENER)).toBeVisible();

    // В верхней панели входа в лист больше нет.
    await expect(page.locator('.wc-topbar [aria-label="Инструменты"]')).toHaveCount(0);
  });

  test('лист «Инструменты» содержит поиск и карточки', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator(TOOLS_OPENER).first().click();
    await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.wc-tools-sheet__search input')).toBeVisible();

    // Лист держит ТОЛЬКО инструменты второго уровня: 6 карточек.
    // Базовые три (Нотная, Шаги, ИИ) живут в рельсе и в листе не
    // повторяются — раньше они там были, и это было то самое
    // дублирование, на которое пожаловался владелец.
    await expect(page.locator('.wc-tool-card')).toHaveCount(SHEET_ITEMS.length);

    for (const label of RAIL_ITEMS) {
      await expect(page.locator('.wc-tool-card', { hasText: label })).toHaveCount(0);
    }

    await page.locator('.wc-tools-sheet__search input').fill('микшер');
    await expect(page.locator('.wc-tool-card')).toHaveCount(1);
    await expect(page.locator('.wc-tool-card').first()).toContainText('Микшер');
  });

  test('поиск в листе находит и базовый инструмент рельса', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator(TOOLS_OPENER).first().click();
    await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });

    // Закрепление не должно ломать достижимость: «Нотная» ищется и
    // находится — но с заблокированной булавкой («уже в рельсе»).
    await page.locator('.wc-tools-sheet__search input').fill('нотная');
    await expect(page.locator('.wc-tool-card')).toHaveCount(1);
    await expect(page.locator('.wc-tool-card').first()).toContainText('Нотная');

    const pin = page.locator('.wc-tool-card__pin').first();
    await expect(pin).toHaveAttribute('aria-disabled', 'true');
  });

  test('инструмент из листа открывается', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator(TOOLS_OPENER).first().click();
    await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });
    await page.locator('.wc-tool-card', { hasText: 'Микшер' }).first().click();

    await expect(page.locator('.wc-tools-sheet')).toHaveCount(0);
    await expect(page.locator('.wc-sheet[data-kind="mixer"]')).toBeVisible({ timeout: 5_000 });
  });

  test('булавка переносит инструмент в рельс и переживает перезагрузку', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator(TOOLS_OPENER).first().click();
    await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });

    const mixerPin = page
      .locator('.wc-tool-card', { hasText: 'Микшер' })
      .locator('xpath=..')
      .locator('.wc-tool-card__pin');
    await expect(mixerPin).toHaveAttribute('aria-pressed', 'false');

    // Галочка на карточке «Микшер».
    await mixerPin.click();

    // Инструмент появился в рельсе.
    await expect(page.locator('.wc-rail__item[aria-label="Микшер"]')).toHaveCount(1);
    await expect(page.locator('.wc-rail__item')).toHaveCount(4);

    // И пережил перезагрузку страницы.
    await page.reload();
    await page.waitForSelector('main.app', { timeout: 10_000 });
    await expect(page.locator('.wc-rail__item[aria-label="Микшер"]')).toHaveCount(1);
    await expect(page.locator('.wc-rail__item')).toHaveCount(4);
  });

  test('закрепление снимается тем же переключателем', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    await page.locator(TOOLS_OPENER).first().click();
    await expect(page.locator('.wc-tools-sheet')).toBeVisible({ timeout: 5_000 });

    const mixerCell = page.locator('.wc-tool-card', { hasText: 'Микшер' }).locator('xpath=..');
    await mixerCell.locator('.wc-tool-card__pin').click();
    await expect(page.locator('.wc-rail__item[aria-label="Микшер"]')).toHaveCount(1);

    await mixerCell.locator('.wc-tool-card__pin').click();
    await expect(page.locator('.wc-rail__item[aria-label="Микшер"]')).toHaveCount(0);
    await expect(page.locator('.wc-rail__item')).toHaveCount(3);
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

test.describe('мобильный рельс', () => {
  test.use({ viewport: { width: 412, height: 900 } });

  test('кнопка «Ещё» есть и на мобиле', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('main.app', { timeout: 10_000 });

    // Раньше на мобиле рельс скрывал «Ещё», а вход в лист жил в
    // верхней панели. Теперь вход один — и он внизу.
    await expect(page.locator(TOOLS_OPENER)).toBeVisible();
    await expect(page.locator('[aria-label="Инструменты"]')).toHaveCount(1);
  });
});
