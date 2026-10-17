import { describe, it, expect } from 'vitest';
import {
  feed,
  hzToMidi,
  initialMicState,
  closeOpenNote,
  notesToSnippet,
  DEFAULT_TUNE,
  type PitchFrame,
  type MicState,
  type MicTune,
  type AudioNote,
} from '~/domain/audio/micCapture';
import { noteNumberToName, midiToStrudelNote } from '~/domain/music/notes';

/**
 * Unit tests for the pure pipeline.
 *
 * Strategy: feed synthetic PitchFrames into `feed()` and assert the
 * segmentation result. Synthetic frames let us bypass AudioContext
 * + worker entirely — the segmenter is the deterministic part of
 * the pipeline.
 */

const frame = (
  hz: number | null,
  opts: { t?: number; clarity?: number; rms?: number } = {},
): PitchFrame => ({
  hz,
  clarity: opts.clarity ?? 0.95,
  rms: opts.rms ?? 0.1,
  timestampMs: opts.t ?? 0,
});

describe('hzToMidi', () => {
  it('A4 = 440Hz = MIDI 69, 0 cents', () => {
    expect(hzToMidi(440)).toEqual({ midi: 69, cents: 0 });
  });

  it('C4 = 261.626Hz ≈ MIDI 60, −1 cent', () => {
    const { midi } = hzToMidi(261.626);
    expect(midi).toBe(60);
  });

  it('cumulative cents across a semitone: 451Hz ≈ A4 + 43 cents → 69 + 43', () => {
    const { midi, cents } = hzToMidi(451);
    expect(midi).toBe(69);
    expect(cents).toBeGreaterThanOrEqual(40);
    expect(cents).toBeLessThanOrEqual(45);
  });

  it('handles edge cases gracefully', () => {
    expect(hzToMidi(0).midi).toBe(0);
    expect(hzToMidi(-1).midi).toBe(0);
    expect(hzToMidi(NaN).midi).toBe(0);
  });
});

describe('noteNumberToName <-> midiToStrudelNote round-trip', () => {
  const midiNumbers = [48, 60, 61, 71, 69, 65, 55];
  it.each(midiNumbers)('midi %i → lowercase strudel', (m) => {
    expect(midiToStrudelNote(m)).toBe(noteNumberToName(m).toLowerCase());
  });
});

describe('feed() segmentation', () => {
  it('opens no note for sustained silence', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(null, { t: 0, rms: 0.001 }));
    s = feed(s, frame(null, { t: 30, rms: 0.001 }));
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('opens a note on first pitched frame', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    expect(s.openNote).not.toBeNull();
    expect(s.openNote?.midi).toBe(69);
    expect(s.notes).toHaveLength(0);
  });

  it('closes note on silence, appends to notes', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 30, rms: 0.2 }));
    s = feed(s, frame(null, { t: 200, rms: 0.001 }));
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.midi).toBe(69);
    expect(s.notes[0]?.durationMs).toBeGreaterThanOrEqual(DEFAULT_TUNE.minNoteMs);
  });

  it('drops notes shorter than minNoteMs (breath noise)', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(null, { t: 30, rms: 0.001 })); // 30ms < 80ms
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('treats sequence of two identical pitches as one continuous note', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    s = feed(s, frame(440, { t: 100, rms: 0.2 }));
    s = feed(s, frame(null, { t: 200, rms: 0.001 }));
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.durationMs).toBe(200);
  });

  it('splits when pitch shifts by an octave', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));   // A4 (69)
    s = feed(s, frame(880, { t: 100, rms: 0.2 }));  // A5 (81) — different octave
    s = feed(s, frame(null, { t: 200, rms: 0.001 }));
    expect(s.notes.map((n) => n.midi)).toEqual([69, 81]);
  });

  it('rejects frames with clarity below the gate (noise)', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2, clarity: 0.5 }));
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('rejects frames outside the configured Hz range', () => {
    const tune: MicTune = { ...DEFAULT_TUNE, minHz: 100 };
    let s: MicState = initialMicState();
    s = feed(s, frame(80, { t: 0, rms: 0.2 }), tune);
    expect(s.openNote).toBeNull();
  });

  it('computes averaged cents offset across sustained frames', () => {
    let s: MicState = initialMicState();
    // 440 + 4 cents = 440 * 2^(4/1200) ≈ 441.02
    s = feed(s, frame(441.02, { t: 0, rms: 0.2 }));
    s = feed(s, frame(441.02, { t: 50, rms: 0.2 }));
    s = feed(s, frame(441.02, { t: 100, rms: 0.2 }));
    s = feed(s, frame(null, { t: 200, rms: 0.001 }));
    expect(s.notes).toHaveLength(1);
    const cents = s.notes[0]?.cents ?? 0;
    expect(Math.abs(cents - 4)).toBeLessThanOrEqual(2);
  });
});

