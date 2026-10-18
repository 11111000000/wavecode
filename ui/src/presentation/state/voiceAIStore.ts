/**
 * voiceAIStore — presentation-layer signals + Effect orchestrator
 * wrapper for the voice-AI mini-FAB.
 *
 * Wraps `createVoiceAISession` (`application/voice/VoiceAISession.ts`):
 *   - signals (`voiceAIState`, `voiceAITranscript`) mirror the
 *     orchestrator's FSM stream;
 *   - `voiceAIError` collects the latest error message;
 *   - `voiceAISupported` is a snapshot of the STT engine's
 *     capability check (`isSupported`) at init time — the mini-FAB
 *     uses it to gate the rendered button.
 *
 * Lifecycle (MVP)
 * ---------------
 *   pointerdown / tap  → `startVoiceAI(mode)`
 *                            `mode: 'oneshot'` = press-and-hold
 *                            `mode: 'continuous'` = tap-continuous
 *   pointerup / tap-2  → `stopVoiceAI`
 *
 * The orchestrator's auto-commit fires on every final chunk, so
 * oneshot sessions self-terminate after the first successful apply
 * (the reducer flips back to `idle` from `applying`/`applied`).
 * Continuous sessions stay listening between utterances and require
 * a second tap to stop.
 *
 * Barge-in is exposed via `cancelVoiceAIInFlight` and wired by the
 * orchestrator's `cancelInFlight` Effect.
 *
 * Mic channel policy: voice-AI uses `speech-api-internal` (Chrome
 * shares its internal pipeline with our AudioContext). The mutex
 * still tracks the session so future mic-direct paths
 * (Whisper-WASM) re-use the single-slot rule. See
 * `decisions/wavecode-voice-fab.yaml` outcome `mic-mutex-correct`.
 *
 * MVP LLM/Audio wiring — known limitation
 * ---------------------------------------
 * The orchestrator's `runRoute` Effect requires `LLMClient +
 * AudioEngine` in `R`. Wiring the production LiveLLMClient +
 * LiveAudioEngine here would require pulling infrastructure into
 * presentation (forbidden by the layer rule). For the MVP we
 * install a no-op stub pair; the score gets the user's utterance
 * transcript rendered but does NOT auto-apply via LLM. A future
 * task threads the `appStore.score` ref + `LiveAudioEngine` layer
 * into `initVoiceAI`, swapping the stub for the real services.
 * `decisions/wavecode-voice-fab.yaml` notes this explicitly as a
 * follow-up package.
 */

import { createSignal, onCleanup, untrack } from 'solid-js';
import * as Context from 'effect/Context';
import { Effect, Layer, Ref, Stream } from 'effect';
import { initialVoiceSession } from '~/domain/voice/voiceSession';
import type { VoiceSessionState } from '~/domain/voice/voiceSession';
import {
  initialTranscriptState,
  type TranscriptChunk,
  type TranscriptState,
} from '~/domain/voice/Transcript';
import type { VoiceSessionEvent } from '~/domain/voice/voiceSession';
import {
  STTEngine,
  type SttUnsupportedError,
} from '~/application/voice/STTEngine';
import {
  createVoiceAISession,
  type VoiceSessionHandle,
  type VoiceSessionInput,
} from '~/application/voice/VoiceAISession';
import {
  AudioEngine,
  type LLMClient,
  type CompletionChunk,
  type CompletionRequest,
} from '~/domain/services';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import { acquireMic, releaseMic } from './micMutexStore';
import { logger } from '~/infrastructure/log';

export const [voiceAIState, setVoiceAIState] = createSignal<VoiceSessionState>(
  initialVoiceSession(),
);

export const [voiceAITranscript, setVoiceAITranscript] = createSignal<
  TranscriptState
>(initialTranscriptState());

export const [voiceAIError, setVoiceAIError] = createSignal<string | null>(
  null,
);

export const [voiceAISupported, setVoiceAISupported] = createSignal<boolean>(
  true,
);

export type VoiceAIStartOpts = {
  readonly mode: 'oneshot' | 'continuous';
  readonly lang: 'ru-RU' | string;
  readonly bargeInMode?: 'replace' | 'queue' | 'ignore';
};

/* ── module handle ────────────────────────────────────────────────── */

let handle: VoiceSessionHandle | null = null;
let activeSessionId: string | null = null;
let langAtInit: 'ru-RU' | string = 'ru-RU';

/**
 * Pull LLMClient + AudioEngine out of the provided layer so we can
 * build the orchestrator with concrete services rather than go
 * through `Effect.provide` (which doesn't work from a Solid module-
 * level Effect that needs `runSync`).
 */
