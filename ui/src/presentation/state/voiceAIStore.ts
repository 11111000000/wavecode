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
 * Service wiring
 * --------------
 * `LLMClient` + `AudioEngine` are extracted from `AppLayer` (the
 * composition root) at `initVoiceAI` time, mirroring how
 * `presentation/state/audioActions.ts` threads `AppLayer` into
 * `Effect.provide`. The `currentScoreRef` keeps the orchestrator's
 * view of the score in sync with `appStore.score` via a Solid
 * `createEffect` (in its own `createRoot`) so consecutive utterances
 * see the latest edits without re-init.
 */

import { createSignal, createEffect, createRoot, onCleanup, untrack } from 'solid-js';
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
  LLMClient,
} from '~/domain/services';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import { acquireMic, releaseMic } from './micMutexStore';
import { appStore } from './appStore';
import { AppLayer } from '~/infrastructure/composition';
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
let scoreSyncDispose: (() => void) | null = null;

/**
 * Pull `LLMClient` + `AudioEngine` out of `AppLayer` so we can
 * build the orchestrator with concrete services. `AppLayer` is the
 * canonical composition root — the same one `audioActions.ts`
 * threads through `Effect.provide`. `Layer.build` is sync for our
 * layer graph (all tags are synchronous Layers), so `runSync` is
 * safe.
 */
const buildServicePair = (): {
  readonly llm: Context.Tag.Service<typeof LLMClient>;
  readonly audio: Context.Tag.Service<typeof AudioEngine>;
  readonly scoreRef: Ref.Ref<string>;
} => {
  const built = Effect.runSync(
    Effect.gen(function* () {
      const env = (yield* Layer.build(AppLayer).pipe(
        Effect.scoped,
      )) as Context.Context<LLMClient | AudioEngine>;
      return {
        llm: Context.get(env, LLMClient),
        audio: Context.get(env, AudioEngine),
      };
    }),
  );
  const scoreRef = Effect.runSync(Ref.make<string>(appStore.score));
  return { ...built, scoreRef };
};

/**
 * Subscribe to `appStore.score` and mirror every change into
 * `currentScoreRef` so the orchestrator's next `routeIntent` call
 * sees the latest score. Solid effects need an owner; `createRoot`
 * provides one outside a component tree.
 */
const installScoreSync = (scoreRef: Ref.Ref<string>): void => {
  if (scoreSyncDispose !== null) return;
  scoreSyncDispose = createRoot((dispose) => {
    createEffect(() => {
      const score = appStore.score;
      Effect.runSync(Ref.set(scoreRef, score));
    });
    return dispose;
  });
};

/**
 * Build the orchestrator handle. Idempotent: a second call is a
 * no-op so test reimport doesn't double-allocate Refs.
 *
 * Services are pulled from `AppLayer` (composition root). The
 * `sttLayer` is provided by the caller because the live impl
 * (`WebSpeechSTTLive`) is browser-specific and tests substitute
 * fakes here.
 */
export const initVoiceAI = (deps: {
  readonly sttLayer: Layer.Layer<STTEngine, never, never>;
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

  const services = buildServicePair();

  const handleProgram = createVoiceAISession({
    stt: built.stt,
    llm: services.llm,
    audio: services.audio,
    currentScoreRef: services.scoreRef,
  });
  handle = Effect.runSync(handleProgram);

  installScoreSync(services.scoreRef);

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
              || s.tag === 'review'
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

/**
 * Pause the live STT stream and freeze the transcript so the user
 * can edit it before sending to the LLM. Mic channel is NOT
 * released — we keep `speech-api-internal` reserved so a "Record
 * more" button can re-arm without contention. The user-facing
 * VoiceAITextReview component drives `sendReview` / `cancelReview`
 * once the buffer is shaped.
 */
export const enterVoiceAIReview = (): Effect.Effect<void, never, never> => {
  if (handle === null) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    yield* handle!.enterReview();
  });
};

/** Send the (user-edited) text to the LLM. Must be called from the
 *  `review` state — orchestrator's `sendReview` no-ops if not. */
export const sendVoiceAIReview = (text: string): Effect.Effect<void, never, never> => {
  if (handle === null) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    yield* handle!.sendReview(text);
  });
};

/** Drop the review buffer and return to idle. Mic channel is
 *  released because the user explicitly aborts. */
export const cancelVoiceAIReview = (): Effect.Effect<void, never, never> => {
  if (handle === null) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    yield* handle!.cancelReview();
    const sid = activeSessionId;
    if (sid !== null) {
      releaseMic(sid);
      activeSessionId = null;
    }
    return;
  });
};

/** Read-only accessor for `voiceAIState.tag === 'review'` (used by
 *  VoiceAITextReview to render conditionally). */
export const isVoiceAIInReview = (): boolean => voiceAIState().tag === 'review';

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
        // Mirrors the real reducer: listening + final chunk →
        // `transcribing` with `transcript.final` updated from the
        // chunk text; otherwise listening stays listening.
        if (initial.tag === 'listening') {
          if (event.chunk.kind === 'final') {
            const nextFinal = initial.transcript.final
              ? `${initial.transcript.final} ${event.chunk.text}`.trim()
              : event.chunk.text;
            return {
              tag: 'transcribing' as const,
              transcript: { ...initial.transcript, final: nextFinal, interim: '' },
            };
          }
          return { ...initial, transcript: initial.transcript };
        }
        return initial;
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
      case 'enter-review':
        if (initial.tag === 'listening' || initial.tag === 'transcribing' || initial.tag === 'paused') {
          return {
            tag: 'review' as const,
            transcript: initial.transcript,
            editedText: initial.transcript.final.trim(),
          };
        }
        return initial;
      case 'edit-review':
        if (initial.tag === 'review' && initial.editedText !== event.text) {
          return {
            tag: 'review' as const,
            transcript: initial.transcript,
            editedText: event.text,
          };
        }
        return initial;
      case 'send-review':
        if (initial.tag === 'review') {
          return {
            tag: 'requesting' as const,
            transcript: { ...initial.transcript, final: event.text },
            continuous: false,
          };
        }
        return initial;
      case 'cancel-review':
        return initial.tag === 'review'
          ? { tag: 'idle' as const }
          : initial;
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
