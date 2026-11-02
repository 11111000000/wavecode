import { Show, type JSX } from 'solid-js';
import { Cause, Effect, Exit } from 'effect';
import {
  voiceAIState,
  voiceAIError,
  voiceAISupported,
  startVoiceAI,
  stopVoiceAI,
  cancelVoiceAIInFlight,
  voiceAIDraft,
  voiceAIFlushing,
} from '../state/voiceAIStore';
import { MicIcon } from '../icons';
import { consoleStore } from './consoleStore';
import { primeMicAudioContext } from '~/infrastructure/audio/micAudioContext';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import type { SttUnsupportedError } from '~/application/voice/STTEngine';

type Props = {
  readonly lang?: 'ru-RU' | string;
};

/**
 * The three states the button can be in. They are derived from the
 * orchestrator's FSM plus the store's `voiceAIFlushing` flag — the
 * orchestrator is the single source of truth, the FAB only mirrors it.
 *
 *   off       — nothing is being captured. A press starts a take.
 *   recording — the mic is open (or opening). A press stops it.
 *   busy      — the take was stopped and the engine is uploading it;
 *               the transcript is still on its way. A press starts
 *               the NEXT take — the orchestrator waits the drain
 *               out on its own, so the press is never swallowed.
 *   blocked   — the browser cannot record (no STT engine, no
 *               permission). The button is disabled.
 */
type Phase = 'off' | 'recording' | 'busy' | 'blocked';

/** Translate a typed fail reason into a user-facing message. */
const formatError = (
  err: MicBusyError | SttUnsupportedError,
): string => {
  if (err._tag === 'MicBusy') {
    return 'Микрофон занят другим режимом';
  }
  switch (err.reason) {
    case 'no-speech-api':
      return 'Открой в Chrome для голосового управления';
    case 'permission-denied':
      return 'Браузер заблокировал доступ к микрофону';
    case 'network':
      return 'Не получилось связаться с голосовым сервисом';
    case 'aborted':
      return 'Голосовой ввод прерван';
    default:
      return 'Не удалось запустить голосовой ввод';
  }
};

/** True when the most recent voice-AI failure was permission-related.
 *  Surfaced as a "blocked" badge on the FAB so the user knows why
 *  the cluster isn't responding — no need to tap repeatedly. */
const isPermissionBlocked = (): boolean => {
  const e = voiceAIError();
  if (e === null) return false;
  return /permission|NotAllowed|microphone.*block/i.test(e);
};

/**
 * Run a possibly-failing Effect with a user-facing toast on failure.
 *
 * `runPromiseExit` + `Cause.squash` instead of `runPromise`: the
 * latter rejects with the runtime's `FiberFailure` wrapper, whose
 * `_tag` is neither 'MicBusy' nor 'SttUnsupported' — the typed error
 * never reached the formatter and the toast showed the raw JSON of
 * the error object («{"_tag":"MicBusy","conflictingChannel":…}»).
 * Squashing the cause hands back the original error value, so the
 * user reads «Микрофон занят другим режимом (whistle)».
 */
const runEffectSafely = async (
  eff: Effect.Effect<void, MicBusyError | SttUnsupportedError, never>,
): Promise<void> => {
  const exit = await Effect.runPromiseExit(eff);
  if (Exit.isSuccess(exit)) return;
  const err = Cause.squash(exit.cause);
  const msg = (() => {
    if (typeof err === 'object' && err !== null) {
      const tag = (err as { readonly _tag?: unknown })._tag;
      if (tag === 'MicBusy' || tag === 'SttUnsupported') {
        return formatError(err as MicBusyError | SttUnsupportedError);
      }
    }
    return err instanceof Error ? err.message : String(err);
  })();
  consoleStore.pushToast({
    severity: 'warn',
    title: 'Голос',
    body: msg,
  });
};

/**
 * VoiceAIMiniFAB — the voice-AI button. One gesture, one meaning:
 * a press toggles the recording.
 *
 *   press  → recording starts, the button turns into a REC button
 *            (red dot, «REC» chip) and the panel shows that the take
 *            is under way.
 *   press  → the take stops, the audio is flushed to the recogniser
 *            and the panel shows the transcription as it arrives.
 *
 * Why the hold gesture is gone
 * ---------------------------
 * The button used to distinguish "hold" (≥ 50 ms) from "tap"
 * (< 50 ms): a hold started a session, a tap only armed the panel
 * and waited for an in-panel ●REC. That split existed because a tap
 * used to open the mic silently, and the panel's ●REC was the
 * deliberate second step. The user asked for the opposite contract —
 * «нажал один раз → идёт запись; нажал ещё раз → стоп» — and the
 * recording has to KEEP RUNNING after the finger leaves the button.
 * A hold gesture cannot express that: the recording ends with the
 * finger.
 *
 * The armed pre-step went with it: with the FAB itself being the
 * REC control, the panel's separate ●REC would have been a second
 * way to do the same thing, reachable by nobody.
 *
 * What is NOT lost
 * ----------------
 * The confirm-before-send contract stays: the take ends in `review`,
 * the text lands in the panel's editable field, and nothing reaches
 * the LLM until the user presses «→ В ИИ» (see
 * `decisions/wavecode-voice-confirm-before-send`).
 */
