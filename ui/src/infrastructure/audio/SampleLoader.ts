/**
 * Sample loaders — register CC0 sample banks (piano + drums + synth)
 * with Strudel. Each loader is called from `loadAllSamples()` at
 * app boot.
 *
 * Strudel API contract:
 *   `samples(manifestUrl)` is exported from superdough (re-exported by
 *   @strudel/webaudio via `export * from "superdough"`). It fetches the
 *   strudel.json, maps each entry into the shared `soundMap`, and the
 *   bank prefix lookup `s("drums:bd")` becomes a lookup of
 *   `soundMap["drums_bd"]` — see superdough/superdough.mjs:538-539:
 *     if (bank && s) s = `${bank}_${s}`;
 *
 * CRITICAL: import from '@strudel/webaudio' via STATIC import. When Vite
 * bundles @strudel/webaudio together with its superdough dep, a dynamic
 * `import('superdough')` at runtime resolves to a SEPARATE module instance
 * and SEPARATE soundMap. The static import (hoisted by Vite) resolves to
 * the SAME instance used by webaudioRepl → soundMap writes go to the
 * right place. (See: git log master fix(audio))
 *
 * strudel.json key convention: keys use `_` (underscore) to join bank
 * prefix with sound name — the same format Strudel builds at runtime via
 * `${bank}_${s}`. Keys like `drums_bd` make `s("drums:bd")` resolve.
 *
 * Bare-name aliases: many legacy presets use bare sound names like
 * `s("bd")` (no bank prefix). For each `bank_sound` key in soundMap,
 * we register a bare `sound` alias that points to the same data. This
 * makes both syntaxes work:
 *   s("drums:bd")  → soundMap["drums_bd"]
 *   s("bd")       → soundMap["bd"]    (alias → drums_bd's data)
 *
 * Synth keys like `synth_bass-c2` produce alias `bass-c2` (the part
 * after the first underscore). Hyphens in the sound name are preserved.
 * If multiple keys would produce the same alias, the alias is created
 * only once (first wins) to avoid overwriting.
 *
 * Eager preload: after `samples()` registers the banks, we eagerly
 * fetch and decode every sample URL via `loadBuffer()`. This populates
 * superdough's internal `tt[url]` cache so the FIRST haps (which would
 * lose their audio context race against the decoder) hit a warm cache.
 * Without this, presets with fast sequences (`s("bd sd hh bd sd hh")`)
 * drop the first 1-2 haps with the warning:
 *   "[sampler] loading sound 'bd:0' took too long"
 * See: superdough/dist/index.mjs:989 — early-return skips playback when
 * `audioContext.currentTime > scheduled start`.
 *
 * Samples bundled in `public/samples/` (Vite copies to dist/).
 *   - piano/ — Salamander Grand Piano v3 (CC0, 10 MP3s)
 *   - drums/ — 14 808-style one-shots (CC0, Freesound previews)
 *   - synth/ — 12 analog-synth notes (CC0, Freesound previews)
 */

import { samples, soundMap, loadBuffer, getAudioContext } from '@strudel/webaudio';

type BankState = { status: 'idle' | 'loading' | 'loaded' | 'failed'; inflight: Promise<void> | null };

const PIANO_MANIFEST = '/samples/piano/strudel.json';
const DRUMS_MANIFEST = '/samples/drums/strudel.json';
const SYNTH_MANIFEST = '/samples/synth/strudel.json';

const piano: BankState = { status: 'idle', inflight: null };
const drums: BankState = { status: 'idle', inflight: null };
const synth: BankState = { status: 'idle', inflight: null };

type SoundEntry = { onTrigger: unknown; data: unknown };
type SoundMapSnapshot = Record<string, SoundEntry>;

const addBareAliases = (): number => {
  const dict = soundMap.get() as SoundMapSnapshot;
  const updates: SoundMapSnapshot = {};
  for (const key of Object.keys(dict)) {
    const idx = key.indexOf('_');
    if (idx <= 0) continue;
    const alias = key.slice(idx + 1);
    if (alias.length === 0 || alias.includes('_')) continue;
    if (dict[alias] !== undefined) continue;
    const entry = dict[key];
    if (entry === undefined) continue;
    updates[alias] = entry;
  }
  if (Object.keys(updates).length > 0) {
    soundMap.set({ ...dict, ...updates });
  }
  return Object.keys(updates).length;
};

/**
 * Collect every sample URL registered by `samples()` and eagerly
 * fetch+decode via `loadBuffer()`. Populates superdough's internal
 * `tt[url]` promise cache so subsequent haps hit it immediately.
 *
 * Without this, the very first haps of a preset drop with
 *   "[sampler] loading sound 'bd:0' took too long"
 * because `fetch().arrayBuffer().decodeAudioData()` takes 80–160 ms and
 * the audio context time advances past the scheduled start.
 */
const preloadAllBuffers = async (): Promise<void> => {
  const dict = soundMap.get() as SoundMapSnapshot;
  // Touch the audio context so `getAudioContext()` returns a live ctx that
  // can decode. If the user hasn't interacted yet, `getAudioContext()`
  // returns a suspended ctx — `decodeAudioData` still works on it.
  // `unlockAudioContext()` is invoked later by LiveAudioEngine.eval() once
  // the user clicks Play.
  const ac = getAudioContext();
  const promises: Promise<unknown>[] = [];
  for (const [key, entry] of Object.entries(dict)) {
    const data = entry.data as { type?: string; samples?: unknown };
    if (data.type !== 'sample' || !data.samples) continue;
    const samples = data.samples;
    if (Array.isArray(samples)) {
      for (const url of samples) {
        if (typeof url === 'string') promises.push(loadBuffer(url, ac, key));
      }
    } else if (typeof samples === 'object' && samples !== null) {
      for (const urlList of Object.values(samples as Record<string, unknown>)) {
        if (Array.isArray(urlList)) {
          for (const url of urlList) {
            if (typeof url === 'string') promises.push(loadBuffer(url, ac, key));
          }
        }
      }
    }
  }
  // Don't block the registration promise — preload in parallel.
  // Failures are non-fatal (browser may already have the file under
  // HTTP cache; subsequent requests retry naturally).
  void Promise.allSettled(promises);
};

const registerBank = (manifestUrl: string, state: BankState): Promise<void> => {
  if (state.status === 'loaded') return Promise.resolve();
  if (state.inflight) return state.inflight;
  state.status = 'loading';
  state.inflight = (async () => {
    try {
      await samples(manifestUrl);
      addBareAliases();
      preloadAllBuffers();
      state.status = 'loaded';
    } catch (err) {
      state.status = 'failed';
      console.warn(`[SampleLoader] failed to register bank (${manifestUrl}):`, err);
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
};

export const loadPianoSamples = (): void => {
  void registerBank(PIANO_MANIFEST, piano);
};

export const loadDrumSamples = (): void => {
  void registerBank(DRUMS_MANIFEST, drums);
};

export const loadSynthSamples = (): void => {
  void registerBank(SYNTH_MANIFEST, synth);
};

export const loadAllSamples = (): void => {
  loadPianoSamples();
  loadDrumSamples();
  loadSynthSamples();
};

export const areAllSamplesLoaded = (): boolean =>
  piano.status === 'loaded'
  && drums.status === 'loaded'
  && synth.status === 'loaded';