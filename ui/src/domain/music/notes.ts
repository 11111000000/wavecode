/**
 * MIDI note utilities. Pure functions — no Web API access.
 *
 * MIDI note numbering: 60 = Middle C (C4); A4 = 69; chromatic.
 * Range we support: C3 (48) .. B4 (71) — 24 keys.
 */

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const NOTE_NAMES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export type NoteName = string; // e.g. "C4", "F#3", "Bb5"

/** MIDI note → "C4" / "F#3" (sharp spelling by default). */
export const noteNumberToName = (midi: number, flat = false): NoteName => {
  const midiRound = Math.round(midi);
  const pitchClass = ((midiRound % 12) + 12) % 12;
  const octave = Math.floor(midiRound / 12) - 1;
  const names = flat ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return `${names[pitchClass]!}${octave}`;
};

/** Strudel expects lowercase scientific: "c4", "f#3", "a4". */
export const midiToStrudelNote = (midi: number): string =>
  noteNumberToName(midi).toLowerCase();

/** Returns the MIDI note for a Strudel-style note name (case-insensitive). */
export const strudelNoteToMidi = (note: string): number => {
  const m = /^([a-gA-G])([#bB]?)(-?\d+)$/.exec(note.trim());
  if (!m) return NaN;
  const letter = m[1] ?? '';
  const accidental = m[2] ?? '';
  const octStr = m[3] ?? '0';
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const octave = parseInt(octStr, 10);
  return (octave + 1) * 12 + ((base[letter.toLowerCase()] ?? 0) + offset);
};

/**
 * Strudel snippet that produces silence. Used by the on-screen piano to
 * explicitly silence the synth when the last key is released (otherwise
 * the previous note keeps ringing until its envelope decays).
 */
export const SILENCE_SNIPPET = 'silence';

/** Triangle-wave voice with a short piano-like envelope. Shared by
 *  `singleNoteSnippet` and each layer of `multiNoteSnippet` so both
 *  shapes stay byte-identical for a single note. */
const pianoVoice = (noteLc: string, gainLit: string): string =>
  `note("${noteLc}").s("triangle").attack(0.005).decay(0.4).sustain(0.1).gain(${gainLit})`;

/** Synthesize a single-note Strudel snippet with short envelope. */
export const singleNoteSnippet = (note: string): string => {
  const midi = strudelNoteToMidi(note);
  // NaN from unparseable names (e.g. "xx99") → fall back to A4. NaN
  // comparisons are all false, including NaN >= 0; we therefore guard
  // explicitly with Number.isFinite rather than `midi >= 0` alone.
  const safe = Number.isFinite(midi) && midi >= 0 ? note.toLowerCase() : 'a4';
  return pianoVoice(safe, '0.3');
};

/**
 * Multi-note piano snippet for polyphony.
 *
 * Rules:
 *   - 0 notes  → `SILENCE_SNIPPET` (Strudel silently plays nothing).
 *   - 1 note   → bare single voice (matches `singleNoteSnippet`).
 *   - 2+ notes → `stack(v1, v2, …)`, each voice carrying its own
 *                `.gain(0.3)` envelope.
 *
 * Per-voice gain stays at 0.3 (NOT scaled by sqrt(n)) — Strudel's
 * per-layer mixer in `application/useCases/injectMix` operates on each
 * top-level stack layer; pre-emptively dividing the gain would mask the
 * user's mixer choices. Downstream the user can solo/mute/trim via the
 * Mixer panel.
 *
 * Notes that fail to parse are dropped silently (matches single-note
 * behaviour, where an invalid name falls back to 'a4' — but here we
 * drop because a fallback would surprise the user by adding an extra
 * note they didn't press).
 */
export const multiNoteSnippet = (notes: ReadonlySet<string>): string => {
  const voices: string[] = [];
  for (const n of notes) {
    const midi = strudelNoteToMidi(n);
    // `NaN >= 0` is false but NaN is the actual unparseable signal —
    // not < 0 (negative MIDI numbers are not a thing in Strudel, but
    // the proper invariant here is "did we get a number back at all?").
    if (!Number.isFinite(midi) || midi < 0) continue;
    voices.push(pianoVoice(n.toLowerCase(), '0.3'));
  }
  if (voices.length === 0) return SILENCE_SNIPPET;
  if (voices.length === 1) return voices[0]!;
  return `stack(\n  ${voices.join(',\n  ')}\n)`;
};

/** Range we support on on-screen + MIDI input. */
export const PIANO_RANGE = { min: 48, max: 71 } as const; // C3..B4

/** Is the MIDI note within on-screen range? */
export const isInPianoRange = (midi: number): boolean =>
  midi >= PIANO_RANGE.min && midi <= PIANO_RANGE.max;

/** Build list of all MIDI note numbers in range. */
export const rangeNotes = (): ReadonlyArray<number> => {
  const out: number[] = [];
  for (let n = PIANO_RANGE.min; n <= PIANO_RANGE.max; n += 1) out.push(n);
  return out;
};

/** True if note is a "black" key (sharp/flat). */
export const isBlackKey = (midi: number): boolean => {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
};
