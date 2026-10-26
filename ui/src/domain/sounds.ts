/**
 * sounds.ts — the catalogue of sounds wavecode can actually play.
 *
 * Why this file exists
 * --------------------
 * A `.s("…")` name is a LOOKUP in superdough's `soundMap`. A name that
 * is not in the map is not "quiet" — it is FATAL: superdough throws
 * `sound <name> not found! Is it loaded?` at trigger time, which
 * aborts the whole pattern, not just that layer. The whistle used to
 * commit `note("…").s("piano")`; `piano` was never registered (the
 * piano BANK registers `piano_a1…piano_c7`, and the bank-name alias
 * that used to cover it was dropped in
 * `decisions/wavecode-sample-bank-underscore`), so every whistled
 * take landed in the score as a snippet that threw on playback —
 * "ничего не звучит".
 *
 * This module is the single list of names that ARE registered, so the
 * instrument pickers can only offer sounds that work. The list is
 * verified against the shipped sample manifests and the shipped MP3
 * files by `sounds.test.ts` — a name that drifts out of the manifest
 * (or a manifest that lists a file nobody shipped) fails the test
 * rather than the user's ears.
 *
 * Two families, two sources
 * -------------------------
 *   - `oscillator` — registered by superdough's `registerSynthSounds()`
 *     at boot (pure Web Audio, no sample files): waveforms, supersaw,
 *     808 bass, noises. These are the sounds Strudel's own docs use
 *     (`s("sawtooth")`, `s("triangle")`).
 *   - `sample` — the three CC0 banks bundled under `public/samples/`
 *     and registered through `samples(manifestUrl)`: the drums, the
 *     Salamander piano, the analog synth.
 *
 * The melodic sounds (the ones that carry a `note(...)`) are the ones
 * the whistle / mic instrument pickers offer. The drum sounds are
 * one-shots: the whistle's transient detector maps a tapped rhythm
 * onto them (kick / snare / hat / click), and the score editor can
 * spell them by hand.
 */

/** Where a sound comes from — a pure oscillator or a shipped sample. */
export type SoundSource = 'oscillator' | 'sample';

export type SoundDef = {
  /** The name to write inside `.s("…")`. */
  readonly id: string;
  /** The label shown in the pickers (Russian). */
  readonly label: string;
  /** A short glyph for the compact pickers. */
  readonly glyph: string;
  readonly source: SoundSource;
  /**
   * The notes the sound can actually play, for the sample sounds.
   *
   * The piano bank ships A and C samples only (10 files), the synth
   * families 1-4 each. A note that is not in the list is still
   * playable — superdough picks the CLOSEST sample and transposes it
   * — but the list is what the UI shows as "this instrument's range",
   * and it is why the pickers can say how far a note will be
   * stretched.
   */
  readonly notes?: ReadonlyArray<string>;
};

/**
 * The oscillators superdough registers at boot
 * (`superdough/synth.mjs::registerSynthSounds`).
 *
 * They are pure Web Audio — no files, no network, always available.
 * `tri` / `sqr` / `saw` / `sin` are the short aliases the same
 * function registers; they are not listed separately because a picker
 * should show one entry per sound, not two spellings of it.
 */
export const OSCILLATOR_SOUNDS: ReadonlyArray<SoundDef> = [
  { id: 'triangle', label: 'Треугольник', glyph: '◺', source: 'oscillator' },
  { id: 'sawtooth', label: 'Пила', glyph: '◢', source: 'oscillator' },
  { id: 'square', label: 'Меандр', glyph: '▟', source: 'oscillator' },
  { id: 'sine', label: 'Синус', glyph: '∿', source: 'oscillator' },
  { id: 'supersaw', label: 'Суперпила', glyph: '⋀', source: 'oscillator' },
  { id: 'sbd', label: '808-бас', glyph: '𝄆', source: 'oscillator' },
  { id: 'brown', label: 'Шум (коричневый)', glyph: '░', source: 'oscillator' },
  { id: 'white', label: 'Шум (белый)', glyph: '▒', source: 'oscillator' },
  { id: 'pink', label: 'Шум (розовый)', glyph: '▓', source: 'oscillator' },
];

/**
 * The melodic sample sounds: the piano bank and the five synth
 * families. These are what the whistle and the mic panel offer as an
 * "instrument".
 */
