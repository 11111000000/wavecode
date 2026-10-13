/// <reference lib="webworker" />

/**
 * Web Worker that decodes audio samples off the main thread.
 *
 * Why a Worker
 * ------------
 * `AudioContext.decodeAudioData` is one of the few Web Audio APIs that
 * is allowed inside a dedicated Worker. Moving the decode out of the
 * main thread frees the scheduler / UI from the ~80–160 ms per-URL
 * decode cost that `SampleLoader.preloadAllBuffers` previously paid
 * for 36 simultaneous MP3 / OGG / WAV files at app boot. The main
 * thread blocked for ~500 ms during preload, racing the first haps
 * of every preset (see math/wavecode-preset-decode-race + this packet
 * for the sequencing math).
 *
 * Protocol (inbound / outbound)
 * -----------------------------
 * Main → Worker:
 *   { type: 'decode', id: number, url: string, sampleRate: number }
 *
 * Worker → Main (success):
 *   { type: 'decode:ok', id, buffer: ArrayBuffer, sampleRate,
 *     numberOfChannels, duration }
 *   The ArrayBuffer is a tight Float32Array packing all channels
 *   (length × channels × 4 bytes). It is `transferable` — Vite /
 *   `postMessage` moves the buffer (zero-copy) rather than copying.
 *
 * Worker → Main (failure):
 *   { type: 'decode:err', id, error: string }
 *
 * Why a single mutable context
 * ----------------------------
 * The Worker holds ONE `OfflineAudioContext` (1 ch × 1 frame) and
 * recycles it across requests — `decodeAudioData` doesn't render, so
 * the buffer length / channel count are irrelevant; we only need a
 * context with the right sampleRate for the decoder. If a new
 * sampleRate arrives (different live AudioContext on main), we
 * `new OfflineAudioContext(...)` again. Recycle-when-compatible
 * avoids throwing the old context's codec handles away between each
 * decode (FFmpeg / Vorbis init is the slow part).
 *
 * Why raw PCM, not the AudioBuffer
 * --------------------------------
 * `AudioBuffer` is not transferable across a Worker boundary — the
 * spec only allows `Transferable` types (ArrayBuffer / MessagePort /
 * ImageBitmap / etc.). We flatten each channel's `Float32Array` into
 * a single merged buffer and reconstruct an AudioBuffer on the main
 * thread via `ac.createBuffer(channels, length, sampleRate)` +
 * `copyToChannel(...)`. Reconstruction is ~O(channels × samples)
 * of typed-array copy — sub-millisecond for any sample we have.
 *
 * Pure-function export
 * --------------------
 * `handleDecode(req, deps)` is exported alongside the Worker binding
 * so unit tests can drive the protocol directly: mock `fetch`, the
 * `OfflineAudioContext` ctor, and the `reply` post callback. The
 * bottom-of-file `self.addEventListener(...)` block is the Worker
 * glue (only meaningful in a Worker context) — it captures the
 * already-existing globals and wires them into `handleDecode`.
 *
 * Buffer ownership & cleanup
 * --------------------------
 * The merged Float32Array buffer is transferred back to the main
 * thread. After the `decode:ok` post, the Worker no longer holds a
 * reference to it — transferring zeroes the original's contents.
 * If the main thread drops the AudioBuffer, GC reclaims the typed
 * array. No leaks across the Worker boundary.
 *
 * Errors
 * ------
 * Every failure path (`fetch` rejection, non-OK status, malformed
 * `arrayBuffer`, `decodeAudioData` rejection) is caught and turned
 * into a `decode:err` reply. The main thread's `inflightDecodes`
 * map holds the rejection handle and routes the error back to the
 * caller. Throwing uncaught inside a Worker terminates it; we never
 * let that happen.
 */

export type DecodeRequest = {
  readonly type: 'decode';
  readonly id: number;
  readonly url: string;
  readonly sampleRate: number;
};

export type DecodeOk = {
  readonly type: 'decode:ok';
  readonly id: number;
  readonly buffer: ArrayBuffer;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly duration: number;
};

export type DecodeErr = {
  readonly type: 'decode:err';
  readonly id: number;
  readonly error: string;
};

export type Outbound = DecodeOk | DecodeErr;

