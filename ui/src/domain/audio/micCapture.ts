/**
 * Mic → MIDI pipeline: pure helpers, no Web APIs.
 *
 * Pipeline:
 *   mic (getUserMedia)
 *     → AudioContext  (sampleRate negotiation)
 *     → MediaStreamSource → AnalyserNode (getFloatTimeDomainData)
 *     → requestAnimationFrame poll (~30Hz)
 *     → Worker (pitchy MPM) → frame { hz, clarity, rms }
 *     → feed(frames, state) → AudioNote[]
 *     → notesToSnippet(notes) → Strudel code
 *
 * This file owns the parts that don't need a Worker / DOM / WebRTC:
 *   - hzToMidi: Hz → { midi, cents } (pure math, used by both Worker and main)
 *   - MicState machine: open-note + closed-notes segmentation
 *   - notesToSnippet: emit `note("c4@0.4 eb4@0.3 g4@0.3").s("piano")` style
 *
 * Why pure
 * --------
 * The audio/State pipeline (RMS gate → MPM → segmentation → snippet) is
 * split into a Worker (MPM) and a main-thread segmenter. The segmenter
 * must be testable without a DOM, so its delta lives here and the
 * implementation in `infrastructure/audio/MicCapture.ts` is just a
 * thin RAF driver around these pure functions.
 *
 * Glossary:
 *   - PitchFrame = one MPM result + RMS energy from the analyser
 *   - AudioNote  = one quantised musical note with start/duration
 *   - Tune       = thresholds (silence gate, clarity gate, freq range, ...)
 */

import { noteNumberToName } from '../music/notes';

export type PitchFrame = {
  readonly hz: number | null;
  readonly clarity: number;
  readonly rms: number;
  readonly timestampMs: number;
};

export type AudioNote = {
  readonly midi: number;
  readonly cents: number;
  readonly startMs: number;
  readonly durationMs: number;
};

export type MicTune = {
  readonly silenceGate: number;
  readonly clarityGate: number;
  /** Reject frames below this Hz as rumbles / breath / mic self-noise. */
  readonly minHz: number;
  /** Reject frames above this Hz as squeals / aliased content. */
  readonly maxHz: number;
  /** Drop notes shorter than this (sibilants, breath plosives). */
  readonly minNoteMs: number;
  /** Treat a pitch drift within this many cents as the same note. */
  readonly noteVarianceCents: number;
  /**
   * If a new pitched frame arrives within this window after the previous
   * note closed AND its MIDI matches the last closed note, merge them
   * into a single longer note. Prevents long sustains from being
   * chopped into fragments by brief amplitude dips. Default 100 ms.
   */
  readonly noteMergeWindowMs: number;
};

/**
 * Defaults tuned for human voice (not MIDI instruments):
 *  - Hz range 200-3500 covers G3 (196Hz) up to A7 (3520Hz) — comfortable
 *    middle of typical vocal range. 75Hz (the previous default) was
 *    catching breath rumbles as fake "low notes".
 *  - clarityGate 0.85 (was 0.9) — pitchy MPM rarely returns 1.0 on real
 *    audio, the old threshold was rejecting most usable frames.
 *  - noteVarianceCents 80 (was 50) — natural vocal vibrato is wider
 *    than 50 cents; the tighter window was splitting single notes.
 *  - noteMergeWindowMs 100 — see field comment.
 */
export const DEFAULT_TUNE: MicTune = {
  silenceGate: 0.012,
  clarityGate: 0.85,
  minHz: 200,
  maxHz: 3500,
  minNoteMs: 80,
  noteVarianceCents: 80,
  noteMergeWindowMs: 100,
};

export type OpenNote = {
  readonly midi: number;
  readonly startMs: number;
  readonly centsSum: number;
  readonly centsN: number;
};

export type MicState = {
  readonly openNote: OpenNote | null;
  readonly notes: ReadonlyArray<AudioNote>;
  /** ms timestamp of the most recently closed note (used for merge). */
  readonly lastClosedMs: number | null;
};

