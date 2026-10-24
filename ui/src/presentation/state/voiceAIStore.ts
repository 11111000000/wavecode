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
 * shares its internal pipeline with our AudioContext). When the
 * resolved STT engine is the server relay — it opens the mic itself
 * — voice-AI additionally claims `mic-direct`, so the whistle cannot
 * grab the same device mid-dictation. The mutex still tracks the
 * session so future mic-direct paths re-use the single-slot rule.
 * See `decisions/wavecode-voice-fab.yaml` outcome
 * `mic-mutex-correct`.
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
import {
  initialVoiceSession,
  voiceSessionReducer,
} from '~/domain/voice/voiceSession';
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
import { resolveSttEngineKind } from '~/infrastructure/stt/selectSttLayer';
import { getServerWhisperRmsLevel } from '~/infrastructure/stt/ServerWhisperSTT';
import { appStore, dispatch as dispatchApp } from './appStore';
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

/**
 * UI flag: the user has tapped the voice-AI FAB without pressing
 * long enough to start a session. The recording panel renders in
 * "вооружена, ждём ●REC" mode until either the user presses the
 * in-panel ●REC button (which clears the flag and starts the
 * orchestrator) or ✕ dismisses the panel.
 *
 * Pure presentation concern, not a domain FSM tag — the wavecode-
 * voice-rec-and-meter decision explicitly rejects adding an `armed`
 * state to `voiceSessionReducer`. The reducer's job is orchestrator
 * + STT + LLM; "user opened the panel" is local to the FAB + panel.
 */
export const [voiceAIPanelArmed, setVoiceAIPanelArmed] = createSignal<boolean>(
  false,
);

/** Request the voice-AI armed state. Called by `VoiceAIMiniFAB` on a
 *  fast tap below the hold-debounce threshold. Idempotent. */
export const requestVoiceAIPanelArmed = (): void => {
  setVoiceAIPanelArmed(true);
};

/** Clear the voice-AI armed state. Called when the in-panel ●REC
 *  fires the orchestrator (so the live body takes over) or when the
 *  user dismisses the panel via ✕. */
export const clearVoiceAIPanelArmed = (): void => {
  setVoiceAIPanelArmed(false);
};

/**
 * Live RMS level of the active recording. `null` when no recording
 * is in flight — the panel uses that to render no meter instead of
 * fabricating a value. The polling timer is set up by
 * `startVoiceAI` and torn down by `stopVoiceAI`; on the Web Speech
 * path the meter source (`getServerWhisperRmsLevel`) returns null,
 * so the signal stays null and the panel shows nothing.
 */
export const [voiceAIRmsLevel, setVoiceAIRmsLevel] = createSignal<number | null>(
  null,
);

/**
 * Seconds since the current dictation started.
 *
 * Web Speech streams partials, so the user always sees words while
 * the mic is hot. The server relay cannot: it answers once, after
 * the whole clip is uploaded (~16 s, see `SERVER_ENGINE_SILENCE_SEC`).
 * A bare "записываю" with no
 * counter reads as a hang, so the panel shows this instead of
 * pretending there is live text.
 */
export const [voiceAIElapsedSec, setVoiceAIElapsedSec] = createSignal<number>(0);

/**
 * True between "the finger came off the button" and "the transcript
 * landed".
 *
 * `stopVoiceAI` tears the meter and the elapsed counter down
 * immediately, but the engine then spends one relay round trip
 * (~16-32 s measured) flushing the take. Without this flag the panel
 * would sit on a frozen «записываю… 3 с» for those seconds — which
 * reads as a hang, and is exactly the "recording doesn't start /
 * nothing happens" impression this change set exists to remove.
 */
export const [voiceAIFlushing, setVoiceAIFlushing] = createSignal<boolean>(false);

let elapsedTimer: number | null = null;

/**
 * Cloud Web Speech streams partials in ~1-2 s, so four seconds of
 * total silence means the recogniser is genuinely dead — that is the
 * Chromium-without-Google-services failure this watchdog was written
 * for, and it is exactly what it catches.
 */
const WEB_ENGINE_SILENCE_SEC = 4;

