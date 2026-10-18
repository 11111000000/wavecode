import { Show, type JSX } from 'solid-js';
import { Effect } from 'effect';
import {
  voiceAIState,
  voiceAIError,
  voiceAISupported,
  startVoiceAI,
  stopVoiceAI,
  cancelVoiceAIInFlight,
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
 *   - Quick tap (< 50ms)  → start a `continuous` session
 *   - Hold (≥ 50ms)       → start a `oneshot` session (auto-commits
 *                           on the first final chunk); release does
 *                           NOT stop it
 *   - Tap while listening → stop the session
 *   - Disabled (with tooltip) when `!voiceAISupported()`
 */
export function VoiceAIMiniFAB(props: Props): JSX.Element {
  let pressTimer: number | null = null;
  let pressed = false;
  /** Whether a tap (vs hold) was the trigger for the active session. */
  let continuousActive = false;

  const clearTimer = (): void => {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const onPointerDown = (): void => {
    if (!voiceAISupported()) return;
    if (pressed) return;
    pressed = true;
    continuousActive = false;
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      // Hold threshold reached → start a oneshot session now.
      // Orchestrator auto-commits on the first final chunk.
      void runEffectSafely(
        startVoiceAI({ mode: 'oneshot', lang: props.lang ?? 'ru-RU' }),
      );
    }, HOLD_DEBOUNCE_MS);
  };

  const onPointerUp = (): void => {
    if (!pressed) return;
    clearTimer();
    const wasHoldAlreadyFired = pressTimer === null;
    pressed = false;
    if (wasHoldAlreadyFired) {
      // Hold callback already fired (oneshot session running);
      // release should NOT stop — auto-commit does.
      return;
    }
    const state = voiceAIState();
    if (state.tag !== 'idle' && state.tag !== 'errored') {
      // Tap during an active session → stop.
      void runEffectSafely(Effect.suspend(() => stopVoiceAI()));
      continuousActive = false;
      return;
    }
    // Idle + tap before threshold → start a continuous session.
    continuousActive = true;
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
    return 'Голос → ИИ (нажми и держи или тапни для сессии)';
  };

  return (
    <button
      type="button"
      class="voice-mini-fab voice-mini-fab--ai"
      data-state={voiceAIState().tag}
      data-tap-mode={continuousActive ? 'continuous' : 'oneshot'}
      disabled={!voiceAISupported()}
      title={titleText()}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { if (pressed) onPointerUp(); }}
      onPointerCancel={() => { if (pressed) onPointerUp(); }}
      aria-label="Голосовое управление ИИ"
    >
      <MicIcon size={18} />
      <Show when={voiceAIState().tag === 'listening' || voiceAIState().tag === 'transcribing'}>
        <span class="voice-mini-fab__hint" aria-hidden="true">
          {voiceAITranscript().interim || voiceAITranscript().final || '…'}
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