export const initialMicState = (): MicState => ({
  openNote: null,
  notes: [],
  lastClosedMs: null,
});

export const hzToMidi = (hz: number): { readonly midi: number; readonly cents: number } => {
  if (!Number.isFinite(hz) || hz <= 0) return { midi: 0, cents: 0 };
  const midi = 69 + 12 * Math.log2(hz / 440);
  const midiRound = Math.round(midi);
  const cents = Math.round((midi - midiRound) * 100);
  return { midi: midiRound, cents };
};

const frameIsPitch = (f: PitchFrame, t: MicTune): boolean =>
  f.hz !== null
  && Number.isFinite(f.hz)
  && f.clarity >= t.clarityGate
  && f.hz >= t.minHz
  && f.hz <= t.maxHz;

/**
 * Append-style state transition. Returns a NEW MicState (we never
 * mutate the input — keeps `feed()` pure for tests + replay).
 *
 * Cases per frame:
 *   1. Silence / below-gate frame → close open note if any, append it
 *      to notes if it crosses minNoteMs. Stash lastClosedMs for merge.
 *   2. Pitched frame, no open note, last closed note is the same MIDI
 *      AND within noteMergeWindowMs → RE-OPEN the last closed note
 *      (extends its duration to span the silence).
 *   3. Pitched frame, no open note → open a new note.
 *   4. Pitched frame, has open note →
 *      a. same midi as open (within noteVarianceCents) → extend
 *      b. different midi → close old, open new.
 */
export const feed = (
  state: MicState,
  frame: PitchFrame,
  tune: MicTune = DEFAULT_TUNE,
  nowMs: number = frame.timestampMs,
): MicState => {
  const hasPitch = frame.rms >= tune.silenceGate && frameIsPitch(frame, tune);

  if (!hasPitch) {
    if (state.openNote === null) return state;
    const durationMs = nowMs - state.openNote.startMs;
    if (durationMs < tune.minNoteMs) {
      return {
        openNote: null,
        notes: state.notes,
        lastClosedMs: nowMs,
      };
    }
    const centsAvg = Math.round(state.openNote.centsSum / state.openNote.centsN);
    return {
      openNote: null,
      notes: [
        ...state.notes,
        {
          midi: state.openNote.midi,
          cents: centsAvg,
          startMs: state.openNote.startMs,
          durationMs,
        },
      ],
      lastClosedMs: nowMs,
    };
  }

  const { midi, cents } = hzToMidi(frame.hz!);

  // Case 2: same-MIDI merge after brief silence.
  // We POP the last note from `state.notes` and re-open it starting
  // at the original startMs. On the next silence close, the silence
  // path appends a single note with the extended duration. This
  // keeps the notes[] array length-correct at every step (no phantom
  // duplicates).
  if (
    state.openNote === null
    && state.lastClosedMs !== null
    && state.notes.length > 0
    && nowMs - state.lastClosedMs <= tune.noteMergeWindowMs
  ) {
    const last = state.notes[state.notes.length - 1]!;
    if (last.midi === midi) {
      return {
        openNote: {
          midi: last.midi,
          startMs: last.startMs,
          centsSum: last.cents + cents,
          centsN: 2,
        },
        notes: state.notes.slice(0, -1),  // POP — the silence path re-appends on close
        lastClosedMs: null,
      };
    }
  }

  if (state.openNote === null) {
    return {
      openNote: { midi, startMs: nowMs, centsSum: cents, centsN: 1 },
      notes: state.notes,
      lastClosedMs: null,
    };
  }

  const openMidi = state.openNote.midi;
  const driftCents = Math.abs(midi - openMidi) * 100;
  if (driftCents <= tune.noteVarianceCents) {
    return {
      openNote: {
        midi: openMidi,
        startMs: state.openNote.startMs,
        centsSum: state.openNote.centsSum + cents,
        centsN: state.openNote.centsN + 1,
      },
      notes: state.notes,
      lastClosedMs: null,
    };
  }

  const durationMs = nowMs - state.openNote.startMs;
  const carriedNotes: ReadonlyArray<AudioNote> =
    durationMs >= tune.minNoteMs
      ? [
          ...state.notes,
          {
            midi: openMidi,
            cents: Math.round(state.openNote.centsSum / state.openNote.centsN),
            startMs: state.openNote.startMs,
            durationMs,
          },
        ]
      : state.notes;

  return {
    openNote: { midi, startMs: nowMs, centsSum: cents, centsN: 1 },
    notes: carriedNotes,
    lastClosedMs: null,
  };
};

