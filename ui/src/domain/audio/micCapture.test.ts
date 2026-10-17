import { describe, it, expect } from 'vitest';
import {
  feed,
  hzToMidi,
  initialMicState,
  closeOpenNote,
  notesToSnippet,
  computeTempoCpm,
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
  const note = (midi: number, t: number, durationMs: number = 200, vibratoCents: number = 0): AudioNote => ({
    midi,
    cents: 0,
    startMs: t,
    durationMs,
    vibratoCents,
  });

  it('null on empty', () => {
    expect(notesToSnippet([])).toBeNull();
  });

  it('produces a single-voice note pattern (no duration info)', () => {
    expect(notesToSnippet([
      { midi: 60, cents: 0, startMs: 0, durationMs: 0, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 0, durationMs: 0, vibratoCents: 0 },
      { midi: 67, cents: 0, startMs: 0, durationMs: 0, vibratoCents: 0 },
    ]))
      .toBe('note("c4 e4 g4").s("piano")');
  });

  it('emits @<seconds> per note when durationMs is set (preserves melody timing)', () => {
    // 400ms, 600ms, 200ms — relative ratios 0.33 : 0.5 : 0.17
    expect(notesToSnippet([
      { midi: 60, cents: 0, startMs: 0, durationMs: 400, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 0, durationMs: 600, vibratoCents: 0 },
      { midi: 67, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
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
      { midi: 60, cents: 0, startMs: 0, durationMs: 0, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 0, durationMs: 0, vibratoCents: 0 },
    ])).toBe('note("c4 e4").s("piano")');
  });

  it('emits @<seconds> when at least one note has durationMs (mixed bag handled)', () => {
    expect(notesToSnippet([
      { midi: 60, cents: 0, startMs: 0, durationMs: 0, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 0, durationMs: 500, vibratoCents: 0 },
    ])).toBe('note("c4@0.010 e4@0.500").s("piano")');
  });

  it('emits .vib(N) wrapper when a note has vibratoCents > 30', () => {
    expect(notesToSnippet([
      note(60, 0, 400, 50),
    ])).toBe('note("c4@0.400").s("piano").vib(5)');
  });

  it('omits .vib wrapper when vibratoCents <= 30', () => {
    expect(notesToSnippet([
      note(60, 0, 400, 0),
      note(64, 200, 200, 25),
    ])).toBe('note("c4@0.400 e4@0.200").s("piano")');
  });

  it('uses max(vibratoCents) across all notes for the .vib() depth', () => {
    expect(notesToSnippet([
      note(60, 0, 400, 35),
      note(64, 200, 200, 80),
    ])).toBe('note("c4@0.400 e4@0.200").s("piano").vib(8)');
  });

  it('emits .vib(3) when vibratoCents is just above the 30-cent threshold', () => {
    expect(notesToSnippet([
      note(60, 0, 400, 31),
    ])).toBe('note("c4@0.400").s("piano").vib(3)');
  });
});