export const SAMPLE_SOUNDS: ReadonlyArray<SoundDef> = [
  {
    id: 'piano',
    label: 'Пианино',
    glyph: '🎹',
    source: 'sample',
    notes: ['a1', 'a2', 'a3', 'a4', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
  },
  {
    id: 'synth_bass',
    label: 'Синт-бас',
    glyph: '🎚',
    source: 'sample',
    notes: ['c1', 'c2', 'e1', 'a1'],
  },
  {
    id: 'synth_pad',
    label: 'Синт-пэд',
    glyph: '🌫',
    source: 'sample',
    notes: ['c3', 'e3', 'g3', 'a3'],
  },
  {
    id: 'synth_lead',
    label: 'Синт-лид',
    glyph: '🎤',
    source: 'sample',
    notes: ['e4', 'g4'],
  },
  {
    id: 'synth_strings',
    label: 'Струнные',
    glyph: '🎻',
    source: 'sample',
    notes: ['c4'],
  },
  {
    id: 'synth_brass',
    label: 'Духовые',
    glyph: '🎺',
    source: 'sample',
    notes: ['c3'],
  },
];

/**
 * The drum one-shots of the bundled 808-style bank. They carry no
 * note — a drum hit is a hit — and they are what the whistle's
 * transient detector lands on when the user taps a rhythm.
 */
export const DRUM_SOUNDS: ReadonlyArray<SoundDef> = [
  { id: 'drums_bd', label: 'Бочка', glyph: '🥁', source: 'sample' },
  { id: 'drums_bd-sub', label: 'Саубочка', glyph: '◉', source: 'sample' },
  { id: 'drums_sd', label: 'Малый барабан', glyph: '🪘', source: 'sample' },
  { id: 'drums_rim', label: 'Рим', glyph: '◎', source: 'sample' },
  { id: 'drums_hh', label: 'Хай-хэт закрытый', glyph: '🔘', source: 'sample' },
  { id: 'drums_oh', label: 'Хай-хэт открытый', glyph: '☐', source: 'sample' },
  { id: 'drums_cp', label: 'Хлопок', glyph: '👏', source: 'sample' },
  { id: 'drums_cb', label: 'Ковбелл', glyph: '🔔', source: 'sample' },
  { id: 'drums_sh', label: 'Шейкер', glyph: '🪇', source: 'sample' },
  { id: 'drums_tom-l', label: 'Том низкий', glyph: '◉', source: 'sample' },
  { id: 'drums_tom-m', label: 'Том средний', glyph: '◍', source: 'sample' },
  { id: 'drums_tom-h', label: 'Том высокий', glyph: '◎', source: 'sample' },
  { id: 'drums_crash', label: 'Тарелка креш', glyph: '💥', source: 'sample' },
  { id: 'drums_ride', label: 'Райд-тарелка', glyph: '💫', source: 'sample' },
];

/** Every sound that can carry a `note(...)` — the note layer. */
export const MELODIC_SOUNDS: ReadonlyArray<SoundDef> = [
  ...OSCILLATOR_SOUNDS,
  ...SAMPLE_SOUNDS,
];

/** Every sound the app knows about. */
export const ALL_SOUNDS: ReadonlyArray<SoundDef> = [
  ...MELODIC_SOUNDS,
  ...DRUM_SOUNDS,
];

const SOUND_BY_ID: ReadonlyMap<string, SoundDef> = new Map(
  ALL_SOUNDS.map((s) => [s.id, s]),
);

/**
 * The pseudo-instrument of the "drums only" mode.
 *
 * It is not a registered sound — it never reaches a `.s("…")` — it
 * tells the snippet builder to DROP the note layer and commit only
 * the percussive hits. A tap is a drum hit; a sung note is a note.
 */
export const DRUMS_ONLY_ID = 'drums';

/** True for the "drums only" pseudo-instrument. */
export const isDrumsOnlyInstrument = (id: string): boolean =>
  id === DRUMS_ONLY_ID;

/**
 * The melodic sound the app's own code generators use when nobody
 * picked one.
 *
 * The piano is the default because it is the one melodic sound the
 * app ships as a SAMPLE (the Salamander bank) — it is the flagship
 * instrument of the presets, of the on-screen piano and of the piano
 * recorder. Every generator that emits a `.s("…")` name reads this
 * constant, so "the default" is one decision in one place instead of
 * a literal repeated in five modules.
 */
export const DEFAULT_MELODIC_SOUND = 'piano';

/**
 * The instrument list for the LLM prompt.
 *
 * The prompt is the one place where a wrong sound name does the most
 * damage: the model copies the names it is shown, and a name that
 * superdough does not know (`s("guitar")`, `s("synth")`,
 * `s("piano_a4")`) kills the WHOLE pattern at trigger time. So the
 * list is generated from the catalogue — the same list the pickers
 * offer and the same list the test pins against the library's own
 * soundMap. The prompt can no longer drift from what the app can
 * actually play.
 */
export const soundCatalogForPrompt = (): string => {
  const melodic = MELODIC_SOUNDS.map((s) => {
    const range = s.notes && s.notes.length > 0
      ? ` (сэмпл, ноты: ${s.notes.join(' ')})`
      : ' (осциллятор)';
    return `  ${s.id} — ${s.label}${range}`;
  });
  const drums = DRUM_SOUNDS.map((s) => `  ${s.id} — ${s.label}`);
  return [
    'МЕЛОДИЧЕСКИЕ (используй с note(...)):',
    ...melodic,
    '',
    'УДАРНЫЕ (одиночные сэмплы, без note(...)):',
    ...drums,
  ].join('\n');
};

/** The label of a sound id, or the id itself for an unknown name. */
export const soundLabel = (id: string): string =>
  SOUND_BY_ID.get(id)?.label ?? id;

/** The glyph of a sound id, or '♪' for an unknown name. */
export const soundGlyph = (id: string): string =>
  SOUND_BY_ID.get(id)?.glyph ?? '♪';

/** True when the id names a sound that can carry a `note(...)`. */
export const isMelodicSound = (id: string): boolean =>
  MELODIC_SOUNDS.some((s) => s.id === id);

/** The notes a sound can play, or an empty list for an unknown one. */
export const soundNotes = (id: string): ReadonlyArray<string> =>
  SOUND_BY_ID.get(id)?.notes ?? [];
