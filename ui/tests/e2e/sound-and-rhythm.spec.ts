import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';
import { selectPreset, openToolsSheet, openMixer } from './support/toolsSheet';

/**
 * wavecode-sound-choice-and-rhythm-feedback — e2e для возможностей,
 * которые раньше были написаны, но не работали или не были видны.
 *
 * Три обещания, которые проверяет этот файл:
 *
 *   1. «Настучать Ритм — ничего не происходит» больше не повторяется:
 *      кнопка «Отметить» живая, применение паттерна слышно и видно
 *      (лист ввода закрывается, партитура содержит паттерн).
 *   2. Инструмент слоя выбирается: в микшере у мелодического слоя есть
 *      селектор, и выбор меняет `.s("…")` В ПАРТИТУРЕ, а не только в
 *      интерфейсе. Раньше ноты всегда играли фортепиано.
 *   3. Сетка «Мелодия» (16×36) смонтирована и достижима из листа
 *      инструментов — компонент был готов, но не был подключён.
 */

/** Открыть лист ввода и перейти на вкладку «Ритм». */
const openRhythmTab = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.locator('[aria-label="Ввод"]').first().click();
  await page.waitForSelector('.input-sheet', { timeout: 5_000 });
  await page.locator('.input-tab', { hasText: 'Ритм' }).click();
  await page.waitForSelector('.rhythm-capture', { timeout: 5_000 });
};

test.describe('ритм', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('кнопка «Отметить» живая и запускает проход', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });

    await openRhythmTab(page);

    // Раньше кнопка была disabled до нажатия «Старт» и на тач-экране
    // это выглядело как «сломалась».
    const tap = page.locator('.rhythm-capture__tap');
    await expect(tap).toBeEnabled();

    await tap.click();
    // Проход пошёл: либо идёт отсчёт, либо уже шаг.
    await expect(page.locator('.rhythm-capture__status')).toContainText(
      /Отсчёт|Идёт/,
      { timeout: 5_000 },
    );
  });

  test('применение паттерна добавляет его в партитуру и закрывает лист', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });
    await page.waitForSelector('.cm-content', { timeout: 15_000 });

    await selectPreset(page, 'creep');
    await expect(page.locator('.cm-content')).toContainText('Creep');

    await openRhythmTab(page);

    // Отмечаем первый шаг (сильная доля — бочка) и применяем.
    await page.locator('.rhythm-capture__step').first().click();
    await expect(page.locator('.rhythm-capture__status')).toContainText('шагов: 1');

    await page.locator('.rhythm-capture__btn--primary').click();

    // Лист ввода закрылся — результат видно, а не спрятан за листом.
    await expect(page.locator('.input-sheet')).toHaveCount(0, { timeout: 5_000 });

    // Паттерн попал в партитуру.
    const text = (await page.locator('.cm-content').textContent()) ?? '';
    expect(text).toContain('Creep');
    expect(text).toMatch(/s\("drums_bd [^"]*"\)/);
  });
});

test.describe('инструмент слоя', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('в микшере у мелодического слоя есть выбор инструмента', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });
    await page.waitForSelector('.cm-content', { timeout: 15_000 });

    await selectPreset(page, 'creep');
    await openMixer(page);

    // Первый слой пресета — мелодический (note(...) с .s("triangle")).
    const select = page.locator('.mixer-row[data-index="0"] .inst-select');
    await expect(select).toHaveCount(1);
    await expect(select).toHaveValue('triangle');
  });

  test('выбор инструмента меняет .s(...) в партитуре', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });
    await page.waitForSelector('.cm-content', { timeout: 15_000 });

    await selectPreset(page, 'creep');
    await openMixer(page);

    const select = page.locator('.mixer-row[data-index="0"] .inst-select');
    await expect(select).toHaveCount(1);
    await select.selectOption('sawtooth');
    await page.waitForTimeout(600);

    // Правка точечная: только слой 0. Остальные слои не тронуты.
    const text = (await page.locator('.cm-content').textContent()) ?? '';
    expect(text).toContain('.s("sawtooth")');
    expect(text).toContain('.s("triangle")');
  });

  test('ударный слой показывает «Сэмпл», а не селектор', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });
    await page.waitForSelector('.cm-content', { timeout: 15_000 });

    await selectPreset(page, 'creep');
    await openMixer(page);

    // Слой 10 — первый барабан в хоре (`s("drums_bd …")`). Он в
    // пятой секции, а секции свёрнуты, кроме первой: раскрываем.
    await page.locator('.mixer-section[data-section="4"] .mixer-section-toggle').click();
    const row = page.locator('.mixer-row[data-index="10"]');
    await expect(row.locator('.mixer-sound-static')).toHaveText('Сэмпл');
    await expect(row.locator('.inst-select')).toHaveCount(0);
  });
});

test.describe('достижимость возможностей', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('лист «Мелодия» открывается из листа инструментов', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });

    await openToolsSheet(page);
    await page.locator('.wc-tool-card', { hasText: 'Мелодия' }).first().click();

    await expect(page.locator('.wc-sheet[data-kind="melody"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.melody-grid')).toBeVisible();
    // Сетка 16×36 = 576 клеток.
    await expect(page.locator('.melody-cell')).toHaveCount(576);
  });

  test('карточка «Руки» открывает лист управления жестами', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });

    await openToolsSheet(page);
    await page.locator('.wc-tool-card', { hasText: 'Руки' }).first().click();

    await expect(page.locator('.wc-sheet[data-kind="gesture"]')).toBeVisible({ timeout: 5_000 });
  });
});