describe('feed() — note merge after brief silence', () => {
  it('merges a same-MIDI note after < noteMergeWindowMs of silence into one longer note', () => {
    let s: MicState = initialMicState();
    // First note: 440Hz from t=0 to t=150 (150ms sustain)
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    s = feed(s, frame(440, { t: 100, rms: 0.2 }));
    s = feed(s, frame(null, { t: 150, rms: 0.001 })); // brief silence, 50ms
    // Now the same 440Hz resumes at t=200 (50ms after silence)
    s = feed(s, frame(440, { t: 200, rms: 0.2 }));
    s = feed(s, frame(440, { t: 250, rms: 0.2 }));
    s = feed(s, frame(null, { t: 300, rms: 0.001 })); // close
    // Should be ONE note, spanning 0 to 300
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.startMs).toBe(0);
    expect(s.notes[0]?.durationMs).toBe(300);
  });

  it('does NOT merge if silence exceeds noteMergeWindowMs', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    s = feed(s, frame(null, { t: 100, rms: 0.001 })); // close (dur=100, ≥ 80ms)
    // 200ms gap (> noteMergeWindowMs=100) — no merge
    s = feed(s, frame(440, { t: 300, rms: 0.2 }));
    s = feed(s, frame(440, { t: 350, rms: 0.2 }));
    s = feed(s, frame(null, { t: 400, rms: 0.001 })); // close (dur=100, ≥ 80ms)
    expect(s.notes).toHaveLength(2);
  });

  it('does NOT merge if MIDI differs (different note)', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));   // A4
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    s = feed(s, frame(null, { t: 100, rms: 0.001 })); // close A4 (dur=100)
    s = feed(s, frame(660, { t: 300, rms: 0.2 }));  // E5 — different note
    s = feed(s, frame(660, { t: 350, rms: 0.2 }));
    s = feed(s, frame(null, { t: 400, rms: 0.001 })); // close E5 (dur=100)
    expect(s.notes.map((n) => n.midi)).toEqual([69, 76]);
  });

  it('preserves a sustained note when same-MIDI is hit again (no double-counting)', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    s = feed(s, frame(null, { t: 100, rms: 0.001 })); // close
    s = feed(s, frame(440, { t: 130, rms: 0.2 }));   // re-open (within 100ms)
    s = feed(s, frame(440, { t: 200, rms: 0.2 }));
    s = feed(s, frame(null, { t: 250, rms: 0.001 })); // close final
    // Should be ONE note spanning 0..250 (the close at 100 is "absorbed"
    // by the re-open at 130 within noteMergeWindowMs).
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.startMs).toBe(0);
    expect(s.notes[0]?.durationMs).toBe(250);
  });
});

describe('DEFAULT_TUNE — human-mic friendly defaults', () => {
  it('rejects rumbles below 200Hz (no false low notes from breath)', () => {
    expect(DEFAULT_TUNE.minHz).toBeGreaterThanOrEqual(200);
  });
  it('covers up to A7 (3520Hz) for high vocal range', () => {
    expect(DEFAULT_TUNE.maxHz).toBeGreaterThanOrEqual(3000);
  });
  it('clarity gate is permissive (0.85) — pitchy MPM rarely returns >0.95 on real audio', () => {
    expect(DEFAULT_TUNE.clarityGate).toBeLessThanOrEqual(0.9);
  });
  it('vibrato tolerance ≥ 80 cents (covers natural vocal vibrato)', () => {
    expect(DEFAULT_TUNE.noteVarianceCents).toBeGreaterThanOrEqual(60);
  });
  it('merge window 100ms is non-zero', () => {
    expect(DEFAULT_TUNE.noteMergeWindowMs).toBeGreaterThan(0);
  });
});

