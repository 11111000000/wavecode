import { describe, it, expect, beforeEach } from 'vitest';
import { emptyGrid, gridToScore, setCell, type Grid } from '~/domain/music/gridTypes';
import {
  appendGridToScore,
  applyEditToLayer,
  clearDraft,
  commitDraft,
  dirtyCellCount,
  enterEdit,
  enterSketch,
  enterView,
  getDraftGrid,
  getLastCommittedGrid,
  getMode,
  hasTopLevelStack,
  isDraftClean,
  isGridEmptyState,
  loadFromScore,
  setGridDirect,
  setModeDirect,
  toggleCellInDraft,
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
 * decisions/wavecode-step-grid-autoload-and-sync.yaml.
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

/**
 * Mode-aware state — see decisions/wavecode-step-grid-modes.yaml.
 *
 *   - enterView/enterSketch/enterEdit mutate the mode signal and
 *     re-seed draft + lastCommitted according to each mode's contract.
 *   - commitDraft advances lastCommitted to the current draft
 *     (sketch mode "↑ commit" semantics).
 *   - applyEditToLayer splices the draft in-place into a 4-s-layer
 *     stack (edit mode per-tap) and falls back to appendGridToScore
 *     if the score is no longer parseable.
 *   - dirtyCellCount / isDraftClean drive the "N unsaved" badge.
 */

/**
 * Reset module-scope state before each test. gridState signals
 * (`draftGrid`, `lastCommittedGrid`, `mode`) are shared across
 * test files (and any consumer that imports gridState), so we
 * MUST reset between tests to avoid pollution. Also reset mode
 * to 'view' (the safe default) so rejection-path tests don't
 * see leaked 'edit' state.
 */
beforeEach(() => {
  clearDraft();
  setModeDirect('view');
});

describe('gridState — enterView', () => {
  it('sets mode=view, parses score into draft + lastCommitted', () => {
    clearDraft();
    const score = 'stack(\n  s("bd ~ sd ~"),\n  s("hh hh"),\n  s("cp cp"),\n  s("bd ~ ~ ~")\n)';
    enterView(score);
    expect(getMode()).toBe('view');
    expect(getDraftGrid()).toEqual(getLastCommittedGrid());
    expect(getDraftGrid()[0]?.[0]).toBe(true);
    expect(getDraftGrid()[1]?.[1]).toBe(true);
    expect(dirtyCellCount()).toBe(0);
  });

  it('parses empty score into an empty grid', () => {
    clearDraft();
    enterView('');
    expect(getMode()).toBe('view');
    expect(getDraftGrid()).toEqual(emptyGrid());
    expect(dirtyCellCount()).toBe(0);
  });
});

describe('gridState — enterSketch', () => {
  it('sets mode=sketch, keeps existing draft if non-empty', () => {
    clearDraft();
    // Simulate a non-empty draft (user already mid-sketching).
    const draft = setCell(emptyGrid(), 0, 0, true);
    setGridDirect(draft);
    enterSketch('note("c4")');
    expect(getMode()).toBe('sketch');
    expect(getDraftGrid()).toBe(draft);
  });

  it('parses score if draft is empty', () => {
    clearDraft();
    const score = 's("bd ~ sd ~ hh ~ cp ~")';
    enterSketch(score);
    expect(getMode()).toBe('sketch');
    expect(getDraftGrid()[0]).toEqual([true, false, true, false, true, false, true, false]);
  });
});

describe('gridState — enterEdit', () => {
  it('accepts a 4-s-layer stack and sets mode=edit', () => {
    clearDraft();
    const score = 'stack(s("bd"), s("sd"), s("hh"), s("cp"))';
    const result = enterEdit(score);
    expect(result.ok).toBe(true);
    expect(getMode()).toBe('edit');
    expect(getDraftGrid()).toEqual(getLastCommittedGrid());
  });

  it('rejects non-stack score with a reason', () => {
    clearDraft();
    const result = enterEdit('note("c4")');
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(getMode()).not.toBe('edit');
  });

  it('rejects stack with only 1 s-layer', () => {
    clearDraft();
    const result = enterEdit('stack(s("bd"))');
    expect(result.ok).toBe(false);
    expect(getMode()).not.toBe('edit');
  });

  it('accepts 4-s-layer stack mixed with non-sample layers', () => {
    clearDraft();
    const score = 'stack(note("c4"), s("bd"), s("sd"), s("hh"), s("cp"))';
    const result = enterEdit(score);
    expect(result.ok).toBe(true);
  });
});

describe('gridState — commitDraft (sketch mode ↑ commit)', () => {
  it('returns new score via appendGridToScore and advances lastCommitted', () => {
    clearDraft();
    const g = setCell(emptyGrid(), 0, 0, true);
    setGridDirect(g);
    const currentScore = '';
    const newScore = commitDraft(currentScore);
    expect(newScore).not.toBeNull();
    expect(newScore).toMatch(/^stack\(/);
    expect(newScore).toContain('s("bd ~ ~ ~ ~ ~ ~ ~")');
    expect(getLastCommittedGrid()).toBe(g);
    expect(dirtyCellCount()).toBe(0);
  });

  it('returns null when draft is empty (nothing to commit)', () => {
    clearDraft();
    const newScore = commitDraft('note("c4")');
    expect(newScore).toBeNull();
  });
});

describe('gridState — applyEditToLayer (edit mode per-tap)', () => {
  it('splices draft into 4-s-layer stack in place (no double-wrap)', () => {
    clearDraft();
    // Use explicit rest tokens (`~`) so loadFromScore gives a clean
    // empty grid to start from — otherwise every cell becomes "true"
    // and toggleCellInDraft(0,0) would actually UNtoggle an unwanted
    // hit (the loadFromScore best-effort parser doesn't validate the
    // sample token matches the row's GRID_ROWS entry).
    const score = 'stack(s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"))';
    enterEdit(score);
    toggleCellInDraft(0, 0); // bd step 0
    const newScore = applyEditToLayer(score);
    expect(newScore).not.toBeNull();
    expect(newScore).toContain('s("bd ~ ~ ~ ~ ~ ~ ~")');
    // No double-wrap: score still has one outer stack.
    expect((newScore ?? '').match(/stack\(/g)?.length).toBe(1);
  });

  it('preserves non-sample layers in mixed stack', () => {
    clearDraft();
    const score = 'stack(note("c4"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"))';
    enterEdit(score);
    toggleCellInDraft(1, 1);
    const newScore = applyEditToLayer(score);
    expect(newScore).toContain('note("c4")');
    expect(newScore).toContain('s("~ sd ~ ~ ~ ~ ~ ~")');
  });

  it('falls back to appendGridToScore if score is no longer parseable', () => {
    clearDraft();
    const score = 'stack(s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"))';
    enterEdit(score);
    toggleCellInDraft(0, 0);
    // Simulate the user editing the score outside the grid.
    const userEdited = 'note("c4 e4 g4")';
    const newScore = applyEditToLayer(userEdited);
    expect(newScore).not.toBeNull();
    expect(newScore).toMatch(/^stack\(/);
    expect(newScore).toContain('note("c4 e4 g4")');
    expect(newScore).toContain('s("bd ~ ~ ~ ~ ~ ~ ~")');
  });

  it('returns null when score is empty and draft is empty', () => {
    clearDraft();
    const newScore = applyEditToLayer('');
    expect(newScore).toBeNull();
  });
});

describe('gridState — dirtyCellCount / isDraftClean', () => {
  it('0 when draft equals lastCommitted (initial state)', () => {
    clearDraft();
    expect(dirtyCellCount()).toBe(0);
    expect(isDraftClean()).toBe(true);
  });

  it('counts the number of cells that differ after a toggle', () => {
    clearDraft();
    toggleCellInDraft(0, 0);
    toggleCellInDraft(0, 3);
    expect(dirtyCellCount()).toBe(2);
    expect(isDraftClean()).toBe(false);
  });

  it('returns to 0 after commitDraft advances lastCommitted', () => {
    clearDraft();
    toggleCellInDraft(0, 0);
    commitDraft('');
    expect(dirtyCellCount()).toBe(0);
    expect(isDraftClean()).toBe(true);
  });
});

describe('gridState — setModeDirect (manual mode override for tests)', () => {
  it('switches mode without touching grid state', () => {
    setModeDirect('view');
    expect(getMode()).toBe('view');
    setModeDirect('sketch');
    expect(getMode()).toBe('sketch');
    setModeDirect('edit');
    expect(getMode()).toBe('edit');
  });
});