describe('computeTempoCpm()', () => {
  const mk = (startMs: number, midi: number = 60): AudioNote => ({
    midi, cents: 0, startMs, durationMs: 0, vibratoCents: 0,
  });

  it('returns null when there is only 1 note', () => {
    expect(computeTempoCpm([mk(0)])).toBeNull();
  });

  it('returns null for 2 notes within 30ms of each other (sub-frame noise)', () => {
    expect(computeTempoCpm([mk(0), mk(10), mk(20)])).toBeNull();
  });

  it('keeps a single surviving IOI and discards sub-frame ones (2-note case)', () => {
    // 0→10 (10ms, dropped) and 10→600 (590ms, kept). One interval
    // survives the 30ms filter — that's enough to derive a CPM.
    // 60 / 0.59 ≈ 101.7 BPM → cpm ≈ 25.42.
    expect(computeTempoCpm([mk(0), mk(10), mk(600)])).toBeCloseTo(25.42, 1);
  });

  it('derives cpm = bpm/4 from the median IOI (2 notes, 500ms apart → 120 BPM → cpm=30)', () => {
    expect(computeTempoCpm([mk(0), mk(500)])).toBe(30);
  });

  it('derives cpm = bpm/4 from the median IOI (3 notes, 400ms apart → 150 BPM → cpm=37.5)', () => {
    expect(computeTempoCpm([mk(0), mk(400), mk(800)])).toBe(37.5);
  });

  it('uses the median when IOIs are uneven (400ms then 800ms)', () => {
    // intervals = [400, 800], median = 600ms → bpm=100 → cpm=25
    expect(computeTempoCpm([mk(0), mk(400), mk(1200)])).toBe(25);
  });

  it('clamps to user-supplied bpmRange when BPM > max', () => {
    // 2 notes 200ms apart → 300 BPM. With range {40, 200}: clamp to 200 → cpm=50.
    expect(
      computeTempoCpm([mk(0), mk(200)], { bpmRange: { min: 40, max: 200 } }),
    ).toBe(50);
  });

  it('clamps to user-supplied bpmRange when BPM < min', () => {
    // 2 notes 2000ms apart → 30 BPM. With range {40, 200}: clamp to 40 → cpm=10.
    expect(
      computeTempoCpm([mk(0), mk(2000)], { bpmRange: { min: 40, max: 200 } }),
    ).toBe(10);
  });

  it('keeps out-of-range BPM verbatim when bpmRange is undefined (default behaviour)', () => {
    // 2 notes 200ms apart → 300 BPM. No range → keep raw → cpm=75.
    expect(computeTempoCpm([mk(0), mk(200)])).toBe(75);
    // 2 notes 2000ms apart → 30 BPM. No range → keep raw → cpm=7.5.
    expect(computeTempoCpm([mk(0), mk(2000)])).toBe(7.5);
  });

  it('clamps even when the user-supplied range matches the default values', () => {
    // Explicit field → clamp; the values do not matter.
    expect(
      computeTempoCpm([mk(0), mk(200)], { bpmRange: { min: 40, max: 200 } }),
    ).toBe(50);
  });
});

