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
  function samples(arg: string | Record<string, unknown>): void;
}

let pianoLoaded = false;
let drumsLoaded = false;
let synthLoaded = false;

// Strudel's `samples()` API:
// - String arg: fetchSampleMap — fetches the URL, parses as JSON, registers
//   each entry under the entry name. URL must point to a strudel.json manifest.
// - Object arg: direct name→urls map (no bank prefix).
// We use the string form (manifests) because each bank has 10+ files.
const PIANO_BANK = './samples/piano/strudel.json';
const DRUMS_BANK = './samples/drums/strudel.json';
const SYNTH_BANK = './samples/synth/strudel.json';

const registerBank = (
  manifestPath: string,
  flag: 'piano' | 'drums' | 'synth',
): void => {
  if (typeof samples === 'undefined') {
    // Strudel evalScope not yet initialized — defer to next attempt.
    return;
  }
  try {
    // samples() with a string arg fetches the URL, parses as strudel.json,
    // and registers each entry under its name. The sample name in the score
    // (e.g. `s("bd")` or `s("drums:bd")` after a bank prefix) is then
    // resolved against the global soundMap. We use bare names (no bank
    // prefix) so `s("bd")` resolves directly.
    samples(manifestPath);
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
  registerBank(PIANO_BANK, 'piano');
};

export const loadDrumSamples = (): void => {
  if (drumsLoaded) return;
  registerBank(DRUMS_BANK, 'drums');
};

/**
 * Register the synth sample bank (CC0 analog bass + pad + lead +
 * strings + brass, ~1.3MB). Idempotent: no-op on second call.
 */
export const loadSynthSamples = (): void => {
  if (synthLoaded) return;
  registerBank(SYNTH_BANK, 'synth');
};

export const loadAllSamples = (): void => {
  loadPianoSamples();
  loadDrumSamples();
  loadSynthSamples();
};

export const areAllSamplesLoaded = (): boolean =>
  pianoLoaded && drumsLoaded && synthLoaded;
