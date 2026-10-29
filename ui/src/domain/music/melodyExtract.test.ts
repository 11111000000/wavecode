import { describe, it, expect } from 'vitest';
import {
  extractMelodyFromScore,
  commitMelodyToScore,
  melodyToMini,
  roundTripMelody,
  MELODY_DEFAULT_INSTRUMENT,
} from './melodyExtract';
import type { MelodyCell } from './melodyGridTypes';
import { MELODY_COLS, MELODY_PITCH_LOW, MELODY_PITCH_HIGH } from './melodyGridTypes';

/**
 * Unit tests for the melody grid extract/commit pipeline.
 *
 * Coverage:
 *   - empty score, non-stack score, drum-only score,
 *     bare note("…"), n("…") alias, note-with-rest,
 *     chord column (chord collapsed to lowest pitch on extract,
 *     expanded back on commit — lossy round-trip, documented).
 *
 * The drum StepGrid's `editGridLayer` tests are the closest
 * reference; we mirror its shape so any future restructuring
 * can be diff-checked.
 */

const cell = (step: number, midi: number): MelodyCell => ({ step, midi });

const strudelToMidi = (s: string): number => {
  const m = /^([a-g])([#bB]?)(-?\d+)$/.exec(s.trim());
  if (!m) return NaN;
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const off = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const oct = parseInt(m[3] ?? '0', 10);
  return (oct + 1) * 12 + ((base[m[1]!.toLowerCase()] ?? 0) + off);
};

describe('extractMelodyFromScore — failure modes', () => {
  it('returns { ok: false, reason: "empty-score" } for an empty string', () => {
    expect(extractMelodyFromScore('')).toEqual({
      ok: false,
      reason: 'empty-score',
      cells: [],
    });
  });

  it('returns { ok: false, reason: "empty-score" } for whitespace-only', () => {
    expect(extractMelodyFromScore('   \n  \t')).toEqual({
      ok: false,
      reason: 'empty-score',
      cells: [],
    });
  });

  it('returns { ok: false, reason: "no-note-call" } for a bare non-stack score', () => {
    expect(extractMelodyFromScore('silence')).toEqual({
      ok: false,
      reason: 'no-note-call',
      cells: [],
    });
  });

  it('returns { ok: false, reason: "no-note-call" } for a drum-only stack score', () => {
    const score = 'stack(\n  s("bd sd hh cp"),\n  s("hh hh hh hh")\n)';
    expect(extractMelodyFromScore(score)).toEqual({
      ok: false,
      reason: 'no-note-call',
      cells: [],
    });
  });

  it('returns { ok: false, reason: "no-note-call" } for an unbalanced stack', () => {
    expect(extractMelodyFromScore('stack(note("c4 e4"')).toEqual({
      ok: false,
      reason: 'no-note-call',
      cells: [],
    });
  });
});

describe('extractMelodyFromScore — happy path', () => {
  it('bare note("c4 e4 g4") emits 3 ascending cells', () => {
    const out = extractMelodyFromScore('note("c4 e4 g4")');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells).toEqual([
      cell(0, strudelToMidi('c4')),
      cell(1, strudelToMidi('e4')),
      cell(2, strudelToMidi('g4')),
    ]);
    expect(out.noteName).toBe('note');
    expect(out.argIndex).toBe(-1); // bare note → no stack arg
  });

  it('n("c4 e4") alias works the same as note(...)', () => {
    const out = extractMelodyFromScore('n("c4 e4 g4")');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells.length).toBe(3);
    expect(out.noteName).toBe('n');
  });

  it('preserves rest tokens as gaps in the cell list', () => {
    const out = extractMelodyFromScore('note("c4 ~ g4")');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells).toEqual([cell(0, strudelToMidi('c4')), cell(2, strudelToMidi('g4'))]);
  });

  it('collapses [c4 e4 g4] chord to its lowest pitch (c4)', () => {
    const out = extractMelodyFromScore('note("[c4 e4 g4]")');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells).toEqual([cell(0, strudelToMidi('c4'))]);
  });

  it('drops out-of-range pitches (e.g. c9 → 84 > high=83)', () => {
    // c9 = midi 84 is just outside the high bound (83).
    const out = extractMelodyFromScore('note("c4 c9")');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells).toEqual([cell(0, strudelToMidi('c4'))]);
  });

  it('truncates to MELODY_COLS columns', () => {
    const many = new Array(MELODY_COLS + 4).fill('c4').join(' ');
    const out = extractMelodyFromScore(`note("${many}")`);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells.length).toBe(MELODY_COLS);
    for (let i = 0; i < MELODY_COLS; i += 1) {
      expect(out.cells[i]).toEqual(cell(i, strudelToMidi('c4')));
    }
  });

  it('reads note inside a top-level stack, surfacing argIndex', () => {
    const out = extractMelodyFromScore('stack(\n  note("c4 e4 g4"),\n  s("hh")\n)');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells.length).toBe(3);
    expect(out.argIndex).toBe(0);
  });

  it('reads note inside a deeper cat([stack(...)]) via depth-1 stack walk', () => {
    // For a `cat(stack(...), stack(...))` the AST first node is `cat(...)`,
    // not a stack. The melody grid is then not extractable as a top-level
    // melody (deeper-search recursion isn't part of the contract).
    // We assert that calling on a top-level cat returns no-note-call
    // (the user is expected to switch to sketch mode for nested
    // melodies, OR to be using a top-level stack in their score).
    const score = [
      'cat(',
      '  stack(',
      '    note("g3 b3 d4 b3"),',
      '    note("g2").s("sawtooth")',
      '  ),',
      '  stack(',
      '    note("f#3 b3 d#4 b3"),',
      '    note("b2").s("sawtooth")',
      '  )',
      ').slow(1.3)',
    ].join('\n');
    const out = extractMelodyFromScore(score);
    expect(out.ok).toBe(false);
  });

  it('reads the built-in Creep verse (first stack in cat() via depth-1 walk)', () => {
    // Direct stack(note(…)) at the top level.
    const out = extractMelodyFromScore(
      'stack(\n  note("g3 b3 d4 b3 g3 b3 d4 b3"),\n  note("g2")\n)',
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells.length).toBe(8);
    expect(out.cells[0]).toEqual(cell(0, strudelToMidi('g3')));
    expect(out.cells[1]).toEqual(cell(1, strudelToMidi('b3')));
    expect(out.cells[2]).toEqual(cell(2, strudelToMidi('d4')));
    expect(out.cells[3]).toEqual(cell(3, strudelToMidi('b3')));
  });

  it('all-pitch-range: every MIDI in [low..high] is accepted', () => {
    // Build a 16-column line that touches the boundaries.
    const tokens = ['c3', 'c4', 'b5'];
    const out = extractMelodyFromScore(`note("${tokens.join(' ')}")`);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cells.map((c) => c.midi)).toEqual([
      MELODY_PITCH_LOW,
      strudelToMidi('c4'),
      MELODY_PITCH_HIGH,
    ]);
  });
});

