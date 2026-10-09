import { createSignal } from 'solid-js';
import {
  emptyGrid,
  toggleCell,
  setCell,
  gridToScore,
  isGridEmpty,
  type Grid,
  GRID_ROWS,
  GRID_COLS,
} from '~/domain/music/gridTypes';

/**
 * Step Grid reactive state.
 *
 * Holds the current 4×8 drum-pad layout. `gridToScore(grid)` synthesizes
 * a Strudel `stack(...)` snippet. Used by <StepGrid /> UI; loaded back
 * into the main score via `loadToScore()` dispatch.
 */

const [grid, setGrid] = createSignal<Grid>(emptyGrid());

export const getGrid = (): Grid => grid();
export const setGridDirect = (g: Grid): void => {
  setGrid(g);
};

export const toggleCellState = (row: number, col: number): Grid => {
  const next = toggleCell(grid(), row, col);
  setGrid(next);
  return next;
};

export const clearGridState = (): void => {
  setGrid(emptyGrid());
};

/** Load a Strudel snippet back into grid (best-effort: parses `s("...")` rows). */
export const loadFromScore = (snippet: string): Grid => {
  const rowRegex = /s\(\s*"([^"]+)"\s*\)/g;
  const matches = [...snippet.matchAll(rowRegex)];
  const next: Grid = emptyGrid();
  for (let r = 0; r < GRID_ROWS.length && r < matches.length; r += 1) {
    const tokens = (matches[r]![1] ?? '').trim().split(/\s+/);
    for (let c = 0; c < GRID_COLS && c < tokens.length; c += 1) {
      const tok = tokens[c]!.toLowerCase();
      const isRest = tok === '~' || tok === '.';
      if (!isRest) setCell(next, r, c, true);
    }
  }
  setGrid(next);
  return next;
};

export const isGridEmptyState = (): boolean => isGridEmpty(grid());
export const gridAsScore = (): string => gridToScore(grid());