describe('notesToSnippet() — tempo quantisation (opt-in)', () => {
  const note = (midi: number, t: number, durationMs: number = 0, vibratoCents: number = 0): AudioNote => ({
    midi, cents: 0, startMs: t, durationMs, vibratoCents,
  });

  it('does nothing when tempoQuantize is false (default)', () => {
    expect(notesToSnippet([note(60, 0), note(64, 500)])).toBe(
      'note("c4 e4").s("piano")',
    );
  });

  it('does nothing when tempoQuantize is true but only 1 note is present', () => {
    expect(notesToSnippet([note(60, 0)], { tempoQuantize: true })).toBe(
      'note("c4").s("piano")',
    );
  });

  it('does nothing when all IOIs are < 30ms (sub-frame noise)', () => {
    // 3 notes 10ms apart — no IOI survives the filter.
    expect(
      notesToSnippet([note(60, 0), note(64, 10), note(67, 20)], {
        tempoQuantize: true,
      }),
    ).toBe('note("c4 e4 g4").s("piano")');
  });

  it('wraps in setCpm(30.000) for 2 notes 500ms apart (120 BPM, default range)', () => {
    // 60/0.5 = 120 BPM; cpm = 120/4 = 30 (matches preset default CPS=0.5).
    expect(
      notesToSnippet([note(60, 0), note(64, 500)], { tempoQuantize: true }),
    ).toBe('setCpm(30.000).note("c4 e4").s("piano")');
  });

  it('wraps in setCpm(37.500) for 3 notes 400ms apart (150 BPM)', () => {
    expect(
      notesToSnippet(
        [note(60, 0), note(64, 400), note(67, 800)],
        { tempoQuantize: true },
      ),
    ).toBe('setCpm(37.500).note("c4 e4 g4").s("piano")');
  });

  it('combines with .vib() — wrapping order matches existing vib test', () => {
    // 2 notes 500ms apart (120 BPM, cpm=30) where the FIRST note
    // carries vibratoCents=50 → depth=5. The existing vib test emits
    // `note("c4@0.400 e4@0.400").s("piano").vib(5)` — vib AFTER s,
    // setCpm prepends the snippet. Single-note cases can't quantise
    // (no IOI), so we exercise the combination with 2+ notes.
    expect(
      notesToSnippet(
        [
          note(60, 0, 400, 50),
          note(64, 500, 400, 0),
        ],
        { tempoQuantize: true },
      ),
    ).toBe('setCpm(30.000).note("c4@0.400 e4@0.400").s("piano").vib(5)');
  });

  it('combines with slowFactor — slow is outermost, then setCpm', () => {
    expect(
      notesToSnippet(
        [note(60, 0), note(64, 500)],
        { slowFactor: 2, tempoQuantize: true },
      ),
    ).toBe('slow(2).setCpm(30.000).note("c4 e4").s("piano")');
  });

  it('combines slowFactor + tempoQuantize + vib (full stack)', () => {
    expect(
      notesToSnippet(
        [
          note(60, 0, 400, 50),
          note(64, 500, 400, 0),
        ],
        { slowFactor: 2, tempoQuantize: true },
      ),
    ).toBe('slow(2).setCpm(30.000).note("c4@0.400 e4@0.400").s("piano").vib(5)');
  });

  it('keeps raw BPM (clamped to range only when user supplies one) — BPM > max', () => {
    // 2 notes 200ms apart → 300 BPM. Default range: keep → cpm=75.
    expect(
      notesToSnippet([note(60, 0), note(64, 200)], { tempoQuantize: true }),
    ).toBe('setCpm(75.000).note("c4 e4").s("piano")');
    // Same notes with explicit range {40, 200}: clamp to 200 → cpm=50.
    expect(
      notesToSnippet(
        [note(60, 0), note(64, 200)],
        { tempoQuantize: true, tempoBpmRange: { min: 40, max: 200 } },
      ),
    ).toBe('setCpm(50.000).note("c4 e4").s("piano")');
  });

  it('keeps raw BPM when below default min (clamp only when user supplies range)', () => {
    // 2 notes 2000ms apart → 30 BPM. Default range: keep → cpm=7.5.
    expect(
      notesToSnippet([note(60, 0), note(64, 2000)], { tempoQuantize: true }),
    ).toBe('setCpm(7.500).note("c4 e4").s("piano")');
    // Same notes with explicit range {40, 200}: clamp to 40 → cpm=10.
    expect(
      notesToSnippet(
        [note(60, 0), note(64, 2000)],
        { tempoQuantize: true, tempoBpmRange: { min: 40, max: 200 } },
      ),
    ).toBe('setCpm(10.000).note("c4 e4").s("piano")');
  });

  it('accepts tempoTargetCps without changing the result (formula cancels it out)', () => {
    // 120 BPM at any targetCps → cpm = bpm/4 = 30 (targetCps cancels).
    expect(
      notesToSnippet(
        [note(60, 0), note(64, 500)],
        { tempoQuantize: true, tempoTargetCps: 0.5 },
      ),
    ).toBe('setCpm(30.000).note("c4 e4").s("piano")');
    expect(
      notesToSnippet(
        [note(60, 0), note(64, 500)],
        { tempoQuantize: true, tempoTargetCps: 1.0 },
      ),
    ).toBe('setCpm(30.000).note("c4 e4").s("piano")');
  });
});

