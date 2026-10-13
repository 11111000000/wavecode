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
 * Concurrency: `preloadAllBuffers` runs at most 4 decodes in parallel
 * (via `withConcurrency`). AudioContext.decodeAudioData is serialized
 * on the audio thread per browser; 4 is a good balance between
 * throughput (more parallelism → faster wall-clock) and
 * over-decode (too many parallel decodes compete for the main thread
 * and stall the scheduler). 36 URLs across the three banks (10 piano
 * + 14 drums + 12 synth) → ~9 batches at limit 4.
 *
 * Progress: `onProgress(loaded, total)` fires after each buffer
 * resolves. The total is computed once at the start of the preload
 * (so it does not drift mid-flight).
 *
 * Samples bundled in `public/samples/` (Vite copies to dist/).
 *   - piano/ — Salamander Grand Piano v3 (CC0, 10 MP3s)
 *   - drums/ — 14 808-style one-shots (CC0, Freesound previews)
 *   - synth/ — 12 analog-synth notes (CC0, Freesound previews)
 */

import { samples, soundMap, loadBuffer, getAudioContext } from '@strudel/webaudio';
import { withConcurrency } from './withConcurrency';
import { isInServiceWorkerCache } from './swCache';
import {
  SAMPLE_PROGRESS_EVENT,
  type SampleProgressEvent,
  type SampleProgressStatus,
} from './sampleProgressEvent';

export type { SampleProgressEvent, SampleProgressStatus } from './sampleProgressEvent';

export const SAMPLE_PROGRESS_EVENT_NAME = SAMPLE_PROGRESS_EVENT;

export type LoadOptions = {
  onProgress?: (loaded: number, total: number) => void;
};

export type BankName = 'piano' | 'drums' | 'synth';

export type SampleLoadProgress = {
  loaded: number;
  total: number;
  perBank: Record<BankName, { loaded: number; total: number }>;
};

/**
 * Per-URL promise dedupe — multiple callers awaiting the same URL share
 * one `caches.match()` roundtrip. Cleared on page reload (module-scope).
 */
const cacheCheckInflight = new Map<string, Promise<boolean>>();

/**
 * Public SW-cache probe for sample URLs. Dedupe-wrapped around
 * `isInServiceWorkerCache` so the heavy lifting (iterating every
 * cache name + match) happens at most once even if `preloadAllBuffers`
 * fires it 4× per URL concurrently.
 */
export const isSampleCached = (url: string): Promise<boolean> => {
  const cached = cacheCheckInflight.get(url);
  if (cached) return cached;
  const p = isInServiceWorkerCache(url).finally(() => {
    cacheCheckInflight.delete(url);
  });
  cacheCheckInflight.set(url, p);
  return p;
};

type BankState = {
  status: 'idle' | 'loading' | 'loaded' | 'failed';
  inflight: Promise<void> | null;
  loaded: number;
  total: number;
};

const PIANO_MANIFEST = '/samples/piano/strudel.json';
const DRUMS_MANIFEST = '/samples/drums/strudel.json';
const SYNTH_MANIFEST = '/samples/synth/strudel.json';

const piano: BankState = { status: 'idle', inflight: null, loaded: 0, total: 0 };
const drums: BankState = { status: 'idle', inflight: null, loaded: 0, total: 0 };
const synth: BankState = { status: 'idle', inflight: null, loaded: 0, total: 0 };

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

const collectSampleUrls = (dict: SoundMapSnapshot): string[] => {
  const urls: string[] = [];
  for (const [, entry] of Object.entries(dict)) {
    const data = entry.data as { type?: string; samples?: unknown };
    if (data.type !== 'sample' || !data.samples) continue;
    const samples = data.samples;
    if (Array.isArray(samples)) {
      for (const url of samples) {
        if (typeof url === 'string') urls.push(url);
      }
    } else if (typeof samples === 'object' && samples !== null) {
      for (const urlList of Object.values(samples as Record<string, unknown>)) {
        if (Array.isArray(urlList)) {
          for (const url of urlList) {
            if (typeof url === 'string') urls.push(url);
          }
        }
      }
    }
  }
  return urls;
};

const PRELOAD_CONCURRENCY = 4;

type PreloadState = {
  loaded: number;
  total: number;
  onProgress?: ((loaded: number, total: number) => void) | undefined;
  onProgressEvent?: ((evt: SampleProgressEvent) => void) | undefined;
};