const buildServicePair = (
  audioLayer: Layer.Layer<AudioEngine, never, never>,
): Effect.Effect<
  {
    readonly llm: Context.Tag.Service<typeof LLMClient>;
    readonly audio: Context.Tag.Service<typeof AudioEngine>;
    readonly scoreRef: Ref.Ref<string>;
  },
  never,
  never
> =>
  Effect.gen(function* () {
    const env = yield* Layer.build(audioLayer).pipe(Effect.scoped);
    const audio = Context.get(env as Context.Context<AudioEngine>, AudioEngine);
    // LLMClient is provided at the AppLayer level via `composition.ts`
    // — for the MVP we install a no-op stub here and require the next
    // package to wire the real `LLMClient` from
    // `infrastructure/llm/LiveLLMClient`.
    const llm: Context.Tag.Service<typeof LLMClient> = {
      streamCompletion: (_req: CompletionRequest) =>
        Effect.succeed(
          new ReadableStream<CompletionChunk>({
            start(c) {
              c.close();
            },
          }),
        ),
    };
    const scoreRef = yield* Ref.make<string>('');
    return { llm, audio, scoreRef };
  });

/**
 * Build the orchestrator handle. Idempotent: a second call is a
 * no-op so test reimport doesn't double-allocate Refs.
 */
export const initVoiceAI = (deps: {
  readonly sttLayer: Layer.Layer<STTEngine, never, never>;
  readonly audioLayer?: Layer.Layer<AudioEngine, never, never>;
}): void => {
  if (handle !== null) return;
  const sessionProgram = Effect.gen(function* () {
    const builtEnv = yield* Layer.build(deps.sttLayer).pipe(Effect.scoped);
    const stt = Context.get(
      builtEnv as Context.Context<STTEngine>,
      STTEngine,
    );
    const supportedResult = yield* stt.isSupported();
    return { stt, supportedResult };
  });

  const built = Effect.runSync(sessionProgram);
  setVoiceAISupported(built.supportedResult);

  // Provide the audio layer (defaults to no-op service stub) — full
  // LLM wiring is the next package, see the MVP note in the file
  // header.
  const audioLayer = deps.audioLayer ?? buildNoOpAudioLayer();
  const services = Effect.runSync(buildServicePair(audioLayer));

  const handleProgram = createVoiceAISession({
    stt: built.stt,
    llm: services.llm,
    audio: services.audio,
    currentScoreRef: services.scoreRef,
  });
  handle = Effect.runSync(handleProgram);

  Effect.runFork(
    Stream.runForEach(handle.stream, (s) =>
      Effect.sync(() =>
        untrack(() => {
          setVoiceAIState(s);
          if (s.tag === 'listening'
              || s.tag === 'transcribing'
              || s.tag === 'requesting'
              || s.tag === 'applying'
              || s.tag === 'paused'
              || s.tag === 'errored') {
            setVoiceAITranscript(s.transcript);
          }
          if (s.tag === 'errored') {
            setVoiceAIError(s.error);
          } else if (voiceAIError() !== null) {
            setVoiceAIError(null);
          }
        }),
      ),
    ),
  );
};

/**
 * Build a no-op AudioEngine Layer so `initVoiceAI` works without
 * callers having to wire the production layer. The MVP does not
 * reach into `audio.eval` through the orchestrator (see the file
 * header for the wiring plan).
 */
const buildNoOpAudioLayer = (): Layer.Layer<AudioEngine, never, never> => {
  const audio: Context.Tag.Service<typeof AudioEngine> = {
    eval: () => Effect.void,
    stop: () => Effect.void,
    compileAndQuery: () => Effect.succeed([]),
    setCps: () => Effect.void,
    setLayerMix: () => Effect.void,
    setScore: () => Effect.void,
    getCycleProgress: () => Effect.succeed(0),
    getActiveHaps: () => Effect.succeed([]),
    recordLive: () => Effect.die('voiceAIStore: recordLive not wired in MVP') as never,
    renderOffline: () => Effect.die('voiceAIStore: renderOffline not wired in MVP') as never,
  };
  return Layer.succeed(AudioEngine, audio);
};

/* ── start / stop / commit / cancel ──────────────────────────────── */

/**
 * Start a voice-AI session.
 *
 *   1. Acquire `speech-api-internal` channel under the `voice-ai`
 *      owner. Failure surfaces as `MicBusyError`.
 *   2. Run the orchestrator's `start` Effect.
 */
