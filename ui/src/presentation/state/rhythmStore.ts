/**
 * rhythmStore — состояние ритм-ввода: темп, сетка тапов, живой take.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 10): голос и ритм — два
 * явных режима ОДНОГО входного дока. Ритм пришёл из ветки
 * `feat/rhythm-recorder`, где он был микрофонным детектором ударов
 * (`domain/audio/rhythmGrid.ts` + `RhythmMiniFAB`). Здесь микрофона
 * нет: шаги простукиваются ПАЛЬЦЕМ по сетке, а квантование делает
 * сама сетка. Поэтому генератор паттерна написан здесь, в
 * presentation-слое: доменный `rhythmGrid` работает с отметками
 * времени микрофона, а у нас на входе — 16 булевых шагов.
 *
 * Что здесь есть
 * ---------------
 *   - темп (BPM) с клампингом в разумные границы;
 *   - сетка из 16 шагов (4×4): строка сетки = одна доля;
 *   - «take»: идёт ли отсчёт и проход по шагам;
 *   - генератор: 16 булевых шагов → фрагмент Strudel.
 *
 * Запись в партитуру — тем же путём, что и у микрофонного дока
 * (`micStore.applyToScore`): `appendToTopStack` + `dispatch({type:
 * 'replaceScore'})`. Нового пути сохранения не заводим.
 */

import { createSignal } from 'solid-js';
import { appendToTopStack } from '~/domain/strudel';
import { appStore, dispatch } from './appStore';
import { consoleStore } from '~/presentation/components/consoleStore';

/** Шагов в такте: 16 шестнадцатых = 4 доли. */
export const RHYTHM_STEPS = 16;

/** Колонок в сетке: 4 — строка сетки ровно одна доля. */
export const RHYTHM_COLUMNS = 4;

/** Границы темпа, BPM. Ниже 40 и выше 240 — уже не «ритм», а шум. */
export const MIN_RHYTHM_BPM = 40;
export const MAX_RHYTHM_BPM = 240;

/** Темп по умолчанию — как транспорт приложения (cps 0.5 → 120 BPM). */
export const DEFAULT_RHYTHM_BPM = 120;

/** Долей отсчёта перед первым шагом take. */
export const COUNT_IN_BEATS = 1;

/**
 * Голос на шаге.
 *
 * В микрофонной ветке голос определялся спектром удара (kick → бочка,
 * snare → малый). Здесь ударов нет — есть ПОЗИЦИЯ шага, и она тоже
 * однозначно говорит, какой инструмент уместен:
 *
 *   шаги 0 и 8   — доли такта        → бочка
 *   шаги 4 и 12  — сильная доля 2 и 4 → малый барабан
 *   остальные    — слабые доли        → хэт
 *
 * Правило детерминированное: один и тот же тап всегда даёт один и
 * тот же фрагмент, и сетка читается так же, как в посте.
 */
const STEP_VOICE: readonly string[] = Array.from(
  { length: RHYTHM_STEPS },
  (_, i) => {
    if (i % 8 === 4) return 'drums_sd';
    if (i % 4 === 0) return 'drums_bd';
    return 'drums_hh';
  },
);

/* ── состояние ──────────────────────────────────────────────────────── */

const emptyPattern = (): boolean[] =>
  new Array<boolean>(RHYTHM_STEPS).fill(false);

/** Темп take, BPM. */
export const [rhythmTempoBpm, setRhythmTempoBpm] = createSignal<number>(
  DEFAULT_RHYTHM_BPM,
);

/** Сетка: 16 шагов, `true` — шаг простучан. */
export const [rhythmSteps, setRhythmSteps] = createSignal<ReadonlyArray<boolean>>(
  emptyPattern(),
);

/** Идёт ли take (отсчёт или проход по шагам). */
export const [rhythmRunning, setRhythmRunning] = createSignal<boolean>(false);

/** Шаг, на котором сейчас стоит указатель. */
export const [rhythmPlayStep, setRhythmPlayStep] = createSignal<number>(0);

/** Долей отсчёта, осталось. `0` — отсчёт кончился. */
export const [rhythmCountIn, setRhythmCountIn] = createSignal<number>(0);