export function VoiceAIMiniFAB(props: Props): JSX.Element {
  const phase = (): Phase => {
    if (!voiceAISupported()) return 'blocked';
    // The flush window comes first: the FSM is still `listening`
    // while the recogniser is uploading the take, and the recording
    // is over even though the tag has not moved yet.
    if (voiceAIFlushing()) return 'busy';
    const tag = voiceAIState().tag;
    if (tag === 'arming' || tag === 'listening') return 'recording';
    return 'off';
  };

  const isRecording = (): boolean => phase() === 'recording';

  const onToggle = (): void => {
    const p = phase();
    if (p === 'blocked') return;
    if (p === 'recording') {
      // Second press: stop the take. `stopVoiceAI` flushes rather
      // than cancels — the audio is uploaded and the transcript lands
      // in the panel a round trip later. The effect is fire-and-
      // forget: blocking a touch handler on a ~16 s network round
      // trip is not an option, and the panel shows «Распознаю…» while
      // it waits.
      void runEffectSafely(Effect.suspend(() => stopVoiceAI()));
      return;
    }
    // First press (or a press during the flush window): start the
    // take. `continuous` keeps the session alive between utterances
    // so the next press can extend the same take (the reducer's
    // `arm` from `review`/`paused` preserves the transcript).
    //
    // The press during the flush used to be swallowed — the button
    // sat in a `stopping` phase and did nothing. That is the
    // «повторная запись не работает» report: the user released the
    // button, waited for the recogniser, pressed again to add a
    // sentence and got silence. Now the press starts the next take
    // and the orchestrator waits the drain out by itself.
    // The level meter needs an AudioContext, and on iOS it only runs if
    // it was created AND started inside this click — a context
    // created after the microphone prompt stays suspended and the
    // meter reads zeroes forever. See `micAudioContext.ts`.
    primeMicAudioContext();
    void runEffectSafely(
      startVoiceAI({ mode: 'continuous', lang: props.lang ?? 'ru-RU' }),
    );
  };

  const titleText = (): string => {
    if (!voiceAISupported()) {
      return 'Открой в Chrome для голосового управления';
    }
    const err = voiceAIError();
    if (err !== null) return err;
    return isRecording()
      ? 'Остановить запись'
      : 'Голос → ИИ (нажми, чтобы записать; нажми ещё раз, чтобы остановить)';
  };

  const hintText = (): string => {
    if (phase() === 'recording') return 'Слушаю…';
    if (phase() === 'busy') return 'Распознаю…';
    return voiceAIDraft() || '…';
  };

  const showHint = (): boolean => {
    const p = phase();
    if (p === 'recording' || p === 'busy') return true;
    return voiceAIDraft().trim().length > 0;
  };

  return (
    <button
      type="button"
      class="voice-mini-fab voice-mini-fab--ai"
      data-state={voiceAIState().tag}
      data-rec-state={isRecording() ? 'on' : 'off'}
      data-permission-blocked={isPermissionBlocked() ? 'true' : 'false'}
      disabled={!voiceAISupported()}
      aria-pressed={isRecording() ? 'true' : 'false'}
      aria-label={isRecording() ? 'Остановить запись' : 'Начать запись'}
      title={titleText()}
      onClick={onToggle}
    >
      <Show
        when={isRecording()}
        fallback={<MicIcon size={18} />}
      >
        {/* While recording the button IS the REC button: the mic
         * glyph is replaced by the blinking dot, so the state is
         * readable at a glance and not only from the panel. */}
        <span class="voice-mini-fab__rec-dot" aria-hidden="true" />
      </Show>
      <span class="voice-mini-fab__label" aria-hidden="true">
        {isRecording() ? 'REC' : 'Голос'}
      </span>
      <Show when={showHint()}>
        <span class="voice-mini-fab__hint" aria-hidden="true">
          {hintText()}
        </span>
      </Show>
      <Show when={isPermissionBlocked()}>
        <span class="voice-mini-fab__badge" aria-hidden="true" title="Браузер блокирует микрофон">
          !
        </span>
      </Show>
    </button>
  );
}

/** Convenience: clear/reset the FSM from a settings page (e.g. after a
 *  settings panel "barge-in: off" toggle). Exposed so tests + the
 *  override menu have one place to call. */
export const __cancelVoiceAI = (): void => {
  void Effect.runPromise(cancelVoiceAIInFlight());
};
