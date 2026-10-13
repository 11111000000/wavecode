import { describe, it, expect } from 'vitest';
import { emptyGrid, gridToScore, setCell, type Grid } from '~/domain/music/gridTypes';
import {
  appendGridToScore,
  hasTopLevelStack,
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
