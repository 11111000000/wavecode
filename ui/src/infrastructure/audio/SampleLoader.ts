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
 * Decode worker
 * -------------
 * Eager preload used to fire `superdough.loadBuffer(url, ac, label)` on
 * the MAIN THREAD for every sample URL — `fetch().arrayBuffer().
 * decodeAudioData()` for ~36 URLs blocked the main thread for ~500ms
 * at boot, racing the audio scheduler. Phase 1 cap (withConcurrency=4)
 * eased this, but the decode itself remained in-thread.
 *
 * This module now delegates every preload decode to a dedicated Web
 * Worker (`./decodeWorker?worker`). The Worker holds a single
 * `OfflineAudioContext` and replies with raw PCM as a Float32Array
 * (transferable, zero-copy). The main thread reconstructs an
 * `AudioBuffer` from the PCM (cheap typed-array copy), stashes it in
 * `warmCache`, and returns it to the caller.
 *
 * Why a Worker: `OfflineAudioContext.decodeAudioData` is allowed in
 * dedicated Workers (it doesn't render into the destination, so no
 * audio thread interaction is needed). Moving decode off the main
 * thread frees the scheduler / UI from the per-URL decode cost.
 *
 * Phase-1 / Phase-2 split (documented in math packet):
 * - Phase 1 (this commit): worker-decoded buffers populate `warmCache`.
 *   The main thread is free during preload.
 * - Phase 2 (separate commit): wrap superdough's `loadBuffer` so the
 *   runtime hap path consults `warmCache` first. This commit cannot
 *   reach into superdough's internal `tt[url]` cache (it's a private
 *   Map keyed by URL), so superdough's runtime path will still
 *   fetch+decode from scratch for now. The preload is then effectively
 *   a pre-warm of the SW cache + a populated-but-unused warmCache.
 *   The user's main thread is no longer pegged at app boot, which
 *   was the original failure mode (UI hung for ~500ms).
 *
 * Concurrency: `preloadAllBuffers` runs at most 4 worker-decodes in
 * parallel (via `withConcurrency`). The Worker is single-threaded so
 * the Worker itself serializes decodes internally, but the
 * `postMessage` ↔ `onmessage` roundtrip has main-thread scheduling
 * overhead we don't need to amplify. 4 in-flight at the message
 * boundary keeps the Worker fed without queueing 36 messages at once.
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

import { samples, soundMap, getAudioContext } from '@strudel/webaudio';
import DecodeWorker from './decodeWorker?worker';
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

/**
 * Decode Worker plumbing.
 *
 * Inbound: `{ type: 'decode', id, url, sampleRate }`
 * Outbound: `{ type: 'decode:ok', id, buffer: ArrayBuffer (transferable),
 *             sampleRate, numberOfChannels, duration }` OR
 *           `{ type: 'decode:err', id, error: string }`
 *
 * ONE Worker instance per app session (module-level singleton). The
 * Worker holds its own OfflineAudioContext across requests (see
 * decodeWorker.ts). `inflightDecodes` is the main-thread→Worker
 * correlation map: each `decodeInWorker` call allocates a fresh
 * monotonic id, registers a Promise resolve/reject, and posts the
 * message. When the Worker's reply arrives, we look up the id, route
 * the reply to the awaiter, and remove the entry.
 */
type DecodeOk = {
  readonly type: 'decode:ok';
  readonly id: number;
  readonly buffer: ArrayBuffer;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly duration: number;
};

type DecodeErr = {
  readonly type: 'decode:err';
  readonly id: number;
  readonly error: string;
};

type WorkerOutbound = DecodeOk | DecodeErr;

let workerInstance: Worker | null = null;
let nextDecodeId = 0;

const inflightDecodes = new Map<number, {
  readonly resolve: (out: DecodeOk) => void;
  readonly reject: (err: Error) => void;
}>();

const ensureWorker = (): Worker => {
  if (workerInstance !== null) return workerInstance;
  const w = new DecodeWorker();
  w.addEventListener('message', (e: MessageEvent<unknown>) => {
    const msg = e.data as WorkerOutbound;
    const handler = inflightDecodes.get(msg.id);
    if (handler === undefined) return;
    inflightDecodes.delete(msg.id);
    if (msg.type === 'decode:ok') {
      handler.resolve(msg);
    } else {
      handler.reject(new Error(msg.error ?? 'decode failed'));
    }
  });
  workerInstance = w;
  return w;
};

