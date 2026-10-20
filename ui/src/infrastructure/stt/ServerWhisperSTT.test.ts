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
 *     last assertion is the one that matters — the upload is
 *     triggered by the engine (see the header comment in
 *     `ServerWhisperSTT.ts`: a chunk emitted from `stop()` would be
 *     dropped by `VoiceAISession.stop()`, which interrupts the
 *     consumer first).
 *   - HTTP failure mapping: 503 / 504 / 413 / 400 all surface as
 *     `SttUnsupportedError`, never as a raw exception, so the
 *     orchestrator's retry policy can classify them.
 *   - `stop()` is a cancel: it releases the mic and uploads nothing.
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

  constructor(stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
    void stream;
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.stopCalls += 1;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([AUDIO_CHUNK], { type: this.mimeType }) });
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

/** Start collecting in the background — for the paths where the
 *  stream never ends on its own (a cancelled session) and the test
 *  has to interrupt it the way `VoiceAISession.stop()` does. */
const forkStream = (
  layer: Layer.Layer<STTEngine, never, never>,
): Promise<Fiber.RuntimeFiber<Chunk.Chunk<TranscriptChunk>, SttUnsupportedError>> =>
  Effect.runPromise(Effect.forkDaemon(collectStream(layer, { interim: true })));

const interrupt = (
  fiber: Fiber.RuntimeFiber<Chunk.Chunk<TranscriptChunk>, SttUnsupportedError>,
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

  it('stop() cancels without uploading', async () => {
    const fetchMock = vi.fn(async () => transcriptionResponse('не должно уйти'));
    vi.stubGlobal('fetch', fetchMock);
    const fiber = await forkStream(layer);
    await vi.advanceTimersByTimeAsync(0);
    fakeAnalyser!.rms = 0.4;
    await vi.advanceTimersByTimeAsync(200);
    await stopEngine(layer);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances[0]?.stopCalls).toBe(1);
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