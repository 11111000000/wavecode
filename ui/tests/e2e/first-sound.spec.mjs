import { test, expect } from '@playwright/test';
import { LANDING_URL } from './support/appUrl';

/**
 * Первый звук — единственная метрика, которую обещает wavecode.
 *
 * Пользователь приходит на лендинг, пишет (или не пишет) слова,
 * жмёт «Создать» и должен услышать музыку. Всё, что стоит между
 * кликом и первым звуком, — это наша задержка: загрузка бандла,
 * монтирование редактора, разблокировка AudioContext, синтез.
 *
 * План wavecode-zen-ui (фаза 7, «Замер») ставит потолок: ≤ 30 секунд
 * с лендинга до первого звука.
 *
 * Звук меряется RMS анализатора, который приложение уже прокидывает
 * в `window.__wavecodeAnalyser` (тот же tap, что у визуализатора) —
 * это не «элемент появился на экране», а настоящий сигнал в миксе.
 *
 * Путь: лендинг → «Создать» → редактор → «Запуск» → ждём сигнал.
 * Стартовая композиция — играбельный барабанный паттерн, а не
 * комментарий (см. NEW_COMPOSITION_TEMPLATE в useRouteGuards.ts),
 * поэтому «Создать» всегда ведёт к настоящему звуку.
 */

/** Потолок из плана: время до первого звука с лендинга. */
const FIRST_SOUND_BUDGET_MS = 30_000;

/** Порог RMS: выше шума тишины, ниже нормального сигнала. */
const RMS_THRESHOLD = 0.02;

test('до первого звука с лендинга — не дольше 30 секунд', async ({ page }) => {
  const startedAt = Date.now();

  await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // «Создать» — путь нового пользователя: слова → композиция → звук.
  await page.locator('button:has-text("Создать")').click();
  await page.waitForSelector('main.app', { timeout: 15_000 });

  // «Запуск» — реальный жест пользователя: без него AudioContext
  // остаётся suspended, и звука не будет в принципе.
  await page.locator('button[aria-label="Запуск"]').click();

  // Ждём появления сигнала в миксе.
  await page.waitForFunction(
    (threshold) => {
      const analyser = window.__wavecodeAnalyser;
      if (!analyser) return false;
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      return Math.sqrt(sum / buf.length) > threshold;
    },
    RMS_THRESHOLD,
    { timeout: FIRST_SOUND_BUDGET_MS, polling: 100 },
  );

  const elapsedMs = Date.now() - startedAt;
  console.log(`первый звук: ${(elapsedMs / 1000).toFixed(1)} с (потолок 30 с)`);

  expect(
    elapsedMs,
    'время от загрузки лендинга до первого звука',
  ).toBeLessThanOrEqual(FIRST_SOUND_BUDGET_MS);
});
