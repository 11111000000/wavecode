import { describe, it, expect } from 'vitest';
import {
  pianoTranscribe,
  formatTranscribeSummary,
  TRANSCRIBE_DEFAULT_BPM,
  TRANSCRIBE_DEFAULT_QUANTIZE,
  TRANSCRIBE_DEFAULT_INSTRUMENT,
  type TranscribeNote,
} from './pianoTranscribe';
import { parseScore } from '~/domain/strudel';

/**
 * pianoTranscribe is a domain-pure function with no Solid / Effect.
 * These tests pin its behaviour against the public types and verify
 * the AST-validation fallback. All assertions are deterministic and
 * avoid `expect(...).toBe(…)` on regex-derived strings that might
 * shuffle if we tweak formatting later — instead we assert on
 * substrings + structural shape.
 */

const note = (midi: number, startMs: number, endMs = startMs + 250): TranscribeNote => ({
  note: midi,
  startMs,
  endMs,
});

describe('pianoTranscribe — empty + guards', () => {
  it('empty buffer → empty score, all-zero summary, valid: true', () => {
    const r = pianoTranscribe([], { bpm: 120 });
    expect(r.score).toBe('');
    expect(r.summary).toEqual({ notes: 0, columns: 0, beats: 0, valid: true });
  });

  it('defaults: bpm=120, quantize=16, instrument="triangle"', () => {
    expect(TRANSCRIBE_DEFAULT_BPM).toBe(120);
    expect(TRANSCRIBE_DEFAULT_QUANTIZE).toBe(16);
    expect(TRANSCRIBE_DEFAULT_INSTRUMENT).toBe('triangle');
  });

  it('throws when bpm <= 0 (defensive guard)', () => {
    expect(() => pianoTranscribe([note(60, 0)], { bpm: 0 })).toThrow(/bpm/);
    expect(() => pianoTranscribe([note(60, 0)], { bpm: -10 })).toThrow(/bpm/);
  });

  it('filters out invalid MIDI values (NaN, negative, >127)', () => {
    const r = pianoTranscribe(
      [
        { note: Number.NaN, startMs: 0, endMs: 100 },
        { note: -1, startMs: 0, endMs: 100 },
        { note: 200, startMs: 0, endMs: 100 },
        note(60, 0, 100),
      ],
      { bpm: 120 },
    );
    expect(r.summary.notes).toBe(1);
    expect(r.score).toContain('c4');
  });
});

describe('pianoTranscribe — single note + chord + sequence', () => {
  it('single note at bpm=120 → bare token, no `<>` wrapper', () => {
    const r = pianoTranscribe([note(60, 0)], { bpm: 120 });
    // Single column → no cat. The wrapper is `note("…").s("…")`.
    expect(r.score).toBe('note("c4").s("triangle")');
    expect(r.summary).toEqual({
      notes: 1,
      columns: 1,
      beats: 1,
      valid: true,
    });
  });

  it('three notes at the same time → chord `[c4 e4 g4]` (sorted ascending)', () => {
    // All three startMs within the same 1/16 cell (grid = 125 ms @ bpm=120).
    const r = pianoTranscribe(
      [note(60, 0), note(64, 5), note(67, 10)],
      { bpm: 120 },
    );
    expect(r.score).toContain('[c4 e4 g4]');
    expect(r.score).toBe('note("[c4 e4 g4]").s("triangle")');
    expect(r.summary.columns).toBe(1);
    expect(r.summary.notes).toBe(3);
  });

  it('column pitches sorted LOW → HIGH (root leftmost in chord)', () => {
    // Out-of-order input should NOT change the rendered chord order.
    const r = pianoTranscribe(
      [note(67, 0), note(60, 0), note(64, 0)],
      { bpm: 120 },
    );
    expect(r.score).toContain('[c4 e4 g4]');
  });

  it('4 notes at 1/16 spacing → 4 columns wrapped in `<>`', () => {
    // bpm=120 → grid = 125ms; 4 sixteenths = 500ms = 1 beat.
    const r = pianoTranscribe(
      [note(60, 0), note(62, 125), note(64, 250), note(67, 375)],
      { bpm: 120 },
    );
    expect(r.score).toBe('note("<c4 d4 e4 g4>").s("triangle")');
    expect(r.summary.columns).toBe(4);
    expect(r.summary.beats).toBe(1);
  });

  it('mixed chord + single note sequence renders correctly', () => {
    // Column 1: C major chord (3 notes). Column 2: D4 single. Column 3: E4 single.
    const r = pianoTranscribe(
      [
        note(60, 0),
        note(64, 0),
        note(67, 0),
        note(62, 125),
        note(64, 250),
      ],
      { bpm: 120 },
    );
    expect(r.score).toBe('note("<[c4 e4 g4] d4 e4>").s("triangle")');
    expect(r.summary.columns).toBe(3);
  });
});

