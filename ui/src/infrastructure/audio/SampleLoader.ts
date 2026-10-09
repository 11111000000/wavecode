/**
 * Sample loaders — register CC0 sample banks (piano + drums + synth)
 * with Strudel. Lazy: each loader is called on first `s('bank:...')`
 * use and is idempotent within a session.
 *
 * Strudel exposes `samples` globally via `evalScope` (set up by
 * LiveAudioEngine on first audio init). We declare it here as a
 * global function.
 *
 * Samples bundled in `public/samples/` (Vite copies to dist/).
 *   - piano/ — Salamander Grand Piano v3 (CC0, 10 MP3s)
 *   - drums/ — 14 808-style one-shots (CC0, see LICENSE.txt)
 *   - synth/ — 12 analog-synth notes (CC0, bass + pad + lead +
 *              strings + brass, ~1.3MB)
 */

declare global {
  function samples(map: Record<string, string>): void;
}

let pianoLoaded = false;
let drumsLoaded = false;
let synthLoaded = false;

const PIANO_BANK = './samples/piano/strudel.json';
const DRUMS_BANK = './samples/drums/strudel.json';
const SYNTH_BANK = './samples/synth/strudel.json';

const registerBank = (
  bank: Record<string, string>,
  flag: 'piano' | 'drums' | 'synth',
): void => {
  if (typeof samples === 'undefined') {
    // Strudel evalScope not yet initialized — defer to next attempt.
    return;
  }
  try {
    samples(bank);
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
  registerBank({ piano: PIANO_BANK }, 'piano');
};

export const loadDrumSamples = (): void => {
  if (drumsLoaded) return;
  registerBank({ drums: DRUMS_BANK }, 'drums');
};

/**
 * Register the synth sample bank (CC0 analog bass + pad + lead +
 * strings + brass, ~1.3MB). Idempotent: no-op on second call.
 */
export const loadSynthSamples = (): void => {
  if (synthLoaded) return;
  registerBank({ synth: SYNTH_BANK }, 'synth');
};

export const loadAllSamples = (): void => {
  loadPianoSamples();
  loadDrumSamples();
  loadSynthSamples();
};

export const areAllSamplesLoaded = (): boolean =>
  pianoLoaded && drumsLoaded && synthLoaded;