/**
 * Our whisper relay cannot answer faster than its own encode: measured
 * on the host (2026-10-23, `ggml-base-q5_1` on 4 vCPU QEMU) a 1 s clip
 * took 17.1 s and a 3 s clip 15.8-16.6 s, because whisper.cpp encodes a
 * fixed 30 s window whatever the clip length. A phone-recorded take ran
 * 32.2 s. The previous bound here was 20 s, written against a "2.6-5.2 s
 * measured" note that no longer describes this host — so the watchdog
 * fired on nearly every healthy take, flipped the FSM to `errored`, and
 * threw away the transcript that was still in flight. A slow recogniser
 * was being reported as a dead one.
 *
 * 60 s leaves room for two round trips (a flush can queue behind
 * another request in the relay's single slot) while still catching an
 * engine that is genuinely wedged. See `decisions/wavecode-server-stt`.
 */
const SERVER_ENGINE_SILENCE_SEC = 60;

/** RMS poll cadence. Matches `ServerWhisperSTT.METER_POLL_MS` so the
 *  bar reflects whatever the STT meter observed within ~100 ms —
 *  fast enough for the eye, cheap enough that the JS timer budget
 *  isn't strained even on mobile. */
const RMS_POLL_MS = 100;
let rmsPollTimer: number | null = null;

/**
 * Begin polling the active STT meter. The server engine exposes a
 * live level through `getServerWhisperRmsLevel`; on the Web Speech
 * path that returns `null` and the signal stays null — `RecordingPanel`
 * renders no bar in that case (see the wavecode-voice-rec-and-meter
 * decision's "meter-availability-is-server-only" outcome).
 */
const startRmsPoll = (): void => {
  if (rmsPollTimer !== null) return;
  rmsPollTimer = window.setInterval(() => {
    setVoiceAIRmsLevel(getServerWhisperRmsLevel());
  }, RMS_POLL_MS);
};

const stopRmsPoll = (): void => {
  if (rmsPollTimer !== null) {
    window.clearInterval(rmsPollTimer);
    rmsPollTimer = null;
  }
  setVoiceAIRmsLevel(null);
};

/**
 * How long `listening` may stay empty before we call the engine
 * wedged. Engine-specific because the two engines have genuinely
 * different first-chunk latencies. See the watchdog comment inside
 * `startElapsedTimer` for why a flat 4 s was wrong.
 *
 * SECONDS, because that is the unit `voiceAIElapsedSec` counts in.
 * An earlier revision of this fix stored the bounds in milliseconds
 * and compared them against a second count, which pushed the server
 * bound to 20 000 s — i.e. the watchdog never fired at all, and the
 * "genuinely wedged engine" case it exists for went back to hanging
 * silently. The unit is named in every identifier on purpose.
 */
const silenceWatchdogSec = (): number =>
  resolveSttEngineKind() === 'server'
    ? SERVER_ENGINE_SILENCE_SEC
    : WEB_ENGINE_SILENCE_SEC;

