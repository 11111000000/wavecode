/**
 * Whistle → MIDI pipeline: pure helpers, no Web APIs.
 *
 * Pipeline:
 *   mic (getUserMedia)
 *     → AudioContext  (sampleRate negotiation)
 *     → MediaStreamSource → AnalyserNode (getFloatTimeDomainData)
 *     → requestAnimationFrame poll (~30Hz)
 *     → Worker (pitchy YIN) → frame { hz, clarity, rms }
 *     → feed(frames, state) → AudioNote[]
 *     → notesToSnippet(notes) → Strudel code
 *
 * This file owns the parts that don't need a Worker / DOM / WebRTC:
 *   - hzToMidi: Hz → { midi, cents } (pure math, used by both Worker and main)
 *   - WhistleState machine: open-note + closed-notes segmentation
 *   - notesToSnippet: emit `note("c4 eb4 g4").s("piano")` style
 *
 * Why pure
 * --------
 * The audio/State pipeline (RMS gate → YIN → segmentation → snippet) is
 * split into a Worker (YIN) and a main-thread segmenter. The segmenter
 * must be testable without a DOM, so its delta lives here and the
 * implementation in `infrastructure/audio/WhistleDetector.ts` is just a
 * thin RAF driver around these pure functions.
 *
 * Glossary:
 *   - PitchFrame = one YIN result + RMS energy from the analyser
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

export type WhistleTune = {
  readonly silenceGate: number;
  readonly clarityGate: number;
  readonly minHz: number;
  readonly maxHz: number;
  readonly minNoteMs: number;
  readonly noteVarianceCents: number;
};

export const DEFAULT_TUNE: WhistleTune = {
  silenceGate: 0.012,
  clarityGate: 0.85,
  minHz: 75,
  maxHz: 1500,
  minNoteMs: 80,
  noteVarianceCents: 50,
};

export type OpenNote = {
  readonly midi: number;
  readonly startMs: number;
  readonly centsSum: number;
  readonly centsN: number;
};

export type WhistleState = {
  readonly openNote: OpenNote | null;
  readonly notes: ReadonlyArray<AudioNote>;
};

export const initialWhistleState = (): WhistleState => ({
  openNote: null,
  notes: [],
});

export const hzToMidi = (hz: number): { readonly midi: number; readonly cents: number } => {
  if (!Number.isFinite(hz) || hz <= 0) return { midi: 0, cents: 0 };
  const midi = 69 + 12 * Math.log2(hz / 440);
  const midiRound = Math.round(midi);
  const cents = Math.round((midi - midiRound) * 100);
  return { midi: midiRound, cents };
};

const frameIsPitch = (f: PitchFrame, t: WhistleTune): boolean =>
  f.hz !== null
  && Number.isFinite(f.hz)
  && f.clarity >= t.clarityGate
  && f.hz >= t.minHz
  && f.hz <= t.maxHz;

/**
 * Append-style state transition. Returns a NEW WhistleState (we never
 * mutate the input — keeps `feed()` pure for tests + replay).
 *
 * Three cases per frame:
 *   1. Silence / below-gate frame → close open note if any, append it
 *      to notes if it crosses minNoteMs.
 *   2. Pitched frame, no open note → open a new note.
 *   3. Pitched frame, has open note →
 *      a. same midi as open (within noteVarianceCents) → extend
 *      b. different midi → close old, open new.
 */
export const feed = (
  state: WhistleState,
  frame: PitchFrame,
  tune: WhistleTune = DEFAULT_TUNE,
  nowMs: number = frame.timestampMs,
): WhistleState => {
  const hasPitch = frame.rms >= tune.silenceGate && frameIsPitch(frame, tune);

  if (!hasPitch) {
    if (state.openNote === null) return state;
    const durationMs = nowMs - state.openNote.startMs;
    if (durationMs < tune.minNoteMs) {
      return { openNote: null, notes: state.notes };
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
    };
  }

  const { midi, cents } = hzToMidi(frame.hz!);

  if (state.openNote === null) {
    return {
      openNote: { midi, startMs: nowMs, centsSum: cents, centsN: 1 },
      notes: state.notes,
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
  };
};

/** Force-close any open note. Used by `WhistlePanel` "freeze" button
 *  and at `getUserMedia` stream teardown. */
export const closeOpenNote = (
  state: WhistleState,
  nowMs: number,
  minNoteMs: number = DEFAULT_TUNE.minNoteMs,
): WhistleState => {
  if (state.openNote === null) return state;
  const durationMs = nowMs - state.openNote.startMs;
  if (durationMs < minNoteMs) {
    return { openNote: null, notes: state.notes };
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
  };
};

export type WhistleSnippetOptions = {
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
 *   notesToSnippet([60, 64, 67]) → 'note("c4 e4 g4").s("piano")'
 *
 * Cents offset is intentionally dropped — Strudel snippets don't carry
 * micro-tuning, and average-cents over a whistle is mostly breath noise.
 */
export const notesToSnippet = (
  notes: ReadonlyArray<AudioNote>,
  opts: WhistleSnippetOptions = {},
): string | null => {
  if (notes.length === 0) return null;
  const instrument = opts.instrument ?? 'piano';
  const names = notes.map((n) => noteNumberToName(n.midi).toLowerCase());
  const inner = `note("${names.join(' ')}").s("${instrument}")`;
  const slow = opts.slowFactor;
  if (typeof slow === 'number' && slow > 1) {
    return `slow(${slow}).${inner}`;
  }
  return inner;
};