describe('closeOpenNote()', () => {
  it('closes a long enough open note', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = closeOpenNote(s, 200);
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(1);
  });

  it('drops open notes shorter than the cutoff', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = closeOpenNote(s, 30); // 30ms < 80ms
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('is a no-op when no note is open', () => {
    let s: MicState = initialMicState();
    s = closeOpenNote(s, 1000);
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('stashes lastClosedMs after a successful close (so merge can fire next)', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    s = feed(s, frame(null, { t: 100, rms: 0.001 })); // close (dur=100, ≥ 80)
    expect(s.lastClosedMs).toBe(100);
    expect(s.notes).toHaveLength(1);
    // Now the merge path is available — same-MIDI within 100ms
    // re-opens the previous note (test above).
  });
});

describe('notesToSnippet()', () => {
  const note = (midi: number, t: number, durationMs: number = 200): AudioNote => ({
    midi,
    cents: 0,
    startMs: t,
    durationMs,
  });

  it('null on empty', () => {
    expect(notesToSnippet([])).toBeNull();
  });

  it('produces a single-voice note pattern (no duration info)', () => {
    expect(notesToSnippet([
      { midi: 60, cents: 0, startMs: 0, durationMs: 0 },
      { midi: 64, cents: 0, startMs: 0, durationMs: 0 },
      { midi: 67, cents: 0, startMs: 0, durationMs: 0 },
    ]))
      .toBe('note("c4 e4 g4").s("piano")');
  });

  it('emits @<seconds> per note when durationMs is set (preserves melody timing)', () => {
    // 400ms, 600ms, 200ms — relative ratios 0.33 : 0.5 : 0.17
    expect(notesToSnippet([
      { midi: 60, cents: 0, startMs: 0, durationMs: 400 },
      { midi: 64, cents: 0, startMs: 0, durationMs: 600 },
      { midi: 67, cents: 0, startMs: 0, durationMs: 200 },
    ]))
      .toBe('note("c4@0.400 e4@0.600 g4@0.200").s("piano")');
  });

  it('uses custom instrument when provided', () => {
    expect(
      notesToSnippet([note(60, 0), note(64, 200)], { instrument: 'triangle' }),
    ).toBe('note("c4@0.200 e4@0.200").s("triangle")');
  });

  it('wraps in slow() when slowFactor > 1', () => {
    expect(
      notesToSnippet([note(60, 0), note(64, 200)], { slowFactor: 2 }),
    ).toBe('slow(2).note("c4@0.200 e4@0.200").s("piano")');
  });

  it('drops slow() wrap when slowFactor <= 1', () => {
    expect(
      notesToSnippet([note(60, 0)], { slowFactor: 1 }),
    ).toBe('note("c4@0.200").s("piano")');
    expect(
      notesToSnippet([note(60, 0)], { slowFactor: 0.5 }),
    ).toBe('note("c4@0.200").s("piano")');
  });

  it('uses bare note names when all durations are 0 (no @N emit)', () => {
    // When no duration info is available we fall back to the
    // bare-name form (Strudel uses its default 1-cycle-per-note
    // length). Avoids spurious `@0` in code where timing was never
    // captured (e.g. imported from a save format without timing).
    expect(notesToSnippet([
      { midi: 60, cents: 0, startMs: 0, durationMs: 0 },
      { midi: 64, cents: 0, startMs: 0, durationMs: 0 },
    ])).toBe('note("c4 e4").s("piano")');
  });

  it('emits @<seconds> when at least one note has durationMs (mixed bag handled)', () => {
    expect(notesToSnippet([
      { midi: 60, cents: 0, startMs: 0, durationMs: 0 },
      { midi: 64, cents: 0, startMs: 0, durationMs: 500 },
    ])).toBe('note("c4@0.010 e4@0.500").s("piano")');
  });
});
