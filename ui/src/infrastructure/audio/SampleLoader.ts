/**
 * Sample loaders — register CC0 sample banks (piano + drums) with
 * Strudel. Lazy: each loader is called on first `s('bank:...')` use
 * and is idempotent within a session.
 *
 * Strudel exposes `samples` globally via `evalScope` (set up by
 * LiveAudioEngine on first audio init). We declare it here as a
 * global function.
 *
 * Samples bundled in `public/samples/` (Vite copies to dist/).
 *   - piano/ — Salamander Grand Piano v3 (CC0, 10 MP3s)
 *   - drums/ — 14 808-style one-shots (CC0, see LICENSE.txt)
 */

declare global {
  function samples(map: Record<string, string>): void;
}

let pianoLoaded = false;
let drumsLoaded = false;

const PIANO_BANK = './samples/piano/';
const DRUMS_BANK = './samples/drums/';

const registerBank = (bank: Record<string, string>, flag: 'piano' | 'drums'): void => {
  if (typeof samples === 'undefined') {
    // Strudel evalScope not yet initialized — defer to next attempt.
    return;
  }
  try {
    samples(bank);
    if (flag === 'piano') pianoLoaded = true;
    if (flag === 'drums') drumsLoaded = true;
  } catch (err) {
    if (flag === 'piano') pianoLoaded = false;
    if (flag === 'drums') drumsLoaded = false;
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

export const loadAllSamples = (): void => {
  loadPianoSamples();
  loadDrumSamples();
};

export const areAllSamplesLoaded = (): boolean => pianoLoaded && drumsLoaded;
