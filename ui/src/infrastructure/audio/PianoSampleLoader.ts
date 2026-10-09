/**
 * Piano sample loader — registers Salamander Grand Piano v3 (CC0)
 * with Strudel. Lazy: called on first `s('piano:...')` invocation.
 *
 * Strudel exposes `samples` globally via `evalScope` (set up by
 * LiveAudioEngine on first audio init). We declare it here as a
 * global function.
 *
 * Samples bundled in `public/samples/piano/` (Vite copies to dist/).
 */

declare global {
  function samples(map: Record<string, string>): void;
}

let loaded = false;

export const loadPianoSamples = (): void => {
  if (loaded) return;
  if (typeof samples === 'undefined') {
    // Strudel evalScope not yet initialized — defer to next attempt.
    return;
  }
  loaded = true;
  try {
    samples({ piano: './samples/piano/' });
  } catch (err) {
    loaded = false;
    console.warn('[PianoSampleLoader] failed to register piano bank:', err);
  }
};