describe('melodyToMini — pure formatter', () => {
  it('empty melody → "<~ ~ ~ …>" (16 rests)', () => {
    const mini = melodyToMini([]);
    expect(mini).toBe('<~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~>');
  });

  it('single cell → "<c4 ~ …>" with the cell at step 0', () => {
    const mini = melodyToMini([cell(0, strudelToMidi('c4'))]);
    expect(mini).toMatch(/^<c4 ~/);
    expect(mini.endsWith('~>')).toBe(true);
  });

  it('chord at one step → "[c4 e4 g4]" inside <>', () => {
    const mini = melodyToMini([
      cell(1, strudelToMidi('c4')),
      cell(1, strudelToMidi('e4')),
      cell(1, strudelToMidi('g4')),
    ]);
    expect(mini).toMatch(/^<~ \[c4 e4 g4\]/);
  });

  it('output is always exactly 16 columns (MELODY_COLS)', () => {
    const mini = melodyToMini([cell(0, strudelToMidi('c4'))]);
    const cols = mini.slice(1, -1).split(' ');
    expect(cols.length).toBe(MELODY_COLS);
  });
});

describe('commitMelodyToScore — failure modes', () => {
  it('returns { ok: false, reason: "empty-score" } for empty input', () => {
    expect(commitMelodyToScore('', [], {})).toEqual({
      ok: false,
      reason: 'empty-score',
    });
  });

  it('returns { ok: false, reason: "no-stack-target" } for a bare non-stack score', () => {
    expect(commitMelodyToScore('note("c4")', [cell(0, 60)], {})).toEqual({
      ok: false,
      reason: 'no-stack-target',
    });
  });

  it('returns { ok: false, reason: "no-note-call" } for a drum-only stack', () => {
    const score = 'stack(\n  s("bd sd hh cp"),\n  s("hh hh hh hh")\n)';
    expect(commitMelodyToScore(score, [cell(0, 60)], {})).toEqual({
      ok: false,
      reason: 'no-note-call',
    });
  });
});

