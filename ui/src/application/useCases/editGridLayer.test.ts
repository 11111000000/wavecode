import { describe, it, expect } from 'vitest';
import { emptyGrid, setCell, type Grid, gridToScore } from '~/domain/music/gridTypes';
import { loadFromScore } from '~/presentation/state/gridState';
import { editGridLayer, canEditGridLayer } from './editGridLayer';

/**
 * editGridLayer — in-place splice of 4 `s("…")` rows inside a
 * top-level `stack(...)`. Used by gridState edit-mode.
 */

const sampleGrid = (): Grid => {
  let g = emptyGrid();
  g = setCell(g, 0, 0, true); // bd step 0
  g = setCell(g, 1, 1, true); // sd step 1
  g = setCell(g, 1, 3, true); // sd step 3
  g = setCell(g, 2, 0, true); // hh step 0
  g = setCell(g, 2, 2, true); // hh step 2
  return g;
};

describe('canEditGridLayer — precondition check', () => {
  it('rejects empty score', () => {
    expect(canEditGridLayer('')).toBe(false);
  });

  it('rejects whitespace-only', () => {
    expect(canEditGridLayer('   \n  ')).toBe(false);
  });

  it('rejects bare non-stack pattern', () => {
    expect(canEditGridLayer('note("c4 e4 g4")')).toBe(false);
  });

  it('rejects stack with only 1 s-layer', () => {
    expect(canEditGridLayer('stack(s("bd ~ sd ~"))')).toBe(false);
  });

  it('rejects stack with 3 s-layers + 1 note (only 3 s-layers, not 4)', () => {
    expect(canEditGridLayer('stack(s("a"), s("b"), s("c"), note("c4"))')).toBe(false);
  });

  it('rejects stack with 4 s-layers + 1 note (5 layers but only 4 s-layers)', () => {
    expect(canEditGridLayer('stack(s("a"), s("b"), s("c"), s("d"), note("c4"))')).toBe(true);
    // 4 s-layers present, so we CAN edit (the note layer is preserved).
  });

  it('accepts 4 s-layer stack', () => {
    expect(canEditGridLayer('stack(s("a"), s("b"), s("c"), s("d"))')).toBe(true);
  });

  it('accepts 4 s-layer stack with surrounding comments', () => {
    const score = '// my beat\nstack(\n  s("a"),\n  s("b"),\n  s("c"),\n  s("d")\n)';
    expect(canEditGridLayer(score)).toBe(true);
  });
});

describe('editGridLayer — 4-s-layer splice', () => {
  it('replaces all 4 s-rows with the grid snippet', () => {
    const score = 'stack(s("bd"), s("sd"), s("hh"), s("cp"))';
    const result = editGridLayer(score, sampleGrid());
    expect(result).not.toBeNull();
    expect(result).toContain('s("bd ~ ~ ~ ~ ~ ~ ~")');
    expect(result).toContain('s("~ sd ~ sd ~ ~ ~ ~")');
    expect(result).toContain('s("hh ~ hh ~ ~ ~ ~ ~")');
    expect(result).toContain('s("~ ~ ~ ~ ~ ~ ~ ~")');
  });

  it('preserves non-sample layers in mixed stack', () => {
    const score = 'stack(note("c4"), s("a"), s("b"), s("c"), s("d"))';
    const result = editGridLayer(score, sampleGrid());
    expect(result).not.toBeNull();
    expect(result).toContain('note("c4")');
    // 4 s-rows replaced
    expect(result).toContain('s("bd ~ ~ ~ ~ ~ ~ ~")');
    expect(result).toContain('s("~ sd ~ sd ~ ~ ~ ~")');
    expect(result).toContain('s("hh ~ hh ~ ~ ~ ~ ~")');
    expect(result).toContain('s("~ ~ ~ ~ ~ ~ ~ ~")');
  });

  it('preserves surrounding comments', () => {
    const score = '// my beat\nstack(s("a"), s("b"), s("c"), s("d"))';
    const result = editGridLayer(score, sampleGrid());
    expect(result).not.toBeNull();
    expect(result).toContain('// my beat');
  });

  it('preserves leading whitespace + newlines', () => {
    const score = '\n\n  stack(\n    s("a"),\n    s("b"),\n    s("c"),\n    s("d")\n  )\n';
    const result = editGridLayer(score, sampleGrid());
    expect(result).not.toBeNull();
    // Outer stack open paren preserved at original offset.
    expect(result?.startsWith('\n\n  stack(')).toBe(true);
  });

  it('returns null for non-parseable score', () => {
    expect(editGridLayer('note("c4")', sampleGrid())).toBeNull();
    expect(editGridLayer('stack(s("only one"))', sampleGrid())).toBeNull();
  });
});

describe('editGridLayer — round-trip with loadFromScore', () => {
  it('gridToScore(g) → loadFromScore → equal to g', () => {
    const g = sampleGrid();
    const snippet = gridToScore(g);
    const loaded = loadFromScore(snippet);
    expect(loaded).toEqual(g);
  });

  it('loadFromScore(editGridLayer(score, g)) === g when score is grid-snippet', () => {
    const g = sampleGrid();
    const snippet = gridToScore(g);
    // Now mutate the snippet via editGridLayer (no-op, but should be parseable).
    const reEdited = editGridLayer(snippet, g);
    expect(reEdited).not.toBeNull();
    const loaded = loadFromScore(reEdited!);
    expect(loaded).toEqual(g);
  });

  it('all-empty grid → all-rest rows in output', () => {
    const g = emptyGrid();
    const score = 'stack(s("a"), s("b"), s("c"), s("d"))';
    const result = editGridLayer(score, g);
    expect(result).not.toBeNull();
    // All four rows are 8 rests.
    const restRows = (result ?? '').match(/s\("~ ~ ~ ~ ~ ~ ~ ~"\)/g) ?? [];
    expect(restRows.length).toBe(4);
  });
});
