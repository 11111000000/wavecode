import { describe, it, expect } from 'vitest';
import { emptyGrid, gridToScore, setCell, type Grid } from '~/domain/music/gridTypes';
import {
  appendGridToScore,
  hasTopLevelStack,
  isGridEmptyState,
  loadFromScore,
  setGridDirect,
  getGrid,
} from './gridState';

/**
 * Tests for appendGridToScore — the pure merge helper that adapts a
 * StepGrid layout to either an empty editor, an editor with a single
 * non-stack pattern, or an editor that already wraps everything in a
 * top-level stack(...). See wavecode-step-append-sync packet.
 */

const sampleGrid = (): Grid => {
  let g = emptyGrid();
  g = setCell(g, 0, 0, true); // bd step 0
  g = setCell(g, 1, 1, true); // sd step 1
  return g;
};

describe('appendGridToScore — empty editor', () => {
  it('returns grid snippet verbatim (no extra wrapping)', () => {
    const g = emptyGrid();
    const expected = gridToScore(g);
    expect(expected.startsWith('stack(')).toBe(true);
    const result = appendGridToScore('', g);
    expect(result).toBe(expected);
  });

  it('still returns the standalone snippet when editor contains only whitespace', () => {
    const g = sampleGrid();
    const expected = gridToScore(g);
    const result = appendGridToScore('   \n  ', g);
    expect(result).toBe(expected);
  });

  it('non-empty grid + empty score matches the standalone grid snippet', () => {
    const g = sampleGrid();
    const expected = gridToScore(g);
    const result = appendGridToScore('', g);
    expect(result).toBe(expected);
  });
});

describe('appendGridToScore — editor has a bare non-stack pattern', () => {
  it('wraps both in a fresh stack(...) call', () => {
    const result = appendGridToScore('note("c4 e4 g4")', sampleGrid());
    expect(result).toMatch(/^stack\(/);
    expect(result).toContain('note("c4 e4 g4")');
    // Grid snippet should be present as an additional layer.
    expect(result).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
    expect(result).toMatch(/s\("~ sd ~ ~ ~ ~ ~ ~"\),/);
    // Closing paren of the outer stack.
    expect(result.trimEnd().endsWith(')')).toBe(true);
  });

  it('treats comments as no-ops (still bare non-stack pattern)', () => {
    const result = appendGridToScore('// my idea\nnote("c4")', sampleGrid());
    expect(result).toMatch(/^stack\(/);
    expect(result).toContain('note("c4")');
    expect(result).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
  });
});

describe('appendGridToScore — editor already has a top-level stack', () => {
  it('splices grid layer into existing stack (no new outer wrap)', () => {
    const existing = 'stack(\n  note("c4"),\n  s("bd sd")\n)';
    const result = appendGridToScore(existing, sampleGrid());
    expect(result).toContain('note("c4")');
    expect(result).toContain('s("bd sd")');
    expect(result).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
    expect(result).toMatch(/s\("~ sd ~ ~ ~ ~ ~ ~"\),/);
  });

  it('survives a stack with a leading comment block', () => {
    const existing = '// header\nstack(\n  s("hh hh"),\n)';
    const result = appendGridToScore(existing, sampleGrid());
    expect(result).toContain('// header');
    expect(result).toContain('s("hh hh")');
    expect(result).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
  });

  it('survives a stack with inline commas in nested parens', () => {
    const existing = 'stack(s("<a, b, c>"), n("0,1"))';
    const result = appendGridToScore(existing, sampleGrid());
    // nested commas shouldn't fool the splitter
    expect(result).toContain('s("<a, b, c>")');
    expect(result).toContain('n("0,1")');
    expect(result).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
  });
});

describe('appendGridToScore — hasTopLevelStack classifier', () => {
  it('false on empty', () => {
    expect(hasTopLevelStack('')).toBe(false);
  });

  it('false on bare non-stack', () => {
    expect(hasTopLevelStack('note("c4")')).toBe(false);
  });

  it('true on top-level stack', () => {
    expect(hasTopLevelStack('stack(\n  note("c4"),\n)')).toBe(true);
  });

  it('true on top-level stack with a leading comment', () => {
    expect(hasTopLevelStack('// hi\nstack(\n)')).toBe(true);
  });
});

/**
 * loadFromScore — best-effort reverse of gridToScore. Regressions here
 * silently leave the Step sheet blank on open (pre-fix bug: setCell was
 * called for side effect but its immutable return was discarded, so the
 * grid stayed empty for every score). See
 * math/wavecode-step-grid-autoload-and-sync.
 */
describe('loadFromScore — populates grid from s("…") rows', () => {
  it('simple 4-row score yields 4 active cells (col 0 each)', () => {
    const score = [
      'stack(',
      '  s("bd ~ sd ~ hh ~ cp ~"),',
      '  s("hh hh hh hh hh"),',
      '  s("cp cp cp cp cp"),',
      '  s("~ ~ ~ ~ ~ ~ ~ bd"),',
      ')',
    ].join('\n');
    const result = loadFromScore(score);
    expect(result[0]).toEqual([true, false, true, false, true, false, true, false]);
    expect(result[3]?.[7]).toBe(true);
    expect(result.some((r) => r.every((c) => !c))).toBe(false);
    // Re-read via getGrid to confirm setGrid signal was updated.
    expect(getGrid()).toBe(result);
  });

  it('skips ~ and . tokens, activates everything else', () => {
    const score = 's("bd . ~ sd hh ~ cp ~")';
    const result = loadFromScore(score);
    expect(result[0]).toEqual([true, false, false, true, true, false, true, false]);
  });

  it('returns empty grid for score with no s("…") rows', () => {
    const score = 'note("c4 e4 g4")';
    const result = loadFromScore(score);
    expect(result.every((r) => r.every((c) => !c))).toBe(true);
  });

  it('picks the FIRST 4 s("…") calls, ignores the rest', () => {
    const score = [
      'stack(',
      '  s("bd ~ ~ ~ ~ ~ ~ ~"),',
      '  s("~ sd ~ ~ ~ ~ ~ ~"),',
      '  s("~ ~ hh ~ ~ ~ ~ ~"),',
      '  s("~ ~ ~ cp ~ ~ ~ ~"),',
      '  s("ignored x 1 y 1"),', // 5th — must be ignored
      ')',
    ].join('\n');
    const result = loadFromScore(score);
    expect(result[0]?.[0]).toBe(true);
    expect(result[1]?.[1]).toBe(true);
    expect(result[2]?.[2]).toBe(true);
    expect(result[3]?.[3]).toBe(true);
    // 5th row never makes it (would be row 4 = out of bounds anyway).
  });

  it('isGridEmptyState reflects whether grid has any active cell', () => {
    setGridDirect(emptyGrid());
    expect(isGridEmptyState()).toBe(true);
    loadFromScore('s("bd ~ ~ ~ ~ ~ ~ ~")');
    expect(isGridEmptyState()).toBe(false);
  });

  it('REGRESSION: previous code discarded setCell return — must NOT silently no-op', () => {
    // If this fails, loadFromScore regressed to the pre-fix bug where
    // setCell(g, r, c, true) was called but its return was discarded.
    const before = getGrid();
    loadFromScore('s("bd ~ sd ~ hh ~ cp ~")');
    const after = getGrid();
    expect(after).not.toEqual(before);
    expect(after[0]).toEqual([true, false, true, false, true, false, true, false]);
  });
});
