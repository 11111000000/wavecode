/**
 * ServerWhisperSTT tests — the parts of the engine that do not need
 * a microphone, ffmpeg or the 4-vCPU whisper host:
 *
 *   - Layer conformance (`Layer.Layer<STTEngine, never, never>`),
 *     the same compile-time assertion `WebSpeechSTT.test.ts` makes.
 *   - Capability probing in jsdom, where neither `getUserMedia` nor
 *     `MediaRecorder` exists: `isSupported()` must be `false` and
 *     `start()` must fail with `no-speech-api` rather than throwing
 *     a raw DOMException at the orchestrator.
 *   - The real recording path, with `getUserMedia`, `MediaRecorder`,
 *     `AudioContext` and `fetch` stubbed on `globalThis`: start →
 *     speak → 1.3 s of silence → one POST → one final chunk. That
 *     last assertion is the one that matters — the upload has to
 *     arrive as a `final`, because that is the only kind the
 *     orchestrator promotes into the review buffer.
 *   - `stop()` (the release-the-button gesture) flushes the take
 *     rather than cancelling it, so a phrase shorter than one
 *     interim tick still reaches the server.
 *   - HTTP failure mapping: 503 / 504 / 413 / 400 all surface as
 *     `SttUnsupportedError`, never as a raw exception, so the
 *     orchestrator's retry policy can classify them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Chunk, Layer} from 'effect';
import { Effect, Fiber, Stream } from 'effect';
import type * as Exit from 'effect/Exit';
import { STTEngine, type SttUnsupportedError } from '~/application/voice/STTEngine';
import type { TranscriptChunk } from '~/domain/voice/Transcript';
import {
  ServerWhisperSTTLive,
  isServerWhisperSTTSupported,
  makeServerWhisperSTT,
  pickRecordingMimeType,
} from './ServerWhisperSTT';

/* ── fakes ──────────────────────────────────────────────────────────── */

const AUDIO_CHUNK = 'audio-bytes';

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  /** When false, the recorder behaves like the real thing on a
   *  browser where the container never materialises: `start` and
   *  `stop` succeed, the state machine reports `recording`, and not a
   *  single byte of audio is delivered. Simulating this is the only
   *  way to reach the zero-byte branch — every other fake here hands
   *  over data unconditionally. */
  static producesAudio = true;
  static isTypeSupported(mime: string): boolean {
    return mime === 'audio/webm;codecs=opus';
  }

  readonly mimeType: string;
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { readonly data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  /** How many times `stop()` was called — used to assert that
   *  `stop()` after a flush does not re-stop a dead recorder. */
  stopCalls = 0;
  /** Periodic `dataavailable` timer — the real MediaRecorder fires
   *  every `timeslice` ms; without this the incremental-upload path
   *  has nothing in `parts` to upload mid-recording. */
  private timesliceTimer: number | null = null;

  constructor(stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
    void stream;
  }

  start(timeslice?: number): void {
    this.state = 'recording';
    if (typeof timeslice === 'number' && timeslice > 0) {
      this.timesliceTimer = window.setInterval(() => {
        if (this.state !== 'recording') return;
        if (!FakeMediaRecorder.producesAudio) return;
        this.ondataavailable?.({ data: new Blob([AUDIO_CHUNK], { type: this.mimeType }) });
      }, timeslice);
    }
  }

  stop(): void {
    this.stopCalls += 1;
    this.state = 'inactive';
    if (this.timesliceTimer !== null) {
      window.clearInterval(this.timesliceTimer);
      this.timesliceTimer = null;
    }
    if (FakeMediaRecorder.producesAudio) {
      this.ondataavailable?.({ data: new Blob([AUDIO_CHUNK], { type: this.mimeType }) });
    }
    this.onstop?.();
  }
}

class FakeAnalyser {
  fftSize = 2048;
  /** Level the fake reports; the meter reads it every poll. */
  rms = 0;
  getFloatTimeDomainData(buf: Float32Array): void {
    const value = this.rms > 0 ? this.rms : 0;
    for (let i = 0; i < buf.length; i += 1) buf[i] = value;
  }
  connect(): void { /* not connected to destination — no feedback loop */ }
  disconnect(): void { /* nothing to release */ }
}

let fakeAnalyser: FakeAnalyser | null = null;

