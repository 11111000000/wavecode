import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';
import { selectPreset, ensurePlaying } from './support/toolsSheet';

/**
 * wavecode-step-grid-modes — e2e regression suite (supersedes
 * wavecode-step-append-sync's button-name expectations).
 *
 * The StepGrid is now mode-driven. The "↑ load & play" button is
 * replaced by "↑ записать (N)" which only appears in sketch mode.
 * Before clicking it, the test must switch the mode pill to
 * «черновик».
 *
 * Verifies the user-visible promise:
 *   - «просмотр» (view) — режим по умолчанию; нажатие на ячейки
 *     НЕ портит загруженную композицию (previewSample, без мутации).
 *   - «черновик» (sketch) + ↑ записать: score становится объединённым
 *     стеком.
 *   - «правка» (edit) (при 4 s-слоях) — нажатие вклеивает строку
 *     s("…") на место.
 */

const openStepGrid = async (page: import('@playwright/test').Page) => {
  await page.locator('.wc-rail__item[aria-label="Шаги"]').first().click();
  await page.waitForSelector('.step-grid', { timeout: 5_000 });
};

const enterSketchMode = async (page: import('@playwright/test').Page): Promise<void> => {
  const btn = page.locator('.step-grid-mode-btn', { hasText: 'черновик' });
  await btn.click();
};

const enterEditMode = async (page: import('@playwright/test').Page): Promise<void> => {
  const btn = page.locator('.step-grid-mode-btn', { hasText: 'правка' });
  // The button is disabled if score is not 4-s-layer stack.
  await btn.click();
};

const clickCommit = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.locator('[data-testid="step-grid-commit"]').click();
};

/**
 * Состояние аудио живёт в статус-кластере верхней панели (фаза 6):
 * `dl.status-grid` больше не в потоке, а в кластере — честный
 * `audio.status` («играет» / «ошибка» / «пауза»), а не состояние
 * AudioContext.
 */
const audioStatus = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="status-audio"]').textContent();

test('view mode: tapping a cell does NOT clobber the loaded preset', async ({ page }) => {
  const consoleLogs: string[] = [];
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  // Load "creep" preset (в листе «Инструменты»).
  await selectPreset(page, 'creep');
  await expect(page.locator('.cm-content')).toContainText('Creep');

  // Start audio so audio.status reports 'playing'. Выбор композиции
  // уже запускает воспроизведение — жмём «Запуск» только если не
  // играет (иначе остановили бы только что запущенное).
  await ensurePlaying(page);
  await page.waitForTimeout(2_000);
  const statusBefore = (await audioStatus(page)) ?? '';
  expect(statusBefore).toContain('играет');

  // Open the step sequencer (view mode is the default).
  await openStepGrid(page);

  // Tap two cells (kick row 0 col 0, snare row 1 col 1).
  const cells = page.locator('.step-cell');
  await cells.nth(0).click(); // bd step 1
  await cells.nth(9).click(); // sd step 2

  // Give the audio engine a moment to potentially rebuild scheduler.
  await page.waitForTimeout(2_000);
  const statusAfter = (await audioStatus(page)) ?? '';
  // Audio must still be playing — previewSample does NOT touch the scheduler.
  expect(statusAfter).toContain('играет');

  // Original Creep content must still be in the editor (not replaced by grid snippet).
  const editorText = (await page.locator('.cm-content').textContent()) ?? '';
  expect(editorText).toContain('Creep');

  consoleLogs.forEach((l) => console.log(l));
});

test('sketch mode + ↑ commit with a loaded preset wraps grid layers into the existing stack', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  await selectPreset(page, 'creep');
  await expect(page.locator('.cm-content')).toContainText('Creep');

  await openStepGrid(page);
  await enterSketchMode(page);

  // Tap a few cells to make the grid snippet non-trivial.
  const cells = page.locator('.step-cell');
  await cells.nth(0).click(); // bd step 1
  await cells.nth(9).click(); // sd step 2
  await cells.nth(18).click(); // hh step 3

  // Click ↑ commit.
  await clickCommit(page);

  // Wait for the new score to flush through CodeMirror.
  await page.waitForTimeout(1_500);

  const text = (await page.locator('.cm-content').textContent()) ?? '';
  // The original Creep comment must still be present.
  expect(text).toContain('Creep');
  // Сетка дописана ВНУТРЬ нового stack(...) вместе с исходной Creep:
  // исходная композиция начинается с cat(...), а не со stack(...), так
  // что merge оборачивает оба в общий stack — это видно по ведущему
  // `stack(`.
  expect(text.trimStart().startsWith('stack(')).toBe(true);

  // Контракт черновика: draft засевается из партитуры (см.
  // enterSketch в gridState.ts), поэтому нажатие переключает ячейку, а
  // не зажигает её с нуля. Тут важны две строки, которые доказывают,
  // что нажатия легли именно туда, куда кликнули:
  //   - ряд sd: клик по (1,1) → «sd sd …»
  //   - ряд hh: клик по (2,2) → «hh ~ hh …»
  // У bb-ряда клик снял засеянную ячейку, поэтому он пустой.
  expect(text).toMatch(/s\("sd sd ~ ~ ~ ~ ~ ~"\)/);
  expect(text).toMatch(/s\("hh ~ hh ~ ~ ~ ~ ~"\)/);
});

test('empty editor + sketch + ↑ commit equals standalone grid snippet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  // Clear the editor.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');

  await openStepGrid(page);
  await enterSketchMode(page);
  const cells = page.locator('.step-cell');
  await cells.nth(0).click();
  await cells.nth(9).click();
  await clickCommit(page);
  await page.waitForTimeout(800);

  const text = (await page.locator('.cm-content').textContent()) ?? '';
  expect(text).toMatch(/^stack\(/);
  expect(text).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\)/);
  expect(text).toMatch(/s\("~ sd ~ ~ ~ ~ ~ ~"\)/);
});

test('edit mode per-tap splices the s("…") row in place (no double-wrap)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForSelector('.cm-content', { timeout: 15_000 });

  // Replace the editor with a clean 4-s-layer score so edit mode is enabled.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  const cleanScore = [
    'stack(',
    '  s("~ ~ ~ ~ ~ ~ ~ ~"),',
    '  s("~ ~ ~ ~ ~ ~ ~ ~"),',
    '  s("~ ~ ~ ~ ~ ~ ~ ~"),',
    '  s("~ ~ ~ ~ ~ ~ ~ ~")',
    ')',
  ].join('\n');
  await page.keyboard.type(cleanScore);
  await page.waitForTimeout(300);

  await openStepGrid(page);
  await enterEditMode(page);

  // Tap a single cell (bd row 0 col 0).
  const cells = page.locator('.step-cell');
  await cells.nth(0).click();
  await page.waitForTimeout(300);

  const text = (await page.locator('.cm-content').textContent()) ?? '';
  // The first s-row now has bd on step 1.
  expect(text).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\)/);
  // No double-wrap: exactly one outer stack.
  expect((text.match(/stack\(/g) ?? []).length).toBe(1);
});