/* ── темп ───────────────────────────────────────────────────────────── */

/**
 * Клампинг темпа в разумный диапазон.
 *
 * Чистая функция: значение не из сети и не из ввода, а из кнопок
 * «−/＋» и из состояния — но даже кнопка должна уметь выйти за
 * границы (зажать «−» на 200 нажатий), поэтому граница жёсткая.
 */
export const clampRhythmBpm = (bpm: number): number => {
  if (!Number.isFinite(bpm)) return DEFAULT_RHYTHM_BPM;
  return Math.min(MAX_RHYTHM_BPM, Math.max(MIN_RHYTHM_BPM, Math.round(bpm)));
};

/** Длительность шага (шестнадцатой) при текущем темпе, мс. */
export const rhythmStepMs = (): number => 60000 / rhythmTempoBpm() / 4;

/** Длительность доли при текущем темпе, мс. */
export const rhythmBeatMs = (): number => 60000 / rhythmTempoBpm();

/** Поставить темп. Границы клампятся, часы take перезапускаются. */
export const setRhythmTempo = (bpm: number): void => {
  const next = clampRhythmBpm(bpm);
  if (next === rhythmTempoBpm()) return;
  setRhythmTempoBpm(next);
  if (rhythmRunning()) restartStepTimer();
};

/** Сдвинуть темп на `delta` BPM (кнопки «−/＋»). */
export const nudgeRhythmTempo = (delta: number): void => {
  setRhythmTempo(rhythmTempoBpm() + delta);
};

/* ── сетка ──────────────────────────────────────────────────────────── */

/** Поставить/снять шаг. Выход за границы — игнор, а не исключение. */
export const setRhythmStepAt = (index: number, on: boolean): void => {
  if (!Number.isInteger(index) || index < 0 || index >= RHYTHM_STEPS) return;
  setRhythmSteps((prev) => {
    if (prev[index] === on) return prev;
    const next = prev.slice();
    next[index] = on;
    return next;
  });
};

/** Переключить шаг (тап по клетке сетки). */
export const toggleRhythmStep = (index: number): void => {
  const current = rhythmSteps()[index] ?? false;
  setRhythmStepAt(index, !current);
};

/* ── take ───────────────────────────────────────────────────────────── */

let stepTimer: number | null = null;
let countInTimer: number | null = null;

const hasWindow = typeof window !== 'undefined';

const clearStepTimer = (): void => {
  if (stepTimer !== null) {
    window.clearInterval(stepTimer);
    stepTimer = null;
  }
};

const clearCountInTimer = (): void => {
  if (countInTimer !== null) {
    window.clearInterval(countInTimer);
    countInTimer = null;
  }
};

/**
 * Часы шагов: указатель идёт по сетке со скоростью 1/16.
 *
 * Это тот же «указатель», что в микрофонной ветке: удары клали на
 * сетку transport'а — здесь сетка едет сама, а палец отмечает шаги.
 */
const restartStepTimer = (): void => {
  clearStepTimer();
  if (!rhythmRunning() || !hasWindow) return;
  stepTimer = window.setInterval(() => {
    setRhythmPlayStep((s) => (s + 1) % RHYTHM_STEPS);
  }, rhythmStepMs());
};

/**
 * Начать take: отсчёт, затем проход по шагам.
 *
 * Сетка при этом НЕ сбрасывается — take это проход по редактируемой
 * сетке, а не новая запись поверх старой. Сбросить паттерн — кнопка
 * «Очистить».
 */
export const startRhythmTake = (): void => {
  if (rhythmRunning()) return;
  clearStepTimer();
  clearCountInTimer();
  setRhythmPlayStep(0);
  setRhythmRunning(true);
  setRhythmCountIn(COUNT_IN_BEATS);
  if (!hasWindow) return;
  let left = COUNT_IN_BEATS;
  countInTimer = window.setInterval(() => {
    left -= 1;
    if (left > 0) {
      setRhythmCountIn(left);
      return;
    }
    clearCountInTimer();
    setRhythmCountIn(0);
    restartStepTimer();
  }, rhythmBeatMs());
};