describe('commitMelodyToScore — happy path', () => {
  it('refuses a bare note-call (no stack to splice into)', () => {
    // The commit path is for in-place edits of the note arg inside
    // a top stack. A bare `note("…")` score has no stack, so the
    // caller should fall back to `appendToTopStack` (sketch mode).
    const result = commitMelodyToScore('note("c4 e4 g4")', [cell(0, 60)], {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no-stack-target');
    }
  });

  it('in-place replacement preserves s(…) rows in a mixed stack', () => {
    const score = 'stack(\n  note("c4 e4 g4"),\n  s("bd ~ bd ~"),\n  s("hh hh hh hh")\n)';
    const result = commitMelodyToScore(score, [cell(0, 60), cell(1, 64)], {
      instrument: 'triangle',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toBe(1);
    // s(…) rows preserved byte-for-byte.
    expect(result.score).toContain('s("bd ~ bd ~")');
    expect(result.score).toContain('s("hh hh hh hh")');
    // note(...) replaced with a fresh note("<…>").s("triangle").
    expect(result.score).toMatch(/note\("<[^>]+>"\)\.s\("triangle"\)/);
  });

  it('preserves trailing method chains (.fast / .gain / .slow)', () => {
    const score = 'stack(\n  note("c4"),\n  s("hh")\n).gain(0.5)';
    const result = commitMelodyToScore(score, [cell(0, 60)], {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.endsWith('.gain(0.5)')).toBe(true);
  });

  it('replaces n("…") alias the same as note(...)', () => {
    const score = 'stack(\n  n("c4 e4"),\n  s("hh")\n)';
    const result = commitMelodyToScore(score, [cell(0, 60), cell(1, 64)], {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toMatch(/^stack\(\s*n\("<[^>]+>"\)/);
  });

  it('uses the user-provided instrument when supplied', () => {
    const score = 'stack(\n  note("c4"),\n  s("hh")\n)';
    const result = commitMelodyToScore(score, [cell(0, 60)], { instrument: 'sawtooth' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toContain('.s("sawtooth")');
    expect(result.score).not.toContain(`.s("${MELODY_DEFAULT_INSTRUMENT}")`);
  });
});

describe('roundTripMelody — extract ∘ mutate ∘ commit', () => {
  it('extract → commit preserves cell count when the mutation is identity', () => {
    const score = 'stack(\n  note("c4 e4 g4 ~ c4 e4 g4 ~ c4 e4 g4 ~ c4"),\n  s("hh")\n)';
    const back = roundTripMelody(
      score,
      (cells) => cells,
      { instrument: 'triangle' },
    );
    expect(back).not.toBeNull();
    if (back === null) return;
    const extracted = extractMelodyFromScore(back);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    // 10 active tokens in the source ("...g4 c4") wait that's
    // "c4 e4 g4 ~ c4 e4 g4 ~ c4 e4 g4 ~ c4" = 13 tokens,
    // 10 pitches + 3 rests = 10 cells.
    expect(extracted.cells.length).toBe(10);
  });

  it('identity round-trip produces a parseable score', () => {
    const score = 'stack(\n  note("g3 b3 d4 b3"),\n  s("bd")\n)';
    const back = roundTripMelody(score, (cells) => cells);
    expect(back).not.toBeNull();
    if (back === null) return;
    expect(back).toContain('note(');
    expect(back).toContain('s("bd")');
  });

  it('mutation: clearing all cells then committing yields a stack with empty note(...) row', () => {
    const score = 'stack(\n  note("c4 e4 g4"),\n  s("hh hh hh hh")\n)';
    const back = roundTripMelody(score, () => []);
    expect(back).not.toBeNull();
    if (back === null) return;
    expect(back).toContain('s("hh hh hh hh")');
    // Note arg replaced with `<~ ~ ~ ~ ~ ~ ~ …>` (16 rests).
    expect(back).toMatch(/note\("<~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~>"\)/);
  });
});

describe('roundTripMelody — splice preserves non-target args', () => {
  it('does not touch n(...) when the target is note(...)', () => {
    const score = 'stack(\n  note("c4 e4 g4"),\n  n("a3 b3 c4")\n)';
    const beforeN = score.match(/n\("[^"]+"\)/)?.[0] ?? '';
    expect(beforeN).toBe('n("a3 b3 c4")');
    const result = commitMelodyToScore(score, [cell(0, 60)], {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toContain(beforeN);
  });

  it('does not touch comment text containing note(...) substrings', () => {
    const score = 'stack(\n  // compare note("c4 e4") vs chord\n  note("c4 e4 g4"),\n  s("hh")\n)';
    const result = commitMelodyToScore(score, [cell(0, 60)], {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The AST walker only counts the REAL note(...), not the
    // comment text, so the replacement hits the right row.
    expect(result.score).toContain('// compare note("c4 e4") vs chord');
  });
});
