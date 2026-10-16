import { describe, it, expect } from 'vitest';
import {
  feed,
  hzToMidi,
  initialWhistleState,
  closeOpenNote,
  notesToSnippet,
  DEFAULT_TUNE,
  type PitchFrame,
  type WhistleState,
  type WhistleTune,
  type AudioNote,
} from '~/domain/audio/whistle';
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
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(null, { t: 0, rms: 0.001 }));
    s = feed(s, frame(null, { t: 30, rms: 0.001 }));
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('opens a note on first pitched frame', () => {
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    expect(s.openNote).not.toBeNull();
    expect(s.openNote?.midi).toBe(69);
    expect(s.notes).toHaveLength(0);
  });

  it('closes note on silence, appends to notes', () => {
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 30, rms: 0.2 }));
    s = feed(s, frame(null, { t: 200, rms: 0.001 }));
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.midi).toBe(69);
    expect(s.notes[0]?.durationMs).toBeGreaterThanOrEqual(DEFAULT_TUNE.minNoteMs);
  });

  it('drops notes shorter than minNoteMs (breath noise)', () => {
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(null, { t: 30, rms: 0.001 })); // 30ms < 80ms
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('treats sequence of two identical pitches as one continuous note', () => {
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    s = feed(s, frame(440, { t: 100, rms: 0.2 }));
    s = feed(s, frame(null, { t: 200, rms: 0.001 }));
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.durationMs).toBe(200);
  });

  it('splits when pitch shifts by an octave', () => {
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));   // A4 (69)
    s = feed(s, frame(880, { t: 100, rms: 0.2 }));  // A5 (81) — different octave
    s = feed(s, frame(null, { t: 200, rms: 0.001 }));
    expect(s.notes.map((n) => n.midi)).toEqual([69, 81]);
  });

  it('rejects frames with clarity below the gate (noise)', () => {
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(440, { t: 0, rms: 0.2, clarity: 0.5 }));
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('rejects frames outside the configured Hz range', () => {
    const tune: WhistleTune = { ...DEFAULT_TUNE, minHz: 100 };
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(80, { t: 0, rms: 0.2 }), tune);
    expect(s.openNote).toBeNull();
  });

  it('computes averaged cents offset across sustained frames', () => {
    let s: WhistleState = initialWhistleState();
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

describe('closeOpenNote()', () => {
  it('closes a long enough open note', () => {
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = closeOpenNote(s, 200);
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(1);
  });

  it('drops open notes shorter than the cutoff', () => {
    let s: WhistleState = initialWhistleState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = closeOpenNote(s, 30); // 30ms < 80ms
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });

  it('is a no-op when no note is open', () => {
    let s: WhistleState = initialWhistleState();
    s = closeOpenNote(s, 1000);
    expect(s.openNote).toBeNull();
    expect(s.notes).toHaveLength(0);
  });
});

describe('notesToSnippet()', () => {
  const note = (midi: number, t: number): AudioNote => ({
    midi,
    cents: 0,
    startMs: t,
    durationMs: 200,
  });

  it('null on empty', () => {
    expect(notesToSnippet([])).toBeNull();
  });

  it('produces a single-voice note pattern', () => {
    expect(notesToSnippet([note(60, 0), note(64, 200), note(67, 400)]))
      .toBe('note("c4 e4 g4").s("piano")');
  });

  it('uses custom instrument when provided', () => {
    expect(
      notesToSnippet([note(60, 0), note(64, 200)], { instrument: 'triangle' }),
    ).toBe('note("c4 e4").s("triangle")');
  });

  it('wraps in slow() when slowFactor > 1', () => {
    expect(
      notesToSnippet([note(60, 0), note(64, 200)], { slowFactor: 2 }),
    ).toBe('slow(2).note("c4 e4").s("piano")');
  });

  it('drops slow() wrap when slowFactor <= 1', () => {
    expect(
      notesToSnippet([note(60, 0)], { slowFactor: 1 }),
    ).toBe('note("c4").s("piano")');
    expect(
      notesToSnippet([note(60, 0)], { slowFactor: 0.5 }),
    ).toBe('note("c4").s("piano")');
  });
});
