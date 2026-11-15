/**
 * Термин-бокс — чистая доменная логика режима терминовки.
 *
 * Терминовка — это режим, в котором приложение НЕ играет само, а слушает:
 * пользователь отбивает ритм руками (жестами), приложение квантует каждый
 * жест до доли цикла и записывает его в 4×8 сетку ударных.
 *
 * Модуль содержит только ЧИСТЫЕ функции (никаких сигналов Solid, никакого
 * аудио, никаких таймеров) — их можно тестировать детерминированно:
 *
 *   - маппинг «жест → строка сетки» (TERM_GESTURE_ROWS);
 *   - прогресс записи относительно целевой длины (termProgress);
 *   - сборка сетки из записанных попаданий (buildTermGrid).
 *
 * Целевая длина — это число УДАРОВ, а не число тактов: см.
 * `docs/hand-gesture-control-goal.md` — «ты отбиваешь ладонью (или щипком)
 * ритм — 4 удара, 8 ударов, — и wavecode заполняет сетку твоим ритмом».
 *
 * См. также `docs/hand-gesture-control-design.md` §3 (режим терминовки).
 */

import {
  GRID_COLS,
  GRID_ROWS,
  emptyGrid,
  setCell,
  type Grid,
  type GridRowSample,
} from '~/domain/music/gridTypes';
import type { GestureName } from './types';

/**
 * Маппинг «жест → строка 4×8 сетки» в режиме терминовки.
 *
 * Жест выбирает СТРОКУ (барабан), а колонку выбирает квантование по
 * позиции в цикле. Один жест — одна строка, чтобы ритм читался глазами.
 *
 *   щипок   → бочка        (bd)
 *   кулак   → малый барабан (sd)
 *   ладонь  → хай-хэт      (hh)
 *   щелчок  → хлоп         (cp)
 *
 * `pointUp` в маппинге нет: указательный палец вверх — это не удар, а
 * непрерывное событие, и в ритм он не попадает.
 */
export type TermGestureRow = {
  /** The discrete gesture that writes into the row. */
  readonly gesture: GestureName;
  /** The drum row of the 4×8 grid the gesture writes into. */
  readonly sample: GridRowSample;
  /** Short Russian label of the gesture (for the legend). */
  readonly label: string;
};

/** The full gesture → row mapping, in the order the rows are displayed. */
export const TERM_GESTURE_ROWS: ReadonlyArray<TermGestureRow> = [
  { gesture: 'pinch', sample: 'bd', label: 'щипок' },
  { gesture: 'fist', sample: 'sd', label: 'кулак' },
  { gesture: 'openPalm', sample: 'hh', label: 'ладонь' },
  { gesture: 'snap', sample: 'cp', label: 'щелчок' },
];

/** Russian labels of the grid rows (the legend of the term box). */
export const TERM_ROW_LABELS: Readonly<Record<GridRowSample, string>> = {
  bd: 'бочка',
  sd: 'малый барабан',
  hh: 'хай-хэт',
  cp: 'хлоп',
};

/**
 * Which grid row a gesture writes into.
 *
 * @returns the row sample, or `null` when the gesture is not a rhythmic hit
 *   (`pointUp`).
 */
export const termSampleForGesture = (gesture: GestureName): GridRowSample | null => {
  const row = TERM_GESTURE_ROWS.find((candidate) => candidate.gesture === gesture);
  return row === undefined ? null : row.sample;
};

/** One recorded hit of the term mode. */
export type TermHit = {
  /** Which drum row of the 4×8 grid the hit lands on. */
  readonly sample: GridRowSample;
  /** Column (0..7) of the 4×8 grid. */
  readonly col: number;
  /** Cycle index the hit was quantised to. */
  readonly cycleIndex: number;
  /** Offset inside the cycle (ms). */
  readonly offsetMs: number;
  /** Wall-clock timestamp of the raw gesture (ms). */
  readonly tsMs: number;
};

/** Target lengths (in hits) the user can pick. */
export const TERM_TARGET_OPTIONS = [4, 8, 16] as const;

/** A selectable target length (number of hits). */
export type TermTarget = (typeof TERM_TARGET_OPTIONS)[number];

/** The default target length — 8 hits (two bars of eighths). */
export const TERM_TARGET_DEFAULT: TermTarget = 8;

/** Is the value one of the offered target lengths? */
export const isTermTarget = (value: number): value is TermTarget =>
  (TERM_TARGET_OPTIONS as ReadonlyArray<number>).includes(value);

/** Progress of the recording against the chosen target length. */
export type TermProgress = {
  /** The target length (number of hits). */
  readonly target: number;
  /** How many hits are recorded. */
  readonly hits: number;
  /** How many hits are still missing (0 when complete). */
  readonly remaining: number;
  /** True when the target length is reached. */
  readonly complete: boolean;
  /** How many cycles the recorded hits touch. */
  readonly cycles: number;
  /** Hits per grid row (same order as `GRID_ROWS`). */
  readonly rows: ReadonlyArray<number>;
};

/**
 * Progress of the recording.
 *
 * @param hits the recorded hits
 * @param target the target length (number of hits)
 */
export const termProgress = (
  hits: ReadonlyArray<TermHit>,
  target: number,
): TermProgress => {
  const count = hits.length;
  const rows = GRID_ROWS.map((sample) => hits.filter((hit) => hit.sample === sample).length);
  const cycles = hits.reduce((max, hit) => Math.max(max, hit.cycleIndex + 1), 0);
  return {
    target,
    hits: count,
    remaining: Math.max(0, target - count),
    complete: count >= target,
    cycles,
    rows,
  };
};

/**
 * Build the 4×8 grid out of the recorded hits.
 *
 * The grid holds ONE cycle, so hits of different cycles fold onto the same
 * cells — the pattern written into the score is a one-cycle loop, exactly
 * like the grid the user sees in the editor.
 */
export const buildTermGrid = (hits: ReadonlyArray<TermHit>): Grid => {
  let grid = emptyGrid();
  for (const hit of hits) {
    const row = GRID_ROWS.indexOf(hit.sample);
    if (row < 0) continue;
    if (hit.col < 0 || hit.col >= GRID_COLS) continue;
    grid = setCell(grid, row, hit.col, true);
  }
  return grid;
};

/** Is the cell (row, col) of the grid active? */
export const isTermCellActive = (grid: Grid, row: number, col: number): boolean =>
  grid[row]?.[col] === true;