export const startVoiceAI = (
  opts: VoiceAIStartOpts,
): Effect.Effect<void, MicBusyError | SttUnsupportedError, never> =>
  Effect.gen(function* () {
    const sessionId = activeSessionId ?? cryptoRandomId();
    const claimed = acquireMic({
      kind: 'speech-api-internal',
      owner: { kind: 'voice-ai', sessionId },
      sessionId,
    });
    if (!claimed.ok) {
      logger.push('warn', [
        'voiceAIStore.startVoiceAI: mic busy',
        claimed.error.conflictingChannel.owner.kind,
      ]);
      return yield* Effect.fail(claimed.error);
    }
    activeSessionId = sessionId;
    langAtInit = opts.lang;
    yield* Effect.sync(() => {
      setVoiceAIError(null);
      setVoiceAITranscript(initialTranscriptState(opts.lang));
    });
    if (handle === null) {
      // Degraded path: orchestrator not built (e.g., unsupported
      // browser). Mirror the FSM through `arming → errored` so the
      // UI shows the error pill instead of a frozen button.
      yield* Effect.sync(() => {
        const initial: VoiceSessionState = {
          tag: 'errored',
          error: 'Голосовой движок не инициализирован',
          transcript: initialTranscriptState(opts.lang),
        };
        setVoiceAIState(initial);
      });
      return;
    }
    const input: VoiceSessionInput = {
      mode: opts.mode,
      lang: opts.lang,
      bargeInMode: opts.bargeInMode ?? 'replace',
    };
    yield* handle.start(input);
  });

/**
 * Signals a manual commit. The orchestrator's auto-commit flow
 * fires on every `final` chunk — this is the explicit user-press
 * hook for an external commit-indicator UI.
 */
export const commitVoiceAI = (): Effect.Effect<void, never, never> => {
  if (handle === null) {
    return Effect.void;
  }
  const empty: TranscriptChunk = {
    kind: 'final',
    text: '',
    confidence: 1,
    lang: langAtInit,
    timestampMs: Date.now(),
  };
  return Effect.gen(function* () {
    yield* handle!.onChunk(empty);
  });
};

/** Stop the session and release `speech-api-internal`. */
export const stopVoiceAI = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (handle !== null) {
      yield* handle.stop();
    }
    const sid = activeSessionId;
    if (sid !== null) {
      yield* Effect.sync(() => releaseMic(sid));
    }
    activeSessionId = null;
  });

/** Barge-in: cancel any in-flight route and reset to idle. */
export const cancelVoiceAIInFlight = (): Effect.Effect<void, never, never> => {
  if (handle === null) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    yield* handle!.cancelInFlight();
  });
};

/* ── internal ────────────────────────────────────────────────────── */

const cryptoRandomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `voice-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/* ── test-only ───────────────────────────────────────────────────── */

/** Test-only: install a custom handle. */
export const __setVoiceAIHandleForTests = (
  h: VoiceSessionHandle | null,
): void => {
  handle = h;
};

/** Test-only: drive the reducer directly. */
export const __dispatchVoiceAIForTests = (event: VoiceSessionEvent): void => {
  const initial = voiceAIState();
  const next = (() => {
    switch (event.type) {
      case 'arm': return initial.tag === 'idle'
        ? { tag: 'arming' as const }
        : initial;
      case 'stt-ready': return initial.tag === 'arming'
        ? {
            tag: 'listening' as const,
            transcript: initialTranscriptState('ru-RU'),
            continuous: false,
          }
        : initial;
      case 'chunk':
        return initial.tag === 'listening'
          ? { ...initial, transcript: initial.transcript }
          : initial;
      case 'commit':
        return initial.tag === 'listening' || initial.tag === 'transcribing'
          ? { tag: 'requesting' as const, transcript: initial.transcript, continuous: false }
          : initial;
      case 'request-sent':
        return initial.tag === 'requesting'
          ? { tag: 'applying' as const, transcript: initial.transcript, score: event.score, continuous: false }
          : initial;
      case 'applied':
        return initial.tag === 'applying'
          ? { tag: 'idle' as const }
          : initial;
      case 'barge-in':
        return { tag: 'idle' as const };
      case 'pause':
        return initial;
      case 'resume':
        return initial;
      case 'error':
        return {
          tag: 'errored' as const,
          error: event.message,
          transcript: initialTranscriptState(),
        };
      case 'dismiss':
        return { tag: 'idle' as const };
      default:
        return initial;
    }
  })();
  if (next !== initial) setVoiceAIState(next as VoiceSessionState);
};

/** Test-only: reset module state. */
export const __resetVoiceAIForTests = (): void => {
  handle = null;
  activeSessionId = null;
  setVoiceAIState(initialVoiceSession());
  setVoiceAITranscript(initialTranscriptState());
  setVoiceAIError(null);
  setVoiceAISupported(true);
};

onCleanup(() => {
  activeSessionId = null;
  handle = null;
});