const makeAudioContext = (): typeof AudioContext => {
  class FakeCtx {
    resume(): Promise<void> { return Promise.resolve(); }
    close(): Promise<void> { return Promise.resolve(); }
    createMediaStreamSource(): { connect: () => void } {
      return { connect: () => {} };
    }
    createAnalyser(): AnalyserNode {
      fakeAnalyser = new FakeAnalyser();
      return fakeAnalyser as unknown as AnalyserNode;
    }
  }
  return FakeCtx as unknown as typeof AudioContext;
};

const trackedStream = (): MediaStream => {
  const tracks = [{ stopped: false, stop(): void { this.stopped = true; } }];
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
};

const installBrowserFakes = (opts?: {
  readonly getUserMedia?: () => Promise<MediaStream>;
}): void => {
  FakeMediaRecorder.instances = [];
  fakeAnalyser = null;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('AudioContext', makeAudioContext());
  vi.stubGlobal(
    'navigator',
    {
      mediaDevices: {
        getUserMedia: opts?.getUserMedia ?? (() => Promise.resolve(trackedStream())),
      },
    },
  );
};

const transcriptionResponse = (text: string): Response =>
  new Response(JSON.stringify({ text, language: 'ru', duration: 2 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/* ── helpers ────────────────────────────────────────────────────────── */

/** Run the engine to completion. Resolves only when the stream ends
 *  (a flush happened) or fails with `SttUnsupportedError`. */
const collectStream = (
  layer: Layer.Layer<STTEngine, never, never>,
  opts: { readonly interim: boolean },
): Effect.Effect<Chunk.Chunk<TranscriptChunk>, SttUnsupportedError, never> =>
  Effect.gen(function* () {
    const svc = yield* STTEngine;
    const stream = yield* svc.start({ lang: 'ru-RU', interim: opts.interim });
    return yield* Stream.runCollect(stream);
  }).pipe(Effect.provide(layer));

/** Start consuming in the background while exposing the chunks that
 *  landed, so a test can assert on what the orchestrator would have
 *  seen. `forkStream` hides the collection because most tests only
 *  care about "did it upload". */
const forkCollecting = (
  layer: Layer.Layer<STTEngine, never, never>,
): Promise<{
  readonly chunks: TranscriptChunk[];
  readonly fiber: Fiber.RuntimeFiber<void, SttUnsupportedError>;
}> => {
  const chunks: TranscriptChunk[] = [];
  const fiber = Effect.runFork(
    Effect.gen(function* () {
      const svc = yield* STTEngine;
      const stream = yield* svc.start({ lang: 'ru-RU', interim: true });
      return yield* Stream.runForEach(stream, (chunk: TranscriptChunk) =>
        Effect.sync(() => { chunks.push(chunk); }),
      );
    }).pipe(Effect.provide(layer)),
  );
  return Promise.resolve({ chunks, fiber });
};

/** Start collecting in the background — for the paths where the
 *  stream never ends on its own (a cancelled session) and the test
 *  has to interrupt it the way `VoiceAISession.stop()` does. */
const forkStream = (
  layer: Layer.Layer<STTEngine, never, never>,
): Promise<Fiber.RuntimeFiber<Chunk.Chunk<TranscriptChunk>, SttUnsupportedError>> =>
  Effect.runPromise(Effect.forkDaemon(collectStream(layer, { interim: true })));

const interrupt = (
  fiber: Fiber.RuntimeFiber<unknown, SttUnsupportedError>,
): Promise<Exit.Exit<unknown, unknown>> =>
  Effect.runPromise(Fiber.interrupt(fiber));

/** `svc.start()` alone only fails on the capability guards; mic
 *  errors arrive on the stream's error channel, exactly like
 *  WebSpeech's `onerror`. Tests that want a permission failure must
 *  therefore run the stream. */
const runToExit = (
  layer: Layer.Layer<STTEngine, never, never>,
): Promise<Exit.Exit<Chunk.Chunk<TranscriptChunk>, SttUnsupportedError>> =>
  Effect.runPromiseExit(collectStream(layer, { interim: true }));

const stopEngine = (
  layer: Layer.Layer<STTEngine, never, never>,
): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* STTEngine;
      yield* svc.stop();
    }).pipe(Effect.provide(layer)),
  );

/* ── tests ──────────────────────────────────────────────────────────── */

