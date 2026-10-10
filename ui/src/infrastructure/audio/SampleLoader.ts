/**
 * Sample loaders — register CC0 sample banks (piano + drums + synth)
 * with Strudel. Each loader is called from `loadAllSamples()` at
 * app boot.
 *
 * Strudel exposes `samples` globally via `evalScope` (set up by
 * LiveAudioEngine on first audio init).
 *
 * We pass the absolute path of the strudel.json manifest, which
 * fetchSampleMap() reads, parses, and registers each entry as a
 * sound name in the global soundMap. Sample names with a `:`
 * become bank prefix lookups (`s("drums:bd")` → key `drums:bd`).
 *
 * Samples bundled in `public/samples/` (Vite copies to dist/).
 *   - piano/ — Salamander Grand Piano v3 (CC0, 10 MP3s)
 *   - drums/ — 14 808-style one-shots (CC0, Freesound previews)
 *   - synth/ — 12 analog-synth notes (CC0, Freesound previews)
 */

declare global {
  function samples(arg: string | Record<string, unknown>): void;
}

let pianoLoaded = false;
let drumsLoaded = false;
let synthLoaded = false;

const PIANO_MANIFEST = '/samples/piano/strudel.json';
const DRUMS_MANIFEST = '/samples/drums/strudel.json';
const SYNTH_MANIFEST = '/samples/synth/strudel.json';

const registerBank = (
  manifestUrl: string,
  flag: 'piano' | 'drums' | 'synth',
): void => {
  if (typeof samples === 'undefined') {
    // Strudel evalScope not yet initialized — defer to next attempt.
    return;
  }
  try {
    samples(manifestUrl);
    if (flag === 'piano') pianoLoaded = true;
    if (flag === 'drums') drumsLoaded = true;
    if (flag === 'synth') synthLoaded = true;
  } catch (err) {
    if (flag === 'piano') pianoLoaded = false;
    if (flag === 'drums') drumsLoaded = false;
    if (flag === 'synth') synthLoaded = false;
    console.warn(`[SampleLoader] failed to register ${flag} bank:`, err);
  }
};

export const loadPianoSamples = (): void => {
  if (pianoLoaded) return;
  registerBank(PIANO_MANIFEST, 'piano');
};

export const loadDrumSamples = (): void => {
  if (drumsLoaded) return;
  registerBank(DRUMS_MANIFEST, 'drums');
};

export const loadSynthSamples = (): void => {
  if (synthLoaded) return;
  registerBank(SYNTH_MANIFEST, 'synth');
};

export const loadAllSamples = (): void => {
  loadPianoSamples();
  loadDrumSamples();
  loadSynthSamples();
};

export const areAllSamplesLoaded = (): boolean =>
  pianoLoaded && drumsLoaded && synthLoaded;