const startElapsedTimer = (): void => {
  if (elapsedTimer !== null) return;
  setVoiceAIElapsedSec(0);
  elapsedTimer = window.setInterval(
    () => {
      setVoiceAIElapsedSec((s) => s + 1);
      // Watchdog: if we have been in `listening` for 4+ seconds and
      // still no transcript chunks have arrived, surface a clear
      // error instead of leaving the user staring at «записываю…
      // N с» forever. The orchestrator's stream-level `Stream.tapError`
      // does not fire for a quiet stream that never fails — it only
      // runs on a terminal error. Cloud Speech in Chromium without
      // Google services is exactly that: it produces no chunks and no
      // error, so the user gets no signal at all. The
      // `Stream.timeoutFail` watchdog in `FallbackSTT` runs in the
      // Effect runtime and depends on actual chunk production, which a
      // blocked engine never does; this client-side watchdog covers
      // the silent-engine case regardless of which path the orchestrator
      // is on.
      //
      // The threshold is per-engine, and the difference is not
      // cosmetic. On the server relay the first chunk cannot arrive
      // before one whisper round trip completes — 15.8-17.1 s measured
      // warm on 2026-10-23, 32.2 s for a phone-recorded take under a
      // queued retry storm (`decisions/wavecode-server-stt`); the
      // interim tick that used to fire at 2.5 s only added to that
      // wait rather than shortening it. A flat 4 s threshold
      // therefore fired on EVERY take, before any text could possibly
      // exist, and replaced a working panel with "Не удалось получить
      // текст от движка распознавания" — a false accusation against a
      // recogniser that was fine and on its way.
      const elapsed = voiceAIElapsedSec();
      const t = voiceAITranscript();
      if (
        voiceAIState().tag === 'listening'
        // A release-flush keeps the FSM in `listening` with an empty
        // buffer BY DESIGN — that is what «распознаю…» renders. The
        // engine is not silent then, it is answering, so the watchdog
        // must not accuse it. Without this a 32 s round trip tripped
        // its own error path.
        && !voiceAIFlushing()
        && elapsed >= silenceWatchdogSec()
        && t.interim === ''
        && t.final === ''
      ) {
        setVoiceAIState({
          tag: 'errored',
          error:
            'Не удалось получить текст от движка распознавания. Проверьте разрешения микрофона в адресной строке и попробуйте снова.',
          transcript: t,
        });
        // Stop the timer — the error state owns the rest of the UX.
        if (elapsedTimer !== null) {
          window.clearInterval(elapsedTimer);
          elapsedTimer = null;
        }
      }
    },
    1000,
  );
};

const stopElapsedTimer = (): void => {
  if (elapsedTimer !== null) {
    window.clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  setVoiceAIElapsedSec(0);
};

export type VoiceAIStartOpts = {
  readonly mode: 'oneshot' | 'continuous';
  readonly lang: 'ru-RU' | string;
  readonly bargeInMode?: 'replace' | 'queue' | 'ignore';
};

/* ── module handle ────────────────────────────────────────────────── */

let handle: VoiceSessionHandle | null = null;
let activeSessionId: string | null = null;

/**
 * Drop the mic claims of whichever session is currently open, and
 * forget it. Idempotent: with no open session it does nothing.
 *
 * Called from every terminal path — explicit stop, dismiss, review
 * cancel — plus the self-terminating one (a take that reaches `review`
 * on its own via the silence flush, where nothing else runs).
 */
const releaseOwnChannels = (): void => {
  const sid = activeSessionId;
  if (sid === null) return;
  activeSessionId = null;
  releaseMic(sid);
};
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
    // Editor write-back. The orchestrator evaluates the LLM's score
    // through `audio.eval` but cannot reach the app store on its own
    // (`application/` must not import `presentation/`), so the
    // dispatch is injected here — the same `replaceScore` call
    // `AIEditPanel`, `micStore`, `whistleStore` and `pianoRecStore`
    // already make. Without it the voice path played the new pattern
    // and left the editor buffer untouched, which the user reported
    // as "the LLM failed to parse it".
    onApplied: (score: string): void => {
      dispatchApp({ type: 'replaceScore', text: score });
    },
  });
  handle = Effect.runSync(handleProgram);

  installScoreSync(services.scoreRef);

  // Subscribe to the orchestrator's FSM stream. If the stream errors
  // (e.g. `no-speech-api` from a primary STT that lacks its
  // constructor, or a `network` failure from a server relay that
  // exhausted its retries), surface the error in the local mirror so
  // the recording panel can show it instead of sticking at
  // «записываю… N с». `Stream.tapError` is the Effect equivalent of
  // a side-effecting error handler; it does not consume the error
  // (the subscriber still terminates) but lets us observe it before
  // the stream collapses.
  Effect.runFork(
    Stream.tapError((err) => {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err);
      untrack(() => {
        setVoiceAIState({
          tag: 'errored',
          error: message,
          transcript: initialTranscriptState(
            (() => {
              const cur = voiceAIState();
              return cur.tag === 'errored' ? cur.transcript.lang : (cur as { transcript: { lang: string } }).transcript.lang;
            })(),
          ),
        });
      });
      return Effect.void;
    })(handle.stream).pipe(
      Stream.runForEach((s) =>
        Effect.sync(() => { untrack(() => { publishState(s); }); }),
      ),
    ),
  );
}

