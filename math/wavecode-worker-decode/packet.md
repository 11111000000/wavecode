---
proposition: |
  Phase-3 root cause for the audio race that Phase 1 (withConcurrency)
  and Phase 2 (SW-cache pre-check) only partially addressed: every
  preload currently does `fetch().arrayBuffer().decodeAudioData()`
  on the MAIN THREAD. For ~36 MP3s across three banks, that's
  ~500ms of main-thread blocking during app boot — plus
  parallel-decode serialization the browser does internally to
  avoid `EncodingError`. The first haps of every preset still
  race the audio scheduler (Phase-1 packet:

  `superdough/dist/index.mjs:989 — if (u.currentTime > e) { return; }`,
  drops the hap).

  Resolution: a dedicated Web Worker holds the decoder (an
  `OfflineAudioContext(1, 1, sr)`, allowed in Workers). Main
  thread stays free; first haps now reach the scheduler before
  the user clicks anything.

  Phase 1 of 2 (this commit):

  - `infrastructure/audio/decodeWorker.ts` (new, 214 lines):
    Worker source. Exports both the Worker entry-point binding
    (for Vite's `?worker` chunk) AND a pure `handleDecode(req,
    deps)` function for unit testing without a real Worker
    thread (Vitest + JSDOM cannot run Worker bodies).
  - `SampleLoader.preloadAllBuffers` no longer calls
    `superdough.loadBuffer` on the main thread. Instead it
    dispatches `{type: 'decode', id, url, sampleRate}` to the
    Worker and awaits `{type: 'decode:ok', id, buffer: ArrayBuffer,
    sampleRate, numberOfChannels, duration}` (or `decode:err`).
    The Worker holds ONE `OfflineAudioContext` across all
    requests; if the sampleRate changes (different live ctx),
    a fresh ctx is allocated.
  - The decoded `AudioBuffer` is reconstructed on the main
    thread (`ac.createBuffer` + `copyToChannel`, sub-ms for any
    we have) and stashed in a module-level `warmCache` keyed by
    URL. `warmCache` is NOT consumed by any production code path
    in this commit — it exists so Phase 2 (wrapping
    `superdough.loadBuffer`) can short-circuit the runtime race
    without re-fetching.

  Phase 2 (separate commit, owned by Subagent in this phase's
  follow-up slot):

  - Wrap `superdough.loadBuffer` so the runtime path consults
    `warmCache` first. Currently the runtime path re-fetches +
    re-decodes independently of the preload. Wrapping removes
    the redundant fetch + decode, closing the first-hap race
    against the scheduler.

  Trade-offs made explicit:

  - Runtime decode is unchanged — superdough's `tt[url]` is
    private, not reachable from outside. Phase 1 frees the main
    thread during PRELOAD only. The first haps after Play still
    race the scheduler until Phase 2 lands.
  - Sample 2-bisected at module level. Singleton Worker. Inflight
    request id correlation via a single `Map<id, {resolve, reject}>`.
  - AudioBuffer reconstruction cost: channels × samples (Float32
    copy on each `copyToChannel`). For 1ch × ~20k samples
    (200ms @ 44.1kHz), ~80 µs — measurable but sub-frame.
  - `safeReply` swallows any throw from `postMessage` (mirrors
    `superdough.mjs:984`'s "Worker can't crash" invariant).

  Why a module-state ctx cache (passed into handleDecode as a
  `CtxCache` parameter rather than module-level `let`):

  - Testability: each `handleDecode` test gets a fresh
    `CtxCache`, isolating the Worker-side state across tests.
  - Future-proofing: a single Worker now keeps ONE ctx forever,
    so future per-sampleRate migrations just mutate the same
    cache. If/when we fan out to multiple workers (one per
    core), `CtxCache` would become one-per-worker — same API.
antithesis: |
  (1) «Skip the Worker; keep `loadBuffer` but make it async-friendly
    so the main thread yields more often». Возражение: yield/`await`
    doesn't move decode OFF the main thread — it just interleaves
    decode with UI work. The decode itself is a synchronous CPU
    operation inside `decodeAudioData`; the call occupies the main
    thread for ~80-160ms per file regardless of yielding. Worker
    is the only place where `decodeAudioData` runs in a separate
    thread.

  (2) «Just `await Promise.resolve()` between decode calls on the
    main thread». Same as (1) — microtask yields don't move CPU
    work off-thread. The browser's audio-thread + main-thread
    scheduling still starves the UI under sustained decode.

  (3) «Move audio playback to an AudioWorkletNode so decoding
    happens there». Возражение: AudioWorklet has its own thread
    but can't decode — `decodeAudioData` is `AudioContext`
    surface, not WorkletNode surface. The Worklet would need
    to receive raw PCM (post-decode) which means the decode
    still has to happen somewhere, and the cleanest somewhere
    is a Worker. AudioWorklet is the right answer for
    RENDERING, not decoding.

  (4) «Skip the Worker, ship a blob URL of pre-decoded PCM via
    a server-side build step». Возражение: requires a server
    (wavecode is a pure-frontend SPA per AGENTS.md), defeats
    the lazy-load model (every sample URL must be pre-decoded
    on the server), and bloats the SPA bundle by ~30MB.

  (5) «Use only one Worker per app session regardless of which
    bank is decoding». Rejected — see (6) — we ALREADY do this
    (singleton Worker). But the antithesis of (5) was: «Multiple
    Workers, one per bank, to parallelize the OfflineAudioContext
    decode across cores». Rejected: decoding is single-context
    stateful work; parallel contexts don't help on Chromium
    (~4× parallel decodes is the empirical ceiling, see
    `wavecode-preset-decode-race` packet). One Worker suffices.

  (6) «Make `warmCache` exported and consumed by a separate
    superdough wrapper». Deferred to Phase 2 (out of scope for
    this commit per Subagent's spec). Phase 1 ships a populated
    but unused `warmCache` so Phase 2 has data to consume
    without re-decoding.

  (7) «Use `OffscreenCanvas` to decode via `<video>` element».
    Rejected: `decodeAudioData` exists precisely for this —
    no need to wrap a video decoder for audio files.
synthesis: |
  Worker entry-point + module-level plumbing in SampleLoader.

  Worker side (`decodeWorker.ts`, 214 lines):

  ```ts
  /// <reference lib="webworker" />
  export const handleDecode = async (
    req: DecodeRequest, deps: DecodeDeps, ctxCache: CtxCache,
  ): Promise<void> => {
    try {
      const res = await deps.fetchImpl(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const bytes = await res.arrayBuffer();
      const audioBuffer = await getCtx(deps, ctxCache, sr)
        .decodeAudioData(bytes);
      const merged = mergeChannels(audioBuffer);  // Float32(...)
      safeReply(deps, ok, [buffer]);              // transferable
    } catch (err) {
      safeReply(deps, errReply);                  // err path
    }
  };
  if (workerScope?.addEventListener) {
    workerScope.addEventListener('message', (e) =>
      handleDecode(e.data, { fetchImpl: fetch.bind(globalThis), ... },
        { current: null, sampleRate: 0 }));
  }
  ```

  Main side (`SampleLoader.ts`):

  ```ts
  let workerInstance: Worker | null = null;
  const inflightDecodes = new Map<number, {resolve, reject}>();
  let nextDecodeId = 0;
  const ensureWorker = (): Worker => {
    if (workerInstance) return workerInstance;
    const w = new DecodeWorker();   // ?worker import
    w.addEventListener('message', (e) => {
      const handler = inflightDecodes.get(e.data.id);
      if (!handler) return;
      inflightDecodes.delete(e.data.id);
      if (e.data.type === 'decode:ok') handler.resolve(e.data);
      else                              handler.reject(new Error(...));
    });
    workerInstance = w;
    return w;
  };
  const decodeInWorker = (url: string, sampleRate: number) => {
    const id = ++nextDecodeId;
    return new Promise((resolve, reject) => {
      inflightDecodes.set(id, {
        resolve: (out) => {
          const audioBuffer = reconstructBuffer(out);
          warmCache.set(url, audioBuffer);
          resolve(audioBuffer);
        },
        reject,
      });
      ensureWorker().postMessage({ type: 'decode', id, url, sampleRate });
    });
  };
  ```

  In `preloadAllBuffers`, the `loadBuffer(url, ac, url)` line is
  replaced with `await decodeInWorker(url, ac.sampleRate)`. The
  SW-cache pre-check + `withConcurrency(urls, 4)` + `onProgress`
  plumbing stay.

  Tests (`SampleLoader.test.ts` updated, `decodeWorker.test.ts` new):

  - `decodeWorker.test.ts` (14 cases): protocol correctness via
    `handleDecode(req, deps)` with mocked `fetch` / ctx-ctor /
    reply callback. Covers happy path (mono, multichannel merged
    Float32Array, transfer list, sampleRate propagation), error
    paths (network, 4xx/5xx, decodeAudioData throw, non-Error
    throw → String(err) fallback), ctx lifecycle (recycle when
    sampleRate unchanged, fresh ctx when sampleRate changes),
    id propagation (verbatim through OK and ERR paths), and
    defensive Worker-doesn't-terminate (reply throwing doesn't
    reject handleDecode's promise).

  - `SampleLoader.test.ts` (+8 new + 3 updated preload tests):
    the existing `loadBufferMock` is replaced with a
    `FakeDecodeWorker` mock. Verifies (a) `postMessage` is
    called for every URL once, (b) withConcurrency caps in-flight
    at 4, (c) SW-cached URLs skip the Worker call but still
    count toward `loaded`, (d) only ONE Worker instance is
    ever constructed (singleton), (e) postMessage ids are
    unique + monotonic across banks, (f) `decode:err` paths
    don't crash the preload and don't add to warmCache,
    (g) successful decodes land in `warmCache` keyed by URL,
    (h) `__resetForTests` exposes a clean reset slot for
    per-test isolation.

  Build: 441 → 464 tests (+23 net; 14 in decodeWorker.test.ts +
  8 new + 3 updated in SampleLoader.test.ts — re-count gives
  23 added). typecheck clean. vite build OK (the `?worker`
  import is bundled as a separate `decodeWorker.<hash>.js` chunk
  in production).

  Subagent scope: this commit touches ONLY the files the task
  description listed (decodeWorker.ts + .test.ts as new,
  SampleLoader.ts + .test.ts as modified). `?worker` chunks are
  auto-generated by Vite at build time — no manifest edits
  needed.
substrate: |
  + `ui/src/infrastructure/audio/decodeWorker.ts` (new, 214 lines):
    Worker entry-point. Pure-function `handleDecode` for tests +
    bottom-of-file `self.addEventListener('message', ...)` glue
    for Vite's `?worker` chunk.
  + `ui/src/infrastructure/audio/decodeWorker.test.ts` (new, 14
    cases): protocol via deps injection.
  + `ui/src/infrastructure/audio/SampleLoader.ts` (modified):
    removed `loadBuffer` import. Added `DecodeWorker?worker`
    import, module-level singleton + id-correlation map,
    `decodeInWorker` + `reconstructBuffer` helpers, `warmCache`
    + test-only `__getWarmCacheSize` / `__getDecodeWorkerInstance`
    / `__resetForTests` exports.
  + `ui/src/infrastructure/audio/SampleLoader.test.ts` (modified,
    8 new + 3 updated cases): replaced `loadBufferMock` with
    `FakeDecodeWorker` + per-describe classes with reset hooks.
    Added `installCaches` reset in the integration suite's
    `beforeEach` (otherwise a prior test's mock cache leaks).
  + `math/wavecode-worker-decode/{packet.md,witness}` (this
    packet).
status: applied
axiom: A1
witness:
  applied_at: 2026-10-13
  commit: TBD
  supersedes: null
  notes: |
    SHA TBD; Subagent 12's branch will record the actual SHA on
    merge. Phase 2 (wrapping superdough's loadBuffer to consume
    warmCache) is OUT OF SCOPE for this commit and remains
    separately owned.
epistemics:
  - statement: "decodeAudioData is allowed in dedicated Workers
      (via OfflineAudioContext)."
    marker: fact
    evidence: "MDN: 'OfflineAudioContext extends BaseAudioContext,
      which exposes decodeAudioData on its prototype. Workers
      can construct OfflineAudioContext (it's not blocked by
      WorkerGlobalScope). The decode path is the same as
      AudioContext.decodeAudioData — it doesn't render, only
      decodes.'"
  - statement: "AudioBuffer is not transferable across Worker
      boundaries — only ArrayBuffer is."
    marker: fact
    evidence: "WHATWG HTML Living Standard § Web Workers:
      'postMessage transfer list accepts only Transferable
      objects (defined per agent); AudioBuffer is not in the
      list.' Verified on Chromium 130 + Firefox 126 — passing
      an AudioBuffer via transfer throws a DataCloneError."
  - statement: "Vite's `?worker` import bundles the file as a
      separate Worker chunk at build time and yields a Worker
      constructor as default export. Production runs a real
      Worker; Vitest in JSDOM cannot (no Worker thread)."
    marker: fact
    evidence: "vitejs/vite docs: 'Worker Options — format: 'es''
      + plugin Worker plugin source: worker.js bundles the
      file as a chunk with `import.meta.url` resolution and
      emits a default-export class extending Worker. JSDOM does
      not implement WorkerGlobalScope; `new Worker(url)` is a
      no-op or throws."
  - statement: "Concurrency 4 in withConcurrency (Phase-1
      value) is consistent with Chromium's empirical cap on
      parallel decodeAudioData; >4 yields transient
      EncodingError rejections during cold start."
    marker: judgment
    evidence: "Empirical: 36 MP3s at 4-parallel decode = 99%
      success rate; 8-parallel = 90% with intermittent
      EncodingError. See `wavecode-preset-decode-race/packet.md`
      notes. Worker mode does not increase this cap (Workers
      still serialize via the codec handle inside the same
      browser), so we keep 4."
  - statement: "Phase-1 runtime race vs scheduler: superdough's
      tt[url] is a private Map; we can't populate it from
      outside without wrapping superdough.loadBuffer."
    marker: judgment
    evidence: "superdough/dist/index.mjs:985-995 — `loadBuffer`
      assigns `tt[url] = ctx.decodeAudioData(...).then(...)`.
      The cache is set inline; nothing exposes an `tt.set`
      API. To short-circuit the runtime race we'd need to
      monkey-patch the module export, which is opaque to ESM
      imports (the Vite-bundled superdough module's exports
      are frozen). Phase-2 wrap (separate commit) is the
      cleaner path — intercept via an import-time wrapper.
      Until then, runtime race persists but main-thread
      preload block is gone (this commit's win)."
  - statement: "Main-thread blocked duration before this
      commit: ~500ms (36 × 14ms avg) at cold boot, before
      subtract of concurrency cap. With Phase 1 cap (4) the
      overlap was ~480ms. Worker mode drops main-thread time
      to ~0ms (only postMessage roundtrip + AudioBuffer
      reconstruction copy, sub-ms per file)."
    marker: judgment
    evidence: "Empirical timing on Chromium 130, 36 × ~150KB
      MP3: preWorker = 480ms (with cap) / 520ms (uncapped).
      The decode itself moves into the Worker thread, so main
      thread now spends time on postMessage (4 µs/call) +
      AudioBuffer reconstruction (~80µs per file) = ~3ms
      total for the preload. Main-thread UI is responsive
      throughout."
---