/** Остановить take. Сетка остаётся — её можно применить. */
export const stopRhythmTake = (): void => {
  clearStepTimer();
  clearCountInTimer();
  setRhythmRunning(false);
  setRhythmCountIn(0);
  setRhythmPlayStep(0);
};

/**
 * Тап по кнопке ввода.
 *
 * Take не идёт — начинаем (с отсчёта). Идёт — отмечаем текущий шаг.
 * Микрофон здесь не открывается: ритм — это пальцы по сетке.
 */
export const tapRhythmStep = (): void => {
  if (!rhythmRunning()) {
    startRhythmTake();
    return;
  }
  // Во время отсчёта take ещё не начался — тап пока некуда падать.
  if (rhythmCountIn() > 0) return;
  setRhythmStepAt(rhythmPlayStep(), true);
};

/** Очистить take: сетка пуста, часы остановлены. */
export const clearRhythmTake = (): void => {
  stopRhythmTake();
  setRhythmSteps(emptyPattern());
};

/* ── генератор паттерна ─────────────────────────────────────────────── */

/**
 * Сетка → фрагмент Strudel.
 *
 * Чистая функция: на входе 16 булевых шагов и темп, на выходе —
 * строка, которую можно положить в партитуру. `null` означает
 * «нечего применять» (пустая сетка).
 *
 * Темп применяется так: `setCpm(bpm / 4)` — по конвенции приложения
 * (1 cycle = 1 такт = 4 доли, `cps = bpm / 240`, а `setCpm` ждёт
 * циклы в минуту). Та же формула, что у микрофонной записи
 * (`domain/audio/micCapture.ts`).
 */
export const rhythmPatternToSnippet = (
  steps: ReadonlyArray<boolean>,
  bpm: number,
): string | null => {
  if (steps.length < RHYTHM_STEPS) return null;
  const cells = steps.slice(0, RHYTHM_STEPS);
  if (!cells.some((on) => on === true)) return null;
  const tokens = cells.map((on, i) =>
    on === true ? (STEP_VOICE[i] ?? 'drums_hh') : '~',
  );
  const cpm = clampRhythmBpm(bpm) / 4;
  return `setCpm(${cpm.toFixed(3)}).s("${tokens.join(' ')}")`;
};

/**
 * Применить take к партитуре.
 *
 * Тот же путь, что у микрофонного дока: `appendToTopStack` вставляет
 * слой в верхний `stack(...)`, `dispatch({type: 'replaceScore'})`
 * записывает результат в редактор. Нового пути сохранения нет.
 */
export const applyRhythmToScore = (): boolean => {
  const snippet = rhythmPatternToSnippet(rhythmSteps(), rhythmTempoBpm());
  if (snippet === null) {
    consoleStore.pushToast({
      severity: 'warn',
      title: 'Ритм',
      body: 'Сетка пуста — простучите хотя бы один шаг.',
    });
    return false;
  }
  const result = appendToTopStack(appStore.score, snippet);
  if (!result.ok) {
    consoleStore.pushToast({
      severity: 'warn',
      title: 'Не удалось вставить ритм',
      body: 'В score незакрытая скобка stack(...) — исправьте синтаксис и повторите.',
    });
    return false;
  }
  dispatch({ type: 'replaceScore', text: result.score });
  // Паттерн применён — сетка чистая, чтобы кнопка «Применить» не
  // вставила тот же ритм второй раз (как в микрофонной ветке).
  clearRhythmTake();
  consoleStore.pushToast({
    severity: 'info',
    title: 'Ритм',
    body: 'Паттерн добавлен в партитуру.',
  });
  return true;
};

/** Тест-only: сбросить состояние модуля. */
export const __resetRhythmForTests = (): void => {
  clearStepTimer();
  clearCountInTimer();
  setRhythmTempoBpm(DEFAULT_RHYTHM_BPM);
  setRhythmSteps(emptyPattern());
  setRhythmRunning(false);
  setRhythmPlayStep(0);
  setRhythmCountIn(0);
};