describe('ServerWhisperSTT — Layer conformance', () => {
  it('exports a Layer that satisfies Layer.Layer<STTEngine, never, never>', () => {
    const layer: Layer.Layer<STTEngine, never, never> = ServerWhisperSTTLive;
    expect(layer).toBeDefined();
  });

  it('module loads without throwing in jsdom (no MediaRecorder / getUserMedia)', () => {
    expect(isServerWhisperSTTSupported()).toBe(false);
    expect(pickRecordingMimeType()).toBeNull();
  });
});

describe('ServerWhisperSTT — unsupported environments', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isSupported() returns false without MediaRecorder', async () => {
    const supported = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        return yield* svc.isSupported();
      }).pipe(Effect.provide(ServerWhisperSTTLive)),
    );
    expect(supported).toBe(false);
  });

  it('start() fails with SttUnsupportedError { reason: no-speech-api }', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        yield* svc.start({ lang: 'ru-RU', interim: true });
      }).pipe(Effect.provide(ServerWhisperSTTLive)),
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure') return;
    expect(JSON.stringify(exit.cause)).toContain('"reason":"no-speech-api"');
  });

  it('maps getUserMedia rejection to permission-denied', async () => {
    installBrowserFakes({
      getUserMedia: () =>
        Promise.reject(new DOMException('denied', 'NotAllowedError')),
    });
    const exit = await runToExit(ServerWhisperSTTLive);
    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure') return;
    expect(JSON.stringify(exit.cause)).toContain('"reason":"permission-denied"');
  });

  it('stop() is a no-op when nothing is recording', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        yield* svc.stop();
      }).pipe(Effect.provide(ServerWhisperSTTLive)),
    );
  });
});

describe('ServerWhisperSTT — recording path (stubbed browser)', () => {
  const layer = makeServerWhisperSTT({
    endpoint: 'https://stt.test/v1/audio/transcriptions',
    apiKey: 'sk-test',
  });

  beforeEach(() => {
    installBrowserFakes();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('start() → speech → 1.3s silence → one POST → one final chunk', async () => {
    const fetchMock = vi.fn(async () => transcriptionResponse('  сделай бас громче  '));
    vi.stubGlobal('fetch', fetchMock);

    const run = Effect.runPromise(collectStream(layer, { interim: true }));

    // Let `start()` reach the recorder, then simulate someone
    // speaking for one poll tick.
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeAnalyser).not.toBeNull();
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    fakeAnalyser!.rms = 0.4;
    await vi.advanceTimersByTimeAsync(200);

    // Then silence for longer than SILENCE_FLUSH_MS.
    fakeAnalyser!.rms = 0.001;
    await vi.advanceTimersByTimeAsync(1500);

    const collected = await run;
    const chunks = Array.from(collected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://stt.test/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = init.body as FormData;
    expect(body.get('language')).toBe('ru');
    expect(body.get('file')).toBeInstanceOf(Blob);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.kind).toBe('final');
    expect(chunks[0]?.text).toBe('сделай бас громче');
    expect(chunks[0]?.lang).toBe('ru-RU');
  });

  it('keeps recording when the mic only ever hears silence (no upload)', async () => {
    const fetchMock = vi.fn(async () => transcriptionResponse('галлюцинация'));
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    fakeAnalyser!.rms = 0.001;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    await stopEngine(layer);
    await interrupt(fiber);
  });

  it('maps 503 to a network SttUnsupportedError instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('busy', { status: 503 })),
    );
    const run = runToExit(layer);
    await vi.advanceTimersByTimeAsync(0);
    fakeAnalyser!.rms = 0.4;
    await vi.advanceTimersByTimeAsync(200);
    fakeAnalyser!.rms = 0.001;
    await vi.advanceTimersByTimeAsync(1500);
    const exit = await run;
    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure') return;
    const errStr = JSON.stringify(exit.cause);
    expect(errStr).toContain('"reason":"network"');
    expect(errStr).toContain('занят');
  });

  it('maps 413 (clip too large) to a network SttUnsupportedError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('too big', { status: 413 })),
    );
    const run = runToExit(layer);
    await vi.advanceTimersByTimeAsync(0);
    fakeAnalyser!.rms = 0.4;
    await vi.advanceTimersByTimeAsync(200);
    fakeAnalyser!.rms = 0.001;
    await vi.advanceTimersByTimeAsync(1500);
    const exit = await run;
    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure') return;
    expect(JSON.stringify(exit.cause)).toContain('25');
  });

  it('stop() flushes the take to the server instead of discarding it', async () => {
    // Releasing the button is the primary gesture of this feature —
    // "hold, say a phrase, let go". It used to be a hard cancel, so
    // any speech shorter than one `TICK_MS` (2.5 s) tick was thrown
    // away without ever leaving the tab.
    const fetchMock = vi.fn(async () => transcriptionResponse('сказанная фраза'));
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    fakeAnalyser!.rms = 0.4;
    await vi.advanceTimersByTimeAsync(200);
    await stopEngine(layer);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances[0]?.stopCalls).toBe(1);
    await interrupt(fiber);
  });

  it('stop() emits the flushed transcript as a final chunk', async () => {
    const fetchMock = vi.fn(async () => transcriptionResponse('сказанная фраза'));
    vi.stubGlobal('fetch', fetchMock);
    const { chunks, fiber } = await forkCollecting(layer);
    await vi.advanceTimersByTimeAsync(0);
    fakeAnalyser!.rms = 0.4;
    await vi.advanceTimersByTimeAsync(200);
    await stopEngine(layer);
    await vi.advanceTimersByTimeAsync(3000);
    // The orchestrator only promotes `final` (never `interim`) into
    // the review buffer, so a flush that shipped an interim would
    // leave the panel empty after release.
    const finals = chunks.filter((c) => c.kind === 'final');
    expect(finals.length).toBe(1);
    expect(finals[0]?.text).toBe('сказанная фраза');
    await interrupt(fiber);
  });

  it('refuses a second concurrent start()', async () => {
    const fetchMock = vi.fn(async () => transcriptionResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const first = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    const second = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        yield* svc.start({ lang: 'ru-RU', interim: true });
      }).pipe(Effect.provide(layer)),
    );
    expect(second._tag).toBe('Failure');
    if (second._tag !== 'Failure') return;
    expect(JSON.stringify(second.cause)).toContain('"reason":"aborted"');
    await stopEngine(layer);
    await interrupt(first);
  });
});