/** Force-close any open note. Used by `MicPanel` "freeze" button
 *  and at `getUserMedia` stream teardown. */
export const closeOpenNote = (
  state: MicState,
  nowMs: number,
  minNoteMs: number = DEFAULT_TUNE.minNoteMs,
): MicState => {
  if (state.openNote === null) {
    return { ...state, lastClosedMs: state.notes.length > 0 ? nowMs : state.lastClosedMs };
  }
  const durationMs = nowMs - state.openNote.startMs;
  if (durationMs < minNoteMs) {
    return { openNote: null, notes: state.notes, lastClosedMs: nowMs };
  }
  const centsAvg = Math.round(state.openNote.centsSum / state.openNote.centsN);
  return {
    openNote: null,
    notes: [
      ...state.notes,
      {
        midi: state.openNote.midi,
        cents: centsAvg,
        startMs: state.openNote.startMs,
        durationMs,
      },
    ],
    lastClosedMs: nowMs,
  };
};

export type MicSnippetOptions = {
  /** Strudel sample instrument name. Default "piano" matches the on-screen
   *  piano default so the user hears a coherent timbre if they then eval. */
  readonly instrument?: string;
  /** If true, wrap in `slow(<n>)` to slow by a factor (for legato playback). */
  readonly slowFactor?: number;
};

/**
 * Convert a buffer of detected notes into a Strudel snippet.
 *
 * Empty buffer → null (caller decides silence vs skip).
 *
 *   notesToSnippet([60, 64, 67]) →
 *     'note("c4 e4 g4").s("piano")'           (no durationMs info)
 *   notesToSnippet([{midi:60, durationMs:400}, {midi:64, durationMs:600}]) →
 *     'note("c4@0.4 e4@0.6").s("piano")'        (durations in seconds)
 *
 * Durations are emitted as `@<seconds>` per note — Strudel cycles
 * scale to CPS (cycles per second), so at cps=1 these become real-
 * time seconds; at cps=2 the melody plays 2x faster. Relative
 * ratios between notes are preserved.
 *
 * If all notes are equal length AND the total duration is small, we
 * fall back to the no-`@` form (looks cleaner in the editor).
 *
 * Cents offset is intentionally dropped — Strudel snippets don't carry
 * micro-tuning, and average-cents over a sustained tone is mostly breath noise.
 */
export const notesToSnippet = (
  notes: ReadonlyArray<AudioNote>,
  opts: MicSnippetOptions = {},
): string | null => {
  if (notes.length === 0) return null;
  const instrument = opts.instrument ?? 'piano';
  const names = notes.map((n) => noteNumberToName(n.midi).toLowerCase());

  // Use `@<seconds>` notation when we have duration info. If all
  // notes lack durationMs (durationMs === 0), use bare names.
  const haveDurations = notes.some((n) => n.durationMs > 0);
  let inner: string;
  if (!haveDurations) {
    inner = `note("${names.join(' ')}").s("${instrument}")`;
  } else {
    const seconds = notes.map((n) =>
      Math.max(0.01, (n.durationMs || 0) / 1000).toFixed(3),
    );
    inner = `note("${names.map((n, i) => `${n}@${seconds[i]}`).join(' ')}").s("${instrument}")`;
  }

  const slow = opts.slowFactor;
  if (typeof slow === 'number' && slow > 1) {
    return `slow(${slow}).${inner}`;
  }
  return inner;
};