/**
 * Single funnel for mirroring an FSM state into the Solid signals.
 *
 * Module scope rather than inline in the stream subscription so the
 * test fake handle can drive the exact same bookkeeping. When this
 * lived inside the subscription, `__setVoiceAIHandleForTests`
 * replaced the stream with an empty one and every mirror-side rule
 * (the flush flag, the mic release on `review`) became untestable —
 * the store tests stayed green against code they never executed.
 */
const publishState = (s: VoiceSessionState): void => {
  setVoiceAIState(s);
  // Leaving `listening` means the release-flush finished: either the
  // transcript landed (`review`) or the take was abandoned
  // (`errored` / `idle`).
  if (s.tag !== 'listening') setVoiceAIFlushing(false);
  // A take that reaches `review` by itself — the 1.3 s silence flush,
  // or the 100 s hard cap — never goes through `stopVoiceAI`, so
  // nothing released the mic claims. The engine has stopped by this
  // point (`subscribeLoop` calls `stt.stop()` on the way to review),
  // so holding `mic-direct` keeps the device locked for nothing and
  // blocks the whistle button.
  if (s.tag === 'review') releaseOwnChannels();
  if (
    s.tag === 'listening'
    || s.tag === 'transcribing'
    || s.tag === 'requesting'
    || s.tag === 'applying'
    || s.tag === 'paused'
    || s.tag === 'review'
    || s.tag === 'errored'
  ) {
    setVoiceAITranscript(s.transcript);
  }
  if (s.tag === 'errored') {
    setVoiceAIError(s.error);
  } else if (voiceAIError() !== null) {
    setVoiceAIError(null);
  }
};

/** Test-only: drive the FSM mirror without a real stream. */
export const __publishVoiceAIStateForTests = publishState;

/* ── start / stop / commit / cancel ──────────────────────────────── */

/**
 * Start a voice-AI session.
 *
 *   1. Acquire `speech-api-internal` channel under the `voice-ai`
 *      owner. Failure surfaces as `MicBusyError`.
 *   2. If the resolved STT engine is the server relay, also claim
 *      `mic-direct`: that engine calls `getUserMedia` itself, so
 *      without the second claim the whistle could open the same
 *      device mid-dictation. This is the case `decisions/
 *      wavecode-voice-fab` deferred to "when voice-AI is
 *      mic-direct" (outcome `mic-mutex-correct`); Chrome keeps the
 *      single channel it has always used.
 *   3. Run the orchestrator's `start` Effect.
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
    if (resolveSttEngineKind() === 'server') {
      const direct = acquireMic({
        kind: 'mic-direct',
        owner: { kind: 'voice-ai', sessionId },
        sessionId,
      });
      if (!direct.ok) {
        // Both claims belong to the same sessionId, so one release
        // takes the whole thing back down.
        releaseMic(sessionId);
        logger.push('warn', [
          'voiceAIStore.startVoiceAI: mic-direct busy',
          direct.error.conflictingChannel.owner.kind,
        ]);
        return yield* Effect.fail(direct.error);
      }
    }
    activeSessionId = sessionId;
    langAtInit = opts.lang;
    yield* Effect.sync(() => {
      setVoiceAIError(null);
      setVoiceAIFlushing(false);
      setVoiceAITranscript(initialTranscriptState(opts.lang));
      startElapsedTimer();
      startRmsPoll();
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
    const result = yield* Effect.either(handle.start(input));
    if (result._tag === 'Left') {
      // Surface start-time failures (e.g. `no-speech-api` when the
      // Web Speech API is missing) into the FSM, otherwise the panel
      // sits at «записываю… N с» forever with no way for the user to
      // see what went wrong. The caller also fires a toast via
      // `runEffectSafely`, but the FSM error is what makes the panel
      // show the message and the ✕ close the session. Without this,
      // voice-AI in a browser without Web Speech API was completely
      // silent: the stream was never created, the watchdog had nothing
      // to monitor, the user saw a stuck counter and an unresponsive ✕.
      // `err` is a discriminated union; `MicBusyError` has no `message`
      // field, so narrow to `SttUnsupportedError` before reading it.
      if (result.left._tag === 'SttUnsupported') {
        setVoiceAIState({ tag: 'errored', error: result.left.message, transcript: initialTranscriptState(opts.lang) });
      } else {
        setVoiceAIState({ tag: 'errored', error: 'Микрофон занят другой сессией', transcript: initialTranscriptState(opts.lang) });
      }
    }
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
    // Release flushes the take rather than cancelling it, so the
    // panel keeps rendering (as «распознаю…») until the final chunk
    // moves the FSM out of `listening`.
    setVoiceAIFlushing(true);
    stopElapsedTimer();
    stopRmsPoll();
    if (handle !== null) {
      yield* handle.stop();
    }
    const sid = activeSessionId;
    if (sid !== null) {
      yield* Effect.sync(() => releaseMic(sid));
    }
    activeSessionId = null;
  });

/** Close the recording panel and abandon the take.
 *
 *  `stopVoiceAI` leaves the FSM in `paused`, which the panel renders
 *  as an on-screen state — so a ✕ that only stops would strand the
 *  user at «на паузе». This tears the session down AND forces `idle`,
 *  which is what makes the ✕ actually close. Also interrupts an
 *  in-flight LLM route so a dismissed take cannot apply its edit
 *  afterwards. */
