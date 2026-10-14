import { describe, it, expect } from 'vitest';
import {
  emptyGrid,
  setCell,
  toggleCell,
  gridToScore,
  isGridEmpty,
  gridsEqual,
  countGridDiff,
  GRID_ROWS,
  GRID_COLS,
  GRID_MODES,
} from './gridTypes';

describe('gridTypes', () => {
  it('emptyGrid returns 4×8 of false', () => {
    const g = emptyGrid();
    expect(g).toHaveLength(GRID_ROWS.length);
    for (const row of g) expect(row).toHaveLength(GRID_COLS);
    for (const row of g) for (const c of row) expect(c).toBe(false);
  });

  it('isGridEmpty is true on empty, false after toggleCell', () => {
    const g0 = emptyGrid();
    expect(isGridEmpty(g0)).toBe(true);
    const g1 = toggleCell(g0, 0, 0);
    expect(isGridEmpty(g1)).toBe(false);
  });

  it('setCell is immutable — original stays intact', () => {
    const g0 = emptyGrid();
    const g1 = setCell(g0, 1, 3, true);
    expect(g0[1]?.[3]).toBe(false);
    expect(g1[1]?.[3]).toBe(true);
  });

  it('toggleCell flips, second toggle flips back', () => {
    const g0 = emptyGrid();
    const g1 = toggleCell(g0, 2, 5);
    expect(g1[2]?.[5]).toBe(true);
    const g2 = toggleCell(g1, 2, 5);
    expect(g2[2]?.[5]).toBe(false);
  });

  it('gridToScore synthesizes a valid stack snippet', () => {
    const g = emptyGrid();
    const g1 = setCell(g, 0, 0, true); // bd on step 0
    const g2 = setCell(g1, 1, 1, true); // sd on step 1
    const g3 = setCell(g2, 2, 2, true); // hh on step 2
    const snippet = gridToScore(g3);
    expect(snippet).toContain('stack(');
    expect(snippet).toContain(')');
    // Row 0 (bd) has tokens: bd on step 0, ~ elsewhere (7 rests)
    expect(snippet).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
    // Row 1 (sd) on step 1 (1 hit, 7 rests)
    expect(snippet).toMatch(/s\("~ sd ~ ~ ~ ~ ~ ~"\),/);
    // Row 3 (cp) all rests (8 tokens)
    expect(snippet).toMatch(/s\("~ ~ ~ ~ ~ ~ ~ ~"\),$/m);
  });

  it('gridToScore with all bd active renders bd on every step', () => {
    const g = emptyGrid();
    let gAcc = g;
    for (let c = 0; c < GRID_COLS; c += 1) gAcc = setCell(gAcc, 0, c, true);
    const snippet = gridToScore(gAcc);
    expect(snippet).toMatch(/s\("bd bd bd bd bd bd bd bd"\),$/m);
  });

  it('gridToScore throws on wrong row count', () => {
    expect(() => gridToScore([[true, false, true, false, true, false, true, false]]))
      .toThrow();
  });

  it('gridsEqual: true on identical grids, false on any cell diff', () => {
    const a = emptyGrid();
    const b = emptyGrid();
    expect(gridsEqual(a, b)).toBe(true);
    const c = setCell(a, 0, 0, true);
    expect(gridsEqual(a, c)).toBe(false);
    expect(gridsEqual(c, c)).toBe(true);
  });

  it('gridsEqual: false on different row counts', () => {
    expect(gridsEqual(emptyGrid(), [emptyGrid()[0]!])).toBe(false);
  });

  it('countGridDiff: 0 on identical, N on N diffs', () => {
    const a = emptyGrid();
    expect(countGridDiff(a, a)).toBe(0);
    expect(countGridDiff(a, setCell(a, 0, 0, true))).toBe(1);
    let b = a;
    for (let c = 0; c < GRID_COLS; c += 1) b = setCell(b, 1, c, true);
    expect(countGridDiff(a, b)).toBe(GRID_COLS);
    // 4×8 = 32 cells max
    const all = (() => {
      let g = emptyGrid();
      for (let r = 0; r < GRID_ROWS.length; r += 1)
        for (let c = 0; c < GRID_COLS; c += 1) g = setCell(g, r, c, true);
      return g;
    })();
    expect(countGridDiff(a, all)).toBe(32);
  });

  it('GRID_MODES lists view/sketch/edit in that order', () => {
    expect(GRID_MODES).toEqual(['view', 'sketch', 'edit']);
  });
});
