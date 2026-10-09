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

/** Synthesize a single-note Strudel snippet with short envelope. */
export const singleNoteSnippet = (note: string): string =>
  `note("${(strudelNoteToMidi(note) >= 0 ? note : 'a4').toLowerCase()}").s("triangle").attack(0.005).decay(0.4).sustain(0.1).gain(0.3)`;

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