export const dismissVoiceAI = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    stopElapsedTimer();
    stopRmsPoll();
    if (handle !== null) {
      yield* handle.dismiss();
    } else {
      // No orchestrator (degraded start, or the FSM was driven
      // directly in tests). `stopVoiceAI` cannot help here either —
      // it only tears the capture side down and relies on the
      // orchestrator's `pause` dispatch, which needs a handle. Force
      // the signal to `idle` so the ✕ closes the panel instead of
      // stranding the user at «на паузе».
      yield* Effect.sync(() => setVoiceAIState(initialVoiceSession()));
    }
    const sid = activeSessionId;
    if (sid !== null) {
      yield* Effect.sync(() => releaseMic(sid));
    }
    activeSessionId = null;
    yield* Effect.sync(() => {
      setVoiceAIFlushing(false);
      setVoiceAITranscript(initialTranscriptState(langAtInit));
      setVoiceAIError(null);
      clearVoiceAIPanelArmed();
    });
  });

/** Barge-in: cancel any in-flight route and reset to idle. */
export const cancelVoiceAIInFlight = (): Effect.Effect<void, never, never> => {
  if (handle === null) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    stopElapsedTimer();
    stopRmsPoll();
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
    releaseOwnChannels();
    stopElapsedTimer();
    stopRmsPoll();
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

/** Test-only: drive the reducer directly.
 *
 *  This used to be a hand-written copy of the transition table, and
 *  that copy had drifted from `voiceSessionReducer` in both
 *  directions: it ignored interim chunks, it had no `arm` branch
 *  outside `idle`, and it had no `chunk` branch outside `listening`.
 *  A test that drives the copy therefore proved nothing about the
 *  FSM the app actually runs — and the production bugs this seam
 *  could not see were exactly the ones in the copy's blind spots
 *  (a press swallowed from `applying`, a take with only interim text
 *  parked where there was no send button).
 *
 *  Delegating to the real reducer makes the seam a true mirror
 *  instead of a second implementation. */
export const __dispatchVoiceAIForTests = (event: VoiceSessionEvent): void => {
  const next = voiceSessionReducer(voiceAIState(), event);
  if (next !== voiceAIState()) setVoiceAIState(next);
};

/** Test-only: reset module state. */
export const __resetVoiceAIForTests = (): void => {
  handle = null;
  activeSessionId = null;
  stopElapsedTimer();
  stopRmsPoll();
  setVoiceAIState(initialVoiceSession());
  setVoiceAITranscript(initialTranscriptState());
  setVoiceAIError(null);
  setVoiceAIFlushing(false);
  setVoiceAISupported(true);
  setVoiceAIPanelArmed(false);
};

onCleanup(() => {
  activeSessionId = null;
  handle = null;
  stopElapsedTimer();
  stopRmsPoll();
});