/**
 * Per-URL AudioBuffer cache populated by `decodeInWorker`. Test-only
 * accessor `__getWarmCache()` exposes it for inspection. Production
 * consumers are `wrapSuperdoughLoadBuffer` (Phase 4 / Subagent 16),
 * which patches superdough's runtime `loadBuffer` to consult this
 * cache first.
 */
const warmCache = new Map<string, AudioBuffer>();

/**
 * Reference held by the wrapped `loadBuffer`. `setWarmCache(cache)`
 * installs (or clears) the reference. The wrapper consults it on
 * every call; when the URL is present AND the cached AudioBuffer
 * was created on the same AudioContext as the caller's, the cached
 * buffer is returned directly without a fetch + decode.
 *
 * Why a separate `warmCacheRef`: the same cache is mutated by
 * `decodeInWorker` (additions). Holding a `Map` reference (not a
 * copy) means the wrapper always sees the latest entries.
 */
let warmCacheRef: Map<string, AudioBuffer> | null = null;

export const setWarmCache = (cache: Map<string, AudioBuffer> | null): void => {
  warmCacheRef = cache;
};

/**
 * Reconstruct the main-thread AudioBuffer from a Worker reply's
 * raw Float32Array buffer. Channel-major layout: ch0 samples
 * (length), then ch1 samples (length), etc. — exactly what
 * `decodeWorker.ts:mergeChannels()` produces.
 *
 * Stamps the AudioContext as a non-standard `__ctx` property on
 * the resulting AudioBuffer so `wrapSuperdoughLoadBuffer` can
 * detect context-match before short-circuiting. (Stock
 * AudioBuffer does not expose `.context`; we attach our own
 * marker. The WebAudio spec does not forbid this.)
 */
const reconstructBuffer = (out: DecodeOk): AudioBuffer => {
  const ac = getAudioContext();
  // length × channels × Float32 bytes(4) = total buffer size.
  const length = out.buffer.byteLength / 4 / out.numberOfChannels;
  const audioBuffer = ac.createBuffer(out.numberOfChannels, length, out.sampleRate);
  const view = new Float32Array(out.buffer);
  for (let ch = 0; ch < out.numberOfChannels; ch += 1) {
    audioBuffer.copyToChannel(view.subarray(ch * length, (ch + 1) * length), ch);
  }
  (audioBuffer as unknown as { __ctx: AudioContext }).__ctx = ac;
  return audioBuffer;
};

/**
 * Post a decode request to the Worker and await the in-flight reply.
 * Resolves with a reconstructed AudioBuffer; rejects with the Worker's
 * reported error (fetch failure, non-2xx status, decodeAudioData
 * encoding error).
 *
 * Side effect: populates `warmCache[url]` with the reconstructed
 * AudioBuffer. The cache is consulted by no consumer in Phase 1; it
 * exists so Phase 2 (wrapping superdough's loadBuffer) can short-
 * circuit the runtime decode path without re-fetching.
 */
