import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';
import { selectPreset } from './support/toolsSheet';

/**
 * Переключение композиции = ПОЛНАЯ смена звука.
 *
 * Баг (жалоба юзера): при выборе другой композиции из списка
 * продолжала звучать предыдущая; при создании новой композиции и
 * нажатии Play — тоже звучала предыдущая.
 *
 * Механика: `repl.stop()` останавливает только планировщик Strudel,
 * а уже запланированные WebAudio-голоса доигрывают огибающие
 * (`ambient-drone` — 4–6 секунд). Хуже: `AudioContext.suspend()`
 * замораживает `currentTime`, огибающие замирают и оживают при
 * следующем `resume()` — старая композиция возвращается в момент
 * Play новой.
 *
 * Проверяем через RMS анализатора (тот же tap, что у визуализатора):
 * после переключения на «пустую» композицию в миксе не должно
 * остаться ничего от предыдущей.
 */

/** Custom-пресет с пустым score — после переключения на него звука быть не должно. */
const SILENT_PRESET = {
  id: 'custom-silent-probe',
  name: 'Тишина (probe)',
  score: '// пусто — звука быть не должно\n',
  custom: true,
};

/** RMS текущего выхода (0..1). null — анализатор ещё не создан. */
const readRms = (page) =>
  page.evaluate(() => {
    const analyser = window.__wavecodeAnalyser;
    if (!analyser) return null;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.sqrt(sum / buf.length);
  });

const seedSilentPreset = (page) =>
  page.addInitScript((preset) => {
    localStorage.setItem('wavecode-custom-presets-v1', JSON.stringify([preset]));
  }, SILENT_PRESET);

test.describe('переключение композиции', () => {
  test('старая композиция замолкает при выборе другой из списка', async ({ page }) => {
    await seedSilentPreset(page);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('main.app', { timeout: 15000 });

    // Play — реальный user gesture: без него AudioContext не разблокируется.
    await page.locator('button[aria-label="Запуск"]').click();
    await page.waitForTimeout(500);

    // Длинный хвост: attack 2 / release 4 — идеальный донор «хвоста».
    await selectPreset(page, 'ambient-drone');
    await page.waitForTimeout(3000);

    const playing = await readRms(page);
    expect(playing, 'ambient-drone должен звучать').toBeGreaterThan(0.02);

    // Переключаемся на пустую композицию — старая обязана замолчать.
    await selectPreset(page, SILENT_PRESET.id);
    await page.waitForTimeout(1500);
    const afterSwitch = await readRms(page);
    expect(afterSwitch, 'предыдущая композиция не должна звучать').toBeLessThan(0.01);
  });

  test('новая композиция не воскрешает предыдущую при Play', async ({ page }) => {
    await seedSilentPreset(page);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('main.app', { timeout: 15000 });

    await page.locator('button[aria-label="Запуск"]').click();
    await page.waitForTimeout(500);

    await selectPreset(page, 'ambient-drone');
    await page.waitForTimeout(3000);
    expect(await readRms(page)).toBeGreaterThan(0.02);

    // «Новая композиция» — подтверждение через window.confirm.
    page.once('dialog', (d) => d.accept());
    await page.locator('button[aria-label="Новая"]').click();
    await page.waitForTimeout(1000);

    // Новая композиция — не пустая: с фазы 5 её шаблон играбельный
    // (барабанный паттерн), и «Новая» сразу звучит. Чтобы проверить
    // именно «старая не воскресает», оставляем в партитуре только
    // комментарий: строка непустая, eval проходит, контекст
    // возобновляется — и анализатор отдаёт ЖИВОЙ сигнал, а не
    // замороженный буфер остановленного контекста.
    const cmScroller = page.locator('.cm-scroller').first();
    await cmScroller.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('// тишина');
    await page.waitForTimeout(300);

    // Play на новой (бесшумной) композиции — предыдущая не должна вернуться.
    await page.locator('button[aria-label="Запуск"]').click();
    await page.waitForTimeout(1500);

    const afterPlay = await readRms(page);
    expect(afterPlay, 'новая композиция не должна звучать старым').toBeLessThan(0.01);
  });
});
