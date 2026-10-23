import { Show, createEffect, createSignal, type JSX } from 'solid-js';
import { Effect } from 'effect';
import {
  voiceAIState,
  voiceAIError,
  voiceAISupported,
  voiceAIPanelArmed,
  startVoiceAI,
  stopVoiceAI,
  cancelVoiceAIInFlight,
  requestVoiceAIPanelArmed,
  clearVoiceAIPanelArmed,
  voiceAITranscript,
} from '../state/voiceAIStore';
import { MicIcon } from '../icons';
import { consoleStore } from './consoleStore';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import type { SttUnsupportedError } from '~/application/voice/STTEngine';


type Props = {
  readonly lang?: 'ru-RU' | string;
};

/** ms before a press is considered a "hold" instead of a "tap". */
const HOLD_DEBOUNCE_MS = 50;

/**
 * Press-lifecycle FSM. Replaces the previous pair of `pressed` /
 * `pressTimer` flags that couldn't distinguish "hold callback
 * fired" from "timer was cancelled".
 *
 *   idle    — nothing pressed.
 *   pending — pointerdown fired; debounce timer is queued.
 *   holding — debounce fired; oneshot session running.
 *   tapped  — pointerup before debounce; continuous session
 *             was started in onPointerUp. Recording is active.
 *
 * The hint chip (`voice-mini-fab__hint`) is shown for any
 * non-`idle` state so the user sees "I pressed it" instantly —
 * even on the way to the debounce.
 */
type PressState =
  | 'idle'
  | 'pending'
  | 'holding'
  | 'tapped';

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

/** Run a possibly-failing Effect with a user-facing toast on failure. */
const runEffectSafely = async (
  eff: ReturnType<typeof startVoiceAI>,
): Promise<void> => {
  try {
    await Effect.runPromise(eff);
  } catch (err) {
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
  }
};

/**
 * VoiceAIMiniFAB — speed-dial mini button for the voice-AI feature.
 *
 *   - Hold (≥ 50ms)       → start a `continuous` session (one
 *                           utterance, auto-reviews on the first
 *                           `final` chunk — the user still has to
 *                           press «→ В ИИ» to send, see
 *                           decisions/wavecode-voice-confirm-before-send)
 *   - Quick tap (< 50ms)  → open `RecordingPanel` in the
 *                           "вооружена, ждём ●REC" state without
 *                           starting a session. The user then presses
 *                           ●REC inside the panel to actually begin.
 *   - Tap while listening → stop the session
 *   - Disabled (with tooltip) when `!voiceAISupported()`
 *
 * Why the tap / hold split goes through the panel now
 * ---------------------------------------------------
 * Earlier revisions made a fast tap start a session immediately
 * (`mode: 'continuous'`). The user found that an accidental press
 * during an unrelated moment — e.g. tapping on the FAB to look up
 * its tooltip — would quietly open the mic and start streaming
 * audio to STT, with no visual feedback distinguishable from
 * "I pressed and waited for the conversation to start". The new
 * gate moves the start decision behind the panel: a quick tap only
 * signals intent; the actual `startVoiceAI` call is gated on a
 * deliberate ●REC click. Holding the FAB past the debounce is
 * preserved as the "I want this now" path.
 *
 * Why this lives in `VoiceAIMiniFAB` and not in
 * `voiceSessionReducer`
 * -----------------------------------------------
 * The reducer owns transitions across the STT / LLM / score-touching
 * "active session" lifecycle. "The user opened the panel before
 * pressing record" is UI state with no observable to the
 * orchestrator — it does not affect mic acquisition, the STT engine,
 * or the score; the `startVoiceAI` call still goes through the same
 * path it always did. Adding an `armed` state to the reducer would
 * require a fourth state per mode (armed, armed-oneshot,
 * armed-continuous) just to render one button. A presentation-layer
 * signal in `voiceAIStore` (`voiceAIPanelArmed`) is the minimum that
 * expresses the requirement.
 */