export type DecodeDeps = {
  readonly fetchImpl: typeof fetch;
  readonly createCtx: (sampleRate: number) => OfflineAudioContext;
  readonly reply: (msg: Outbound, transfer?: readonly Transferable[]) => void;
};

/**
 * Mutable OfflineAudioContext cache. Each Worker holds ONE ctx at a
 * time and recycles it across calls; if the sampleRate changes
 * (different live AudioContext on main), we re-create. We recycle
 * via this shared `ctxCache` reference rather than a module-level
 * mutable, so tests can pass in their own cache for isolation.
 */
export type CtxCache = {
  current: OfflineAudioContext | null;
  sampleRate: number;
};

const defaultCtxCache: CtxCache = { current: null, sampleRate: 0 };

const getCtx = (deps: DecodeDeps, cache: CtxCache, sampleRate: number): OfflineAudioContext => {
  if (cache.current !== null && cache.sampleRate === sampleRate) return cache.current;
  cache.current = deps.createCtx(sampleRate);
  cache.sampleRate = sampleRate;
  return cache.current;
};

const mergeChannels = (audioBuffer: AudioBuffer): Float32Array => {
  const merged = new Float32Array(audioBuffer.length * audioBuffer.numberOfChannels);
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
    const channelData = audioBuffer.getChannelData(ch);
    merged.set(channelData, ch * audioBuffer.length);
  }
  return merged;
};

const safeReply = (deps: DecodeDeps, msg: Outbound, transfer?: readonly Transferable[]): void => {
  // `reply` is a side-effect — wrapping it twice (once for success, once
  // for error) ensures that even if the main-thread reply channel is
  // broken, the Worker never unhandled-rejects (which would terminate it).
  try {
    if (transfer === undefined) deps.reply(msg);
    else deps.reply(msg, transfer);
  } catch {
    // Intentional swallow.
  }
};

export const handleDecode = async (
  req: DecodeRequest,
  deps: DecodeDeps,
  ctxCache: CtxCache = defaultCtxCache,
): Promise<void> => {
  try {
    const { id, url, sampleRate } = req;
    const res = await deps.fetchImpl(url);
    if (!res.ok) {
      throw new Error(`fetch ${res.status} ${res.statusText}`);
    }
    const bytes = await res.arrayBuffer();
    const ctx = getCtx(deps, ctxCache, sampleRate);
    const audioBuffer = await ctx.decodeAudioData(bytes);
    const merged = mergeChannels(audioBuffer);
    // Float32Array#buffer is typed ArrayBufferLike (= ArrayBuffer |
    // SharedArrayBuffer). We own the underlying buffer (no shared
    // views), so narrowing to ArrayBuffer is safe here.
    const buffer = merged.buffer as ArrayBuffer;
    const ok: DecodeOk = {
      type: 'decode:ok',
      id,
      buffer,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      duration: audioBuffer.duration,
    };
    safeReply(deps, ok, [ok.buffer]);
  } catch (err) {
    const errOut: DecodeErr = {
      type: 'decode:err',
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
    };
    safeReply(deps, errOut);
  }
};

const workerScope: { addEventListener?: Worker['addEventListener']; postMessage?: Worker['postMessage'] } | null =
  typeof self === 'undefined'
    ? null
    : (self as unknown as { addEventListener?: Worker['addEventListener']; postMessage?: Worker['postMessage'] });

if (workerScope !== null && typeof workerScope.addEventListener === 'function') {
  const depFetch = fetch.bind(globalThis);
  const createCtx = (sampleRate: number): OfflineAudioContext =>
    new OfflineAudioContext(1, 1, sampleRate);
  const reply = (msg: Outbound, transfer?: readonly Transferable[]): void => {
    if (workerScope.postMessage === undefined) return;
    if (transfer === undefined) {
      workerScope.postMessage(msg);
    } else {
      workerScope.postMessage(msg, [...transfer]);
    }
  };
  // Production: shared per-Worker ctx cache (module-level). Survives
  // across every decode the Worker handles during its lifetime.
  const ctxCache: CtxCache = { current: null, sampleRate: 0 };
  const handler = (e: MessageEvent<DecodeRequest>): void => {
    void handleDecode(e.data, { fetchImpl: depFetch, createCtx, reply }, ctxCache);
  };
  workerScope.addEventListener('message', handler as unknown as EventListener);
}