/**
 * Live-transcript path (`decisions/wavecode-voice-live-transcript`):
 * incremental interim uploads before silence, single-flight, and the
 * empty-speech guard for `sawSpeech`. Each test is wired to the
 * meter's `TICK_MS = 2_500` boundary directly so the cadence is
 * obvious from the timeline, not from magic numbers.
 */
describe('ServerWhisperSTT — live transcript (interim uploads)', () => {
  const layer = makeServerWhisperSTT({
    endpoint: 'https://stt.test/v1/audio/transcriptions',
    apiKey: 'sk-test',
  });

  // Mirror the constant in `ServerWhisperSTT.ts`. Hard-coding here on
  // purpose: a drift in the source number is exactly what the test
  // contract should make obvious, not silently absorb.
  const TICK_MS = 2_500;

  beforeEach(() => {
    installBrowserFakes();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('emits a POST after TICK_MS of continuous speech (interim)', async () => {
    const fetchMock = vi.fn(async () => transcriptionResponse('промежуточно'));
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    // give the fiber time to set up the meter (getUserMedia
    // microtask + startMeter) before mutating fakeAnalyser.
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeAnalyser).not.toBeNull();
    fakeAnalyser!.rms = 0.4;
    // 100 ms past TICK_MS: the first tick fires upload(). Stop
    // BEFORE silence-flush can fire, so the only POST is the
    // interim one.
    await vi.advanceTimersByTimeAsync(TICK_MS + 100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await stopEngine(layer);
    await interrupt(fiber);
  });

  it('no speech → no tick upload (sawSpeech guard)', async () => {
    const fetchMock = vi.fn(async () => transcriptionResponse('галлюцинация'));
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeAnalyser).not.toBeNull();
    // rms stays at 0.001 — no speech ever happens. TICK cadence passes
    // many times but the gate refuses to upload.
    fakeAnalyser!.rms = 0.001;
    await vi.advanceTimersByTimeAsync(TICK_MS * 4);
    expect(fetchMock).not.toHaveBeenCalled();
    await stopEngine(layer);
    await interrupt(fiber);
  });

  it('two ticks while a request is in flight → only one POST (single-flight)', async () => {
    const deferred: { resolve?: (r: Response) => void } = {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        deferred.resolve = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeAnalyser).not.toBeNull();
    fakeAnalyser!.rms = 0.4;

    // Drive past the first tick: POST#1 leaves.
    await vi.advanceTimersByTimeAsync(TICK_MS + 100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Drive past the second tick while POST#1 is still hanging
    // (deferred.resolve is undefined). The meter gate must skip the
    // upload.
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Drive past a third tick. Still one POST.
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Now release POST#1 so the engine unwinds cleanly. Stop before
    // silence-flush can run; we only assert the single-flight rule
    // here.
    if (deferred.resolve !== undefined) {
      deferred.resolve(transcriptionResponse('interim'));
    }
    await vi.advanceTimersByTimeAsync(0);
    await stopEngine(layer);
    await interrupt(fiber);
  });

  it('when interim POST completes, the next TICK fires a new POST', async () => {
    let callIdx = 0;
    const deferred: { resolve?: (r: Response) => void } = {};
    const fetchMock = vi.fn(() => {
      callIdx += 1;
      return new Promise<Response>((resolve) => {
        deferred.resolve = () =>
          resolve(transcriptionResponse(`interim #${callIdx}`));
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeAnalyser).not.toBeNull();
    fakeAnalyser!.rms = 0.4;

    // Past TICK_MS → POST#1 fires.
    await vi.advanceTimersByTimeAsync(TICK_MS + 100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (deferred.resolve !== undefined) {
      deferred.resolve(transcriptionResponse('один'));
    }
    await vi.advanceTimersByTimeAsync(0);

    // After it completes, the next TICK fires POST#2.
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    if (deferred.resolve !== undefined) {
      deferred.resolve(transcriptionResponse('два'));
    }
    await vi.advanceTimersByTimeAsync(0);
    await stopEngine(layer);
    await interrupt(fiber);
  });
});
/**
 * Capturing nothing used to end the stream silently, which the
 * orchestrator turned into a bare `pause`. From the user's seat that
 * is indistinguishable from a quiet take: no transcript, no message,
 * no sign that anything failed. Field report: "the counter keeps
 * running and no text appears".
 */
describe('ServerWhisperSTT — zero-byte capture is a failure, not an empty take', () => {
  const layer = makeServerWhisperSTT({
    endpoint: 'https://stt.test/v1/audio/transcriptions',
    apiKey: 'sk-test',
  });

  beforeEach(() => {
    installBrowserFakes();
    vi.useFakeTimers();
    // Simulate a browser where the container never materialises:
    // start/stop succeed, state reports `recording`, zero bytes ever
    // arrive. Every other fake in this file hands over data
    // unconditionally, so this is the only way to reach the branch.
    FakeMediaRecorder.producesAudio = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeMediaRecorder.producesAudio = true;
  });

  /** Let the async flush settle, then read the stream's own exit.
   *  `interrupt()` would race it and report the interrupt instead. */
  const settle = async (
    fiber: Fiber.RuntimeFiber<Chunk.Chunk<TranscriptChunk>, SttUnsupportedError>,
  ): Promise<Exit.Exit<Chunk.Chunk<TranscriptChunk>, SttUnsupportedError>> => {
    await vi.advanceTimersByTimeAsync(50);
    return Effect.runPromise(Fiber.await(fiber));
  };

  it('reports that the microphone delivered nothing', async () => {
    const fetchMock = vi.fn(async () => transcriptionResponse('не должно уйти'));
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    fakeAnalyser!.rms = 0.001;
    await vi.advanceTimersByTimeAsync(300);
    await stopEngine(layer);
    const exit = await settle(fiber);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(exit._tag).toBe('Failure');
    expect(JSON.stringify((exit as { readonly cause: unknown }).cause))
      .toContain('микрофон ничего не передал');
  });

  it('distinguishes a dead mic from an encoder that produced nothing', async () => {
    // The meter DOES hear speech, so the microphone is alive and the
    // empty container points at the codec — a different answer, and a
    // different thing to go fix.
    const fetchMock = vi.fn(async () => transcriptionResponse('не должно уйти'));
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    fakeAnalyser!.rms = 0.4;
    await vi.advanceTimersByTimeAsync(200);
    fakeAnalyser!.rms = 0.001;
    await vi.advanceTimersByTimeAsync(1500);
    const exit = await settle(fiber);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(exit._tag).toBe('Failure');
    expect(JSON.stringify((exit as { readonly cause: unknown }).cause))
      .toContain('микрофон слышен');
  });
});