/**
 * Collect every sample URL registered by `samples()` and eagerly
 * fetch+decode via `loadBuffer()`. Populates superdough's internal
 * `tt[url]` promise cache so subsequent haps hit it immediately.
 *
 * Without this, the very first haps of a preset drop with
 *   "[sampler] memory sound 'bd:0' took too long"
 * because `fetch().arrayBuffer().decodeAudioData()` takes 80–160 ms and
 * the audio context time advances past the scheduled start.
 *
 * SW-cache short-circuit: URLs that are already in the Service Worker
 * cache are SKIPPED at the `loadBuffer` step but still counted in
 * `loaded`/`total`. Rationale: the audio context will fetch the
 * decoded buffer from the SW cache on first play (one round-trip,
 * no re-decode). Skipping the explicit `loadBuffer` call removes a
 * redundant double-fetch. The race against the audio scheduler is
 * closed at the audio context level (cached) rather than the network
 * level (uncached → fetch). If the SW cache doesn't actually have
 * the file, the audio context's own fetch will populate it, and the
 * next preload run will skip. URL/network level differences are not
 * surfaced here — failures are swallowed for symmetry with the
 * non-cached branch above.
 *
 * `onProgress(loaded, total)` fires after every successful (or
 * failed-but-acknowledged) buffer resolution. Failures are not
 * surfaced — we use `Promise.allSettled` semantics so a single bad
 * URL does not block the rest of the bank. The total is computed
 * once at the start of the preload.
 */
const preloadAllBuffers = async (state: PreloadState): Promise<void> => {
  const dict = soundMap.get() as SoundMapSnapshot;
  // Touch the audio context so `getAudioContext()` returns a live ctx that
  // can decode. If the user hasn't interacted yet, `getAudioContext()`
  // returns a suspended ctx — `decodeAudioData` still works on it.
  // `unlockAudioContext()` is invoked later by LiveAudioEngine.eval() once
  // the user clicks Play.
  const ac = getAudioContext();
  const urls = collectSampleUrls(dict);
  state.total = urls.length;
  state.loaded = 0;
  state.onProgress?.(0, urls.length);
  state.onProgressEvent?.({ loaded: 0, total: urls.length, status: 'loading' });
  await withConcurrency(urls, PRELOAD_CONCURRENCY, async (url) => {
    try {
      const cached = await isSampleCached(url);
      if (!cached) {
        await loadBuffer(url, ac, url);
      }
    } catch {
      // Swallow individual decode failures — see comment above.
    }
    state.loaded += 1;
    state.onProgress?.(state.loaded, state.total);
    state.onProgressEvent?.({ loaded: state.loaded, total: state.total, status: 'loading' });
  });
};

const registerBank = (
  manifestUrl: string,
  state: BankState,
  opts: LoadOptions = {},
): Promise<void> => {
  if (state.status === 'loaded') return Promise.resolve();
  if (state.inflight) return state.inflight;
  state.status = 'loading';
  state.inflight = (async () => {
    const emit = (loaded: number, total: number, status: SampleProgressStatus): void => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(new CustomEvent(SAMPLE_PROGRESS_EVENT, {
        detail: { loaded, total, status },
      }));
    };
    try {
      await samples(manifestUrl);
      addBareAliases();
      const preloadState: PreloadState = {
        loaded: 0,
        total: 0,
        onProgress: opts.onProgress,
        onProgressEvent: (e) => emit(e.loaded, e.total, e.status),
      };
      emit(0, 0, 'loading');
      await preloadAllBuffers(preloadState);
      state.loaded = preloadState.loaded;
      state.total = preloadState.total;
      state.status = 'loaded';
      emit(state.loaded, state.total, 'loaded');
    } catch (err) {
      state.status = 'failed';
      console.warn(`[SampleLoader] failed to register bank (${manifestUrl}):`, err);
      emit(state.loaded, state.total, 'error');
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
};

export const loadPianoSamples = (opts: LoadOptions = {}): Promise<void> =>
  registerBank(PIANO_MANIFEST, piano, opts);

export const loadDrumSamples = (opts: LoadOptions = {}): Promise<void> =>
  registerBank(DRUMS_MANIFEST, drums, opts);

export const loadSynthSamples = (opts: LoadOptions = {}): Promise<void> =>
  registerBank(SYNTH_MANIFEST, synth, opts);

export const loadAllSamples = (opts: LoadOptions = {}): Promise<void> => {
  // Fire all three in parallel; failures are isolated per-bank by
  // registerBank. Returned promise resolves when the LAST bank
  // settles. The onProgress callback fires for every buffer across
  // every bank — callers that want per-bank splits should subscribe
  // to getSampleLoadProgress() instead.
  return Promise.all([
    loadPianoSamples(opts),
    loadDrumSamples(opts),
    loadSynthSamples(opts),
  ]).then(() => undefined);
};

export const areAllSamplesLoaded = (): boolean =>
  piano.status === 'loaded'
  && drums.status === 'loaded'
  && synth.status === 'loaded';

const sum = (a: number, b: number): number => a + b;

/**
 * Current sample-load progress. Each bank tracks its own loaded/total
 * count (computed once at the start of its preload). The aggregate
 * `loaded`/`total` is the sum of all three banks.
 *
 * Useful for UI: poll this every animation frame to drive a "Loading
 * 36/36 samples…" indicator.
 */
export const getSampleLoadProgress = (): SampleLoadProgress => ({
  loaded: [piano.loaded, drums.loaded, synth.loaded].reduce(sum, 0),
  total: [piano.total, drums.total, synth.total].reduce(sum, 0),
  perBank: {
    piano: { loaded: piano.loaded, total: piano.total },
    drums: { loaded: drums.loaded, total: drums.total },
    synth: { loaded: synth.loaded, total: synth.total },
  },
});
