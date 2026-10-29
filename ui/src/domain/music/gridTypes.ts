/**
 * Step Grid типы: 4 строки × 8 колонок drum-pad layout.
 * Каждая ячейка = boolean (note on/off). 4 строки = kick / snare /
 * hihat / clap (стандартный GM drum mapping в Strudel).
 */

export type GridRowSample = 'bd' | 'sd' | 'hh' | 'cp';

export const GRID_ROWS: ReadonlyArray<GridRowSample> = ['bd', 'sd', 'hh', 'cp'];
export const GRID_COLS = 8;

export type GridRow = ReadonlyArray<boolean>;
export type Grid = ReadonlyArray<GridRow>;

/** Empty 4×8 grid (all cells off). */
export const emptyGrid = (): Grid =>
  GRID_ROWS.map(() => Array.from({ length: GRID_COLS }, () => false));

/** Set cell at (row, col) to value. Returns a new Grid (immutable). */
export const setCell = (g: Grid, row: number, col: number, value: boolean): Grid =>
  g.map((r, ri) =>
    ri === row ? r.map((c, ci) => (ci === col ? value : c)) : r,
  );

/** Toggle cell at (row, col). */
export const toggleCell = (g: Grid, row: number, col: number): Grid =>
  setCell(g, row, col, !g[row]?.[col]);

/**
 * Synthesize a Strudel snippet from a grid.
 *
 *   bd sd hh cp
 * 1  X  .  X  .
 * 2  .  X  .  .
 * ...
 *
 *   →  stack(
 *        s("bd ~ hh ~ sd ~ hh ~").fast(2),  // (row 0: kick) on step 0,2
 *        s("~ sd ~ ~ ~ sd ~ ~"),            // (row 1: snare) on step 1,5
 *        s("hh hh hh hh hh hh hh hh"),      // (row 2: hihat) on every
 *        s("~ ~ ~ ~ ~ ~ ~ ~")                // (row 3: clap) empty
 *      )
 *
 * The "every step" semantics: each cell in 8-step grid is 1/8 of cycle.
 * `.fast(2)` не нужен — каждый ряд уже 8 hits / 8 шагов = 1 cycle.
 */
export const gridToScore = (g: Grid): string => {
  if (g.length !== GRID_ROWS.length) {
    throw new Error(`grid must have ${GRID_ROWS.length} rows, got ${g.length}`);
  }
  const lines: string[] = ['stack('];
  for (let r = 0; r < GRID_ROWS.length; r += 1) {
    const sample = GRID_ROWS[r]!;
    const cells = g[r]!;
    const tokens: string[] = [];
    for (let c = 0; c < GRID_COLS; c += 1) {
      tokens.push(cells[c] ? sample : '~');
    }
    const indent = '  ';
    lines.push(`${indent}s("${tokens.join(' ')}"),`);
  }
  lines.push(')');
  return lines.join('\n');
};

/** True if grid has at least one active cell. */
export const isGridEmpty = (g: Grid): boolean =>
  g.every((r) => r.every((c) => !c));

/**
 * StepGrid interaction mode.
 *
 * The grid has three orthogonal user intentions that previously
 * looked identical from the UI (just a 4×8 of tappable cells).
 * The mode pill disambiguates what a tap *does*:
 *
 *   - `view`   — read-only mirror of the score. Tap = preview a
 *                drum hit via raw Web Audio. Score and grid state
 *                are NOT modified. Used to inspect "what does my
 *                code look like as a beat?" without danger.
 *   - `sketch` — ephemeral draft buffer. Tap = preview + toggle a
 *                draft cell. Draft is NOT in the score until the
 *                user explicitly presses `↑ commit`. On sheet
 *                close, a confirm dialog appears if the draft
 *                has unsaved changes.
 *   - `edit`   — direct, in-place edit of the 4 `s("…")` rows in
 *                the current top-level `stack(...)`. Every tap
 *                splices the corresponding layer and re-evaluates
 *                the live scheduler (debounced 50ms). Gated on
 *                `parseStackTopLayers` returning exactly 4 layers
 *                whose first token is `s(`; otherwise the mode
 *                button is disabled.
 *
 * See decisions/wavecode-step-grid-modes.yaml for the design rationale.
 */
export type GridMode = 'view' | 'sketch' | 'edit';

export const GRID_MODES: ReadonlyArray<GridMode> = ['view', 'sketch', 'edit'];

/** True if the two grids have identical cell values. */
export const gridsEqual = (a: Grid, b: Grid): boolean => {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r += 1) {
    const ra = a[r];
    const rb = b[r];
    if (!ra || !rb || ra.length !== rb.length) return false;
    for (let c = 0; c < ra.length; c += 1) {
      if (ra[c] !== rb[c]) return false;
    }
  }
  return true;
};

/** Count cells that differ between two grids (0..32). */
export const countGridDiff = (a: Grid, b: Grid): number => {
  let n = 0;
  const rows = Math.min(a.length, b.length);
  for (let r = 0; r < rows; r += 1) {
    const ra = a[r] ?? [];
    const rb = b[r] ?? [];
    const cols = Math.min(ra.length, rb.length);
    for (let c = 0; c < cols; c += 1) {
      if (ra[c] !== rb[c]) n += 1;
    }
  }
  return n;
};