const decodeInWorker = (url: string, sampleRate: number): Promise<AudioBuffer> => {
  const w = ensureWorker();
  const id = ++nextDecodeId;
  return new Promise<AudioBuffer>((resolve, reject) => {
    inflightDecodes.set(id, {
      resolve: (out) => {
        const audioBuffer = reconstructBuffer(out);
        warmCache.set(url, audioBuffer);
        resolve(audioBuffer);
      },
      reject,
    });
    w.postMessage({ type: 'decode', id, url, sampleRate });
  });
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

/**
 * Phase 4 / Subagent 16: warm-cache fast path.
 *
 * When `preloadAllBuffers` populates the warm cache, the same
 * AudioBuffer objects are valid for the runtime as long as the
 * runtime uses the same AudioContext (which wavecode does —
 * one shared `__wavecodeAudioCtx`). This wrap short-circuits
 * superdough's loadBuffer for cached URLs, eliminating the
 * "loading sound X took too long" warning that plagued
 * piano-ballad and similar fast-tempo presets.
 *
 * SCOPE: only short-circuits when the cached buffer was
 * created on the same AudioContext as the runtime's. If the
 * contexts differ, falls through to the original loadBuffer.
 * The sample-rate mismatch across contexts is a known
 * limitation; wavecode's single-context architecture sidesteps
 * it entirely.
 *
 * Implementation notes:
 *
 * - `originalLoadBuffer` is bound to `mod` (superdough's
 *   namespace module) so the function still resolves its
 *   closure-private `loadCache` / `bufferCache` maps correctly
 *   even after we overwrite `mod.loadBuffer`.
 * - The wrap is idempotent: subsequent calls return early. This
 *   matters because `LiveAudioEngine.ensureRepl` may re-enter on
 *   module reload (HMR) and we must not stack wraps.
 * - The wrap is installed ASYNCHRONOUSLY because
 *   `@strudel/webaudio` is dynamically imported (Vite bundles it
 *   on demand). We must wait for the dynamic import to resolve
 *   before monkey-patching. The race window is microseconds in
 *   practice — the first hap is always seconds later — but we
 *   guard against double-install via the `originalLoadBuffer`
 *   sentinel.
 * - The wrap falls through gracefully when `warmCacheRef` is
 *   null (setWarmCache(null) on teardown). It also falls through
 *   when the URL is not in the cache or the cached buffer lives
 *   on a different AudioContext than the runtime's.
 */
let originalLoadBuffer:
  | ((url: string, ac: AudioContext, label: string, n?: number) => Promise<AudioBuffer>)
  | null = null;
let wrapInstalled = false;

/**
 * Patched `loadBuffer` that consults `warmCacheRef` first. When
 * the URL is present and the cached AudioBuffer's `__ctx`
 * (stamped by `reconstructBuffer`) matches the caller's
 * AudioContext, returns the cached buffer directly. Otherwise
 * falls through to the original superdough implementation.
 */
const wrappedLoadBuffer = async (
  url: string,
  ac: AudioContext,
  label: string,
  n: number = 0,
): Promise<AudioBuffer> => {
  const cache = warmCacheRef;
  if (cache !== null) {
    const cached = cache.get(url);
    if (cached !== undefined) {
      // The cached AudioBuffer carries a non-standard `__ctx`
      // property stamped by `reconstructBuffer` (which knows
      // which AudioContext created it). Real AudioBuffer does
      // not expose `.context`, so we attach our own.
      const stamped = (cached as unknown as { __ctx?: AudioContext }).__ctx;
      if (stamped === ac) {
        return cached;
      }
      // Context mismatch (e.g. multi-context consumer): fall
      // through to the original loadBuffer. The PCM data is the
      // same — but we'd need to re-decode to the new context's
      // sampleRate, which is the original's job.
    }
  }
  if (originalLoadBuffer !== null) {
    return originalLoadBuffer(url, ac, label, n);
  }
  // Wrap not installed yet (dynamic import still pending). Fall
  // through to the live `mod.loadBuffer` so callers aren't blocked.
  const mod = await import('@strudel/webaudio');
  return mod.loadBuffer(url, ac, label, n);
};

/**
 * Install the warm-cache wrapper on `@strudel/webaudio`'s
 * `loadBuffer` (re-exported from superdough). Idempotent: a
 * second call returns without re-patching. Safe to call from
 * `LiveAudioEngine.ensureRepl` once modules are loaded.
 */
export const wrapSuperdoughLoadBuffer = (): void => {
  if (wrapInstalled) return;
  void (async () => {
    const mod = await import('@strudel/webaudio');
    if (wrapInstalled) return;
    if (typeof mod.loadBuffer !== 'function') {
      console.warn('[SampleLoader] @strudel/webaudio.loadBuffer not a function — wrap skipped');
      return;
    }
    originalLoadBuffer = mod.loadBuffer.bind(mod);
    mod.loadBuffer = wrappedLoadBuffer as typeof mod.loadBuffer;
    wrapInstalled = true;
  })();
};

/**
 * Test-only reset for the wrap state. Production callers use
 * `setWarmCache(null)` for cache teardown; this also undoes the
 * patch so subsequent tests start from a clean slate.
 */
export const __resetLoadBufferWrapForTests = (): void => {
  if (originalLoadBuffer !== null) {
    void import('@strudel/webaudio').then((mod) => {
      mod.loadBuffer = originalLoadBuffer as typeof mod.loadBuffer;
    }).catch(() => undefined);
  }
  originalLoadBuffer = null;
  wrapInstalled = false;
  warmCacheRef = null;
};

type PreloadState = {
  loaded: number;
  total: number;
  onProgress?: ((loaded: number, total: number) => void) | undefined;
  onProgressEvent?: ((evt: SampleProgressEvent) => void) | undefined;
};

/**
 * Collect every sample URL registered by `samples()` and have the
 * Worker decode each one. The decode runs OFF the main thread; the
 * main thread only pays a typed-array copy (`createBuffer` +
 * `copyToChannel`) for each completed decode, ~O(channels × samples).
 *
 * Race-vs-scheduler:
 *
 * Even with `decodeInWorker`, the audio scheduler at first hap time
 * will still race the decode — superdough's runtime `loadBuffer`
 * (called from inside its hap renderer) re-fetches and re-decodes
 * independently, because superdough's `tt[url]` cache is private.
 * Phase 1 of this fix removes the main-thread BLOCKING during
 * preload (was ~500 ms on a 36-URL cold start); Phase 2 (separate
 * commit) will wrap superdough's loadBuffer to consult `warmCache`
 * and skip the redundant fetch+decode. Until Phase 2 lands, the
 * preload is a "free" pre-warm of the SW cache (worker's fetch
 * hits the SW once) and a populated-but-unused warmCache.
 *
 * SW-cache short-circuit: URLs already in the Service Worker cache
 * are SKIPPED at the worker decode step but still counted in
 * `loaded`/`total`. Same rationale as before — the worker's fetch
 * would also hit the SW cache and is faster than the network, but
 * the decodeAudioData cost is still non-zero and the audio context
 * will fetch on its own at first hap time. Skipping the worker
 * call removes redundant work without changing the race outcome.
 *
 * `onProgress(loaded, total)` fires after every buffer resolution
 * (including SW-cache skips and worker errors). Worker errors are
 * caught per-URL inside the `withConcurrency` callback — a single
 * bad URL does not block the rest of the bank. The total is
 * computed once at the start of the preload.
 */
const preloadAllBuffers = async (state: PreloadState): Promise<void> => {
  const dict = soundMap.get() as SoundMapSnapshot;
  // Touch the audio context so `getAudioContext()` returns a live ctx that
  // can call `createBuffer`. If the user hasn't interacted yet,
  // `getAudioContext()` returns a suspended ctx — `createBuffer` still
  // works on it. `unlockAudioContext()` is invoked later by
  // LiveAudioEngine.eval() once the user clicks Play.
  const ac = getAudioContext();
  // Install the cache reference for the wrapper. The wrapper is
  // installed (separately) by `wrapSuperdoughLoadBuffer()` —
  // typically from `LiveAudioEngine.ensureRepl` once modules load.
  // Even before the wrap is installed, populating the reference is
  // safe: `warmCacheRef === null` keeps the wrapper in fall-through
  // mode.
  setWarmCache(warmCache);
  state.total = collectSampleUrls(dict).length;
  const urls = state.total > 0 ? collectSampleUrls(dict) : [];
  // Touch `ac` so the variable is used and the type check sees the
  // `import` non-dead even when SAMPLES_URLS is empty.
  void ac;
  state.loaded = 0;
  state.onProgress?.(0, urls.length);
  state.onProgressEvent?.({ loaded: 0, total: urls.length, status: 'loading' });
  await withConcurrency(urls, PRELOAD_CONCURRENCY, async (url) => {
    try {
      const cached = await isSampleCached(url);
      if (!cached) {
        // URL not on SW disk — kick off the worker decode (off-thread).
        await decodeInWorker(url, ac.sampleRate);
      }
      // cached URLs skip decode but STILL flow into the loaded/total
      // counter — same behavior as before the Worker integration.
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

/**
 * Test-only accessors for the Worker integration. The Worker is
 * lazily instantiated; `__getDecodeWorkerCount()` reads the
 * singleton-slot state to verify how many Worker instances have
 * been created during a test. `__getWarmCacheSize()` exposes the
 * populated-by-preload count. Both return 0 (and create a stale
 * fresh state on next access) if `__resetForTests()` was called.
 *
 * NOT exported from the module's public surface — underscore prefix
 * signals "tests-only, do not import from production code".
 */
export const __getWarmCacheSize = (): number => warmCache.size;
export const __getDecodeWorkerInstance = (): Worker | null => workerInstance;
export const __resetForTests = (): void => {
  workerInstance = null;
  nextDecodeId = 0;
  inflightDecodes.clear();
  warmCache.clear();
  setWarmCache(null);
};