describe('feed() — vibrato tracking (vibratoCents on closed note)', () => {
  it('straight tone has vibratoCents = 0', () => {
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }));
    s = feed(s, frame(440, { t: 50, rms: 0.2 }));
    s = feed(s, frame(440, { t: 100, rms: 0.2 }));
    s = feed(s, frame(440, { t: 150, rms: 0.2 }));
    s = feed(s, frame(null, { t: 200, rms: 0.001 }));
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.vibratoCents).toBe(0);
  });

  it('wobbly pitch (oscillating ±45 cents within A4) produces vibratoCents > 30', () => {
    // Pre-compute the two Hz values:
    //   cents -45 within A4 (midiRound=69): midiFloat = 68.55
    //     hz = 440 * 2^(-0.45/12) ≈ 428.55
    //   cents +45 within A4 (midiRound=69): midiFloat = 69.45
    //     hz = 440 * 2^(0.45/12)  ≈ 451.60
    // Both round to midi=69, drift ≤ noteVarianceCents=80, so they
    // extend the open note. Stddev of cents ≈ 45 → vibratoCents > 30.
    const wobbleLow = 440 * Math.pow(2, -45 / 1200);
    const wobbleHigh = 440 * Math.pow(2, 45 / 1200);
    let s: MicState = initialMicState();
    for (let t = 0; t < 200; t += 50) {
      s = feed(s, frame(t % 100 === 0 ? wobbleLow : wobbleHigh, { t, rms: 0.2 }));
    }
    s = feed(s, frame(null, { t: 250, rms: 0.001 }));
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.vibratoCents).toBeGreaterThan(30);
  });

  it('small wobble (±10 cents) does NOT cross the 30-cent vibrato threshold', () => {
    const wobbleLow = 440 * Math.pow(2, -10 / 1200);
    const wobbleHigh = 440 * Math.pow(2, 10 / 1200);
    let s: MicState = initialMicState();
    for (let t = 0; t < 200; t += 50) {
      s = feed(s, frame(t % 100 === 0 ? wobbleLow : wobbleHigh, { t, rms: 0.2 }));
    }
    s = feed(s, frame(null, { t: 250, rms: 0.001 }));
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.vibratoCents).toBe(0);
  });

  it('closeOpenNote computes vibratoCents from the open note accumulated stats', () => {
    const wobbleLow = 440 * Math.pow(2, -45 / 1200);
    const wobbleHigh = 440 * Math.pow(2, 45 / 1200);
    let s: MicState = initialMicState();
    for (let t = 0; t < 200; t += 50) {
      s = feed(s, frame(t % 100 === 0 ? wobbleLow : wobbleHigh, { t, rms: 0.2 }));
    }
    // Force-close at t=250 instead of waiting for silence.
    s = closeOpenNote(s, 250);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.vibratoCents).toBeGreaterThan(30);
  });
});