describe('pianoTranscribe — quantize grouping', () => {
  it('notes within 1/16 grid cell collapse to ONE column', () => {
    // bpm=120 → grid = 125 ms. Notes at startMs 10, 20, 30 all round
    // to 0 → single column with 3 distinct pitches.
    const r = pianoTranscribe(
      [note(60, 10), note(64, 20), note(67, 30)],
      { bpm: 120 },
    );
    expect(r.summary.columns).toBe(1);
    expect(r.score).toContain('[c4 e4 g4]');
  });

  it('notes at exactly grid boundaries stay in separate columns', () => {
    // startMs 0, 125, 250 → three distinct columns at bpm=120.
    const r = pianoTranscribe(
      [note(60, 0), note(62, 125), note(64, 250)],
      { bpm: 120 },
    );
    expect(r.summary.columns).toBe(3);
  });

  it('quantize:8 groups notes into 1/8 cells (wider)', () => {
    // bpm=120 → 1/8 grid = 250 ms. Notes at 0 and 100 collapse to
    // column 0; note at 250 is column 250. Total: 2 columns.
    const r = pianoTranscribe(
      [note(60, 0), note(64, 100), note(67, 250)],
      { bpm: 120, quantize: 8 },
    );
    expect(r.summary.columns).toBe(2);
    expect(r.score).toContain('[c4 e4]');
    expect(r.score).toContain('g4');
  });

  it('quantize:4 groups notes into 1/4 cells (very wide)', () => {
    // bpm=120 → 1/4 grid = 500 ms. Notes at 0 and 100 both land in
    // cell 0 (100/500 = 0.2 → round → 0). Note at 250 lands in cell
    // 500 (250/500 = 0.5 → round → 1). Two cells.
    const r = pianoTranscribe(
      [note(60, 0), note(64, 100), note(67, 250)],
      { bpm: 120, quantize: 4 },
    );
    expect(r.summary.columns).toBe(2);
    expect(r.score).toContain('[c4 e4]');
    expect(r.score).toContain('g4');
  });

  it('different bpm changes grid width (faster BPM = smaller cells)', () => {
    // bpm=240 → grid = 62.5 ms. Notes at 0, 70, 140 land in cells
    // 0, 62.5, 125 → three columns.
    const fast = pianoTranscribe(
      [note(60, 0), note(64, 70), note(67, 140)],
      { bpm: 240 },
    );
    expect(fast.summary.columns).toBe(3);

    // bpm=120 → grid = 125 ms. Same notes land in cells
    // 0, 125, 125 → two columns (the second and third collapse to
    // the same cell). Demonstrates the BPM-driven grid change.
    const slow = pianoTranscribe(
      [note(60, 0), note(64, 70), note(67, 140)],
      { bpm: 120 },
    );
    expect(slow.summary.columns).toBe(2);
  });
});

describe('pianoTranscribe — AST validation', () => {
  it('result parses via parseScore to a CallNode (top-level `note(...)`)', () => {
    const r = pianoTranscribe([note(60, 0), note(64, 125)], { bpm: 120 });
    const ast = parseScore(r.score);
    expect(ast.nodes.length).toBeGreaterThanOrEqual(1);
    const top = ast.nodes[0]!;
    expect(top.kind).toBe('call');
    if (top.kind === 'call') {
      expect(top.name).toBe('note');
    }
  });

  it('chord column also parses (string arg contains `[...]`)', () => {
    const r = pianoTranscribe(
      [note(60, 0), note(64, 0), note(67, 0)],
      { bpm: 120 },
    );
    const ast = parseScore(r.score);
    expect(ast.nodes[0]!.kind).toBe('call');
  });

  it('instrument passthrough: `.s("piano")` for piano sample', () => {
    const r = pianoTranscribe([note(60, 0)], { bpm: 120, instrument: 'piano' });
    expect(r.score).toContain('.s("piano")');
  });

  it('oscillator passthrough: `.s("triangle")` for raw wave', () => {
    const r = pianoTranscribe([note(60, 0)], { bpm: 120, instrument: 'triangle' });
    expect(r.score).toContain('.s("triangle")');
  });

  it('summary.valid stays true for all normal inputs', () => {
    const r = pianoTranscribe(
      [note(60, 0), note(64, 125), note(67, 250)],
      { bpm: 120 },
    );
    expect(r.summary.valid).toBe(true);
  });
});

describe('pianoTranscribe — fallback', () => {
  it('all invalid MIDI → empty score, summary.valid=true (input-filter fallback)', () => {
    const r = pianoTranscribe(
      [
        { note: -1, startMs: 0, endMs: 100 },
        { note: 200, startMs: 0, endMs: 100 },
      ],
      { bpm: 120 },
    );
    expect(r.score).toBe('');
    expect(r.summary.valid).toBe(true);
    expect(r.summary.notes).toBe(0);
  });
});

describe('formatTranscribeSummary — Russian pluralisation', () => {
  it('formats a 4-note / 4-column / 1-beat summary', () => {
    const s = formatTranscribeSummary({ notes: 4, columns: 4, beats: 1, valid: true });
    // 4 → "ноты", 4 → "столбца", 1 → "бит"
    expect(s).toContain('4 ноты');
    expect(s).toContain('4 столбца');
    expect(s).toContain('1 бит');
  });

  it('handles 1 note / 21 columns / 0 beats', () => {
    const s = formatTranscribeSummary({ notes: 1, columns: 21, beats: 0, valid: true });
    // JS regex `\b` doesn't recognise Cyrillic as word chars, so we
    // assert on substrings rather than word boundaries.
    expect(s).toContain('1 нота');
    expect(s).toContain('21 столбец');
    expect(s).toContain('0 битов');
  });

  it('handles 11 notes (special mod100 case for pluralisation)', () => {
    // 11 → "нот" (mod100=11 overrides mod10=1 → "one" form).
    const s = formatTranscribeSummary({ notes: 11, columns: 11, beats: 11, valid: true });
    expect(s).toContain('11 нот');
    expect(s).toContain('11 столбцов');
    expect(s).toContain('11 битов');
  });

  it('handles 22 notes (mod10=2 → "few" form, но not "one")', () => {
    const s = formatTranscribeSummary({ notes: 22, columns: 22, beats: 22, valid: true });
    expect(s).toContain('22 ноты');
    expect(s).toContain('22 столбца');
    expect(s).toContain('22 бита');
  });
});