export function VoiceAIMiniFAB(props: Props): JSX.Element {
  // Press-lifecycle FSM. Replaces the previous pair of `pressed` /
  // `pressTimer` flags that couldn't distinguish "hold callback
  // fired" from "timer was cancelled". Old code inferred
  // `wasHoldAlreadyFired` from `pressTimer === null`, but
  // `clearTimer()` ALSO nulled that field — so a fast tap (which
  // calls `clearTimer()` on `onPointerUp`) looked identical to a
  // hold-already-fired. Result on mobile Chrome: every quick
  // tap silently exited the handler without starting a session.
  //
  // We model the FSM as a Solid signal so the JSX bindings (data-press,
  // hint visibility) re-render automatically. Plain `let` would also
  // work in the closure-scoped event handlers, but the JSX refs need a
  // tracked dep.
  const [state, setState] = createSignal<PressState>('idle');
  let pressTimer: number | null = null;

  const clearTimer = (): void => {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const onPointerDown = (): void => {
    if (!voiceAISupported()) return;
    if (state() !== 'idle') return;
    setState('pending');
    pressTimer = window.setTimeout(() => {
      // Hold threshold reached → start a continuous session now.
      // The orchestrator's auto-review fires on the first final
      // chunk; the user still has to confirm via «→ В ИИ».
      if (state() !== 'pending') return;        // already released
      pressTimer = null;
      setState('holding');
      clearVoiceAIPanelArmed();
      void runEffectSafely(
        startVoiceAI({ mode: 'continuous', lang: props.lang ?? 'ru-RU' }),
      );
    }, HOLD_DEBOUNCE_MS);
  };

  const onPointerUp = (): void => {
    if (state() === 'idle') return;
    if (state() === 'holding') {
      // The debounce fired while the finger was down, so a session is
      // already running. Releasing must stop it: the confirm-before-send
      // design makes the *engine* deliver the final chunk on its own
      // (1.3 s of silence on the server relay, end-of-utterance on Web
      // Speech), so holding the button open past the utterance buys
      // nothing and leaves the user unable to say anything new — every
      // further word lands in the same buffer. Before
      // `wavecode-voice-confirm-before-send` this branch deliberately
      // did NOT stop (auto-commit owned the send); now auto-commit is
      // gone and the stop is the user's only way to end the take.
      void runEffectSafely(Effect.suspend(() => stopVoiceAI()));
      clearVoiceAIPanelArmed();
      setState('idle');
      return;
    }
    if (state() === 'pending') {
      // Fast tap (< 50ms). Cancel the pending hold-callback and
      // decide what to do based on the orchestrator's FSM tag:
      //   - idle / errored → open the panel in the "armed, wait for
      //     ●REC" state. We deliberately do NOT call
      //     `startVoiceAI` here — that's the panel's ●REC's job.
      //     Previously this branch started a continuous session
      //     immediately, which surprised users who tapped while
      //     scrolling by.
      //   - any other FSM tag → stop the session (tap-during-
      //     recording preserves the previous behaviour).
      clearTimer();
      setState('tapped');
      const fsmState = voiceAIState();
      if (fsmState.tag !== 'idle' && fsmState.tag !== 'errored') {
        // Tap during an active session → stop.
        void runEffectSafely(Effect.suspend(() => stopVoiceAI()));
        clearVoiceAIPanelArmed();
        setState('idle');
        return;
      }
      requestVoiceAIPanelArmed();
      setState('idle');
      return;
    }
    // 'tapped' (user tapped again on an already-running session):
    // the second onPointerUp is treated as "stop" only via the
    // FSM-state check above. Reaching here means the session has
    // already settled.
    setState('idle');
  };

  // Sync the local press FSM with the orchestrator FSM. When the
  // session ends (FSM leaves `listening`/`transcribing`), drop our
  // local pointer-state too so a subsequent tap isn't ignored.
  createEffect(() => {
    const tag = voiceAIState().tag;
    if (state() === 'tapped' && (tag === 'idle' || tag === 'errored')) {
      setState('idle');
    }
    if (state() === 'holding' && (tag === 'idle' || tag === 'errored')) {
      setState('idle');
    }
  });

  const titleText = (): string => {
    if (!voiceAISupported()) {
      return 'Открой в Chrome для голосового управления';
    }
    const err = voiceAIError();
    if (err !== null) return err;
    return 'Голос → ИИ (нажми и держи или тапни для сессии)';
  };

  // Read this once per render; the helper returns a stable string
  // for the press FSM. Used by `data-tap-mode` for both styling
  // and test selectors; tests expect exactly the strings
  // 'continuous' / 'oneshot', never 'pending' / 'holding'.
  const tapModeAttr = (): 'continuous' | 'oneshot' => {
    if (state() === 'tapped') return 'continuous';
    return 'oneshot';
  };

  return (
    <button
      type="button"
      class="voice-mini-fab voice-mini-fab--ai"
      data-state={voiceAIState().tag}
      data-tap-mode={tapModeAttr()}
      data-permission-blocked={isPermissionBlocked() ? 'true' : 'false'}
      data-press={state()}
      disabled={!voiceAISupported()}
      title={titleText()}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      // `pointerleave` must NOT end a hold on touch. A finger held
      // on a ~44 px target drifts a few pixels as you press, and
      // `pointerleave` fires the moment the touch point crosses the
      // edge — which on a phone happens mid-dictation, every time.
      // The take was ending while the user was still holding the
      // button: the panel switched to «распознаю…» under their
      // thumb and kept counting after they finally let go.
      //
      // Mouse users still get slide-off-to-cancel, which is the
      // affordance that handler was written for. On touch the
      // equivalent gesture is a drag far past the button, and
      // `pointercancel` (the OS took the gesture) is the honest
      // signal for "this press was aborted".
      onPointerLeave={(e) => {
        if (e.pointerType === 'touch') return;
        if (state() === 'pending' || state() === 'holding') onPointerUp();
      }}
      onPointerCancel={() => {
        if (state() === 'pending' || state() === 'holding') onPointerUp();
      }}
      aria-label="Голосовое управление ИИ"
    >
      <MicIcon size={18} />
      <span class="voice-mini-fab__label" aria-hidden="true">Голос</span>
      {/* Hint visible for any active orchestrator state OR while the
          local press FSM is non-idle (pending / holding / tapped).
          This is what closes the "did the press register?" window —
          on `pointerdown` the user sees a "Слушаю…" chip instantly,
          even before the first STT chunk arrives (which on mobile
          Chrome can take 2-5s through Google's cloud STT). */}
      <Show when={(() => {
        if (state() !== 'idle') return true;
        if (voiceAIPanelArmed()) return true;
        const tag = voiceAIState().tag;
        return tag === 'listening' || tag === 'transcribing'
          || tag === 'arming' || tag === 'requesting' || tag === 'applying';
      })()}>
        <span
          class="voice-mini-fab__hint"
          data-source={state() === 'idle'
            ? (voiceAIPanelArmed() ? 'armed' : 'transcript')
            : 'press'}
          aria-hidden="true"
        >
          {state() === 'idle'
            ? (voiceAIPanelArmed()
                ? 'Готов к записи'
                : (voiceAITranscript().interim || voiceAITranscript().final || '…'))
            : (state() === 'pending' || state() === 'holding'
                ? 'Слушаю…'
                : '')}
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