describe('feed() — long-form buffer cap (sliding window)', () => {
  // Tests in this block disable the merge path (noteMergeWindowMs=0)
  // so each fed note exists as a discrete closed entry — the merge
  // complicates assertions about the sliding window.
  const noMergeTune = (windowMs: number): MicTune => ({
    ...DEFAULT_TUNE,
    windowMs,
    noteMergeWindowMs: 0,
  });

  it('prunes notes older than windowMs and bumps notesPrunedCount', () => {
    // windowMs is large during phase 1 so nothing prunes while the
    // user "performs". Phase 2 jumps far enough to cut phase-1 out.
    const tune = noMergeTune(2000);
    let s: MicState = initialMicState();
    const noteFrames = (t: number): void => {
      s = feed(s, frame(440, { t, rms: 0.2 }), tune);
      s = feed(s, frame(null, { t: t + 100, rms: 0.001 }), tune);
    };
    noteFrames(0);
    noteFrames(400);
    noteFrames(800);
    noteFrames(1200);

    expect(s.notes).toHaveLength(4);
    expect(s.notesPrunedCount).toBe(0);

    // Phase 2: at t=4100, cutoff=4100-2000=2100 → all phase-1 notes
    // (startMs 0..1200) get pruned. The phase-2 note survives.
    s = feed(s, frame(440, { t: 4000, rms: 0.2 }), tune);
    s = feed(s, frame(null, { t: 4100, rms: 0.001 }), tune);

    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.startMs).toBe(4000);
    expect(s.notesPrunedCount).toBe(4);
  });

  it('keeps only notes whose startMs >= cutoff', () => {
    // Use a large window so phase 1 doesn't prune anything, then a
    // silence frame at a tighter windowMs to test exact boundary.
    const bigTune = noMergeTune(100_000);
    let s: MicState = initialMicState();
    const nf = (t: number): void => {
      s = feed(s, frame(440, { t, rms: 0.2 }), bigTune);
      s = feed(s, frame(null, { t: t + 80, rms: 0.001 }), bigTune);
    };
    nf(0);
    nf(100);
    nf(200);
    nf(300);
    expect(s.notes).toHaveLength(4);
    expect(s.notesPrunedCount).toBe(0);

    // Silence at t=380 with windowMs=150 → cutoff=230.
    // Drop startMs < 230 → n0 (0), n1 (100), n2 (200) pruned.
    // Keep n3 (300).
    s = feed(s, frame(null, { t: 380, rms: 0.001 }), {
      ...bigTune,
      windowMs: 150,
    });
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]?.startMs).toBe(300);
    expect(s.notesPrunedCount).toBe(3);
  });

  it('drops an open note whose startMs is older than windowMs', () => {
    const tune = noMergeTune(200);
    let s: MicState = initialMicState();
    // Open a note at t=0 and sustain it (case 4a extends — startMs
    // remains 0 across frames). Once the call's nowMs exceeds
    // windowMs past the startMs, prune drops the open note.
    s = feed(s, frame(440, { t: 0, rms: 0.2 }), tune);
    s = feed(s, frame(440, { t: 100, rms: 0.2 }), tune);
    expect(s.openNote).not.toBeNull();
    s = feed(s, frame(440, { t: 250, rms: 0.2 }), tune);
    // 250 - 0 = 250 > 200 → pruneState nulls the open note.
    expect(s.openNote).toBeNull();
    // The drop is literal — no closed-note emitted for it.
    expect(s.notes).toHaveLength(0);
    expect(s.notesPrunedCount).toBe(0);
  });

  it('does not count open-note drops in notesPrunedCount', () => {
    const tune = noMergeTune(100);
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }), tune);
    expect(s.notesPrunedCount).toBe(0);
    // Sustain past the window — extend keeps openNote alive in the
    // segmenter step, but prune drops it. notesPrunedCount stays 0
    // (open-note drops don't count).
    s = feed(s, frame(440, { t: 200, rms: 0.2 }), tune);
    expect(s.openNote).toBeNull();
    expect(s.notesPrunedCount).toBe(0);
    // A subsequent new note shouldn't carry over any drop count either.
    s = feed(s, frame(660, { t: 300, rms: 0.2 }), tune);
    expect(s.openNote).not.toBeNull();
    expect(s.notesPrunedCount).toBe(0);
  });

  it('resets lastClosedMs when the last note was pruned', () => {
    const tune = noMergeTune(200);
    let s: MicState = initialMicState();
    s = feed(s, frame(440, { t: 0, rms: 0.2 }), tune);
    s = feed(s, frame(null, { t: 100, rms: 0.001 }), tune);
    expect(s.lastClosedMs).toBe(100);
    expect(s.notes).toHaveLength(1);
    // Jump far into the future — old note gets pruned.
    s = feed(s, frame(440, { t: 1000, rms: 0.2 }), tune);
    expect(s.notesPrunedCount).toBe(1);
    expect(s.notes).toHaveLength(0);
    expect(s.lastClosedMs).toBeNull();
  });

  it('default windowMs is 30_000ms', () => {
    expect(DEFAULT_TUNE.windowMs).toBe(30_000);
  });
});
