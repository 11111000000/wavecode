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
