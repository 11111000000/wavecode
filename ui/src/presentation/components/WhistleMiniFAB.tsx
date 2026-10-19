import { Show, type JSX } from 'solid-js';
import { Effect } from 'effect';
import {
  whistleState,
  whistleError,
  startWhistle,
  commitWhistle,
  stopWhistle,
} from '../state/whistleStore';
import { WhistleIcon } from '../icons';
import { consoleStore } from './consoleStore';
import type { MicBusyError } from '~/domain/audio/MicChannel';

const HOLD_NOTICE_MS = 250;

/**
 * WhistleMiniFAB — press-and-hold mini button for whistle-to-score.
 *
 *   - pointerdown → acquire `mic-direct` + start orchestrator
 *   - pointerup   → commit (notesToSnippet → audio.eval) → stop
 *
 * The session is "press-and-hold" only — no tap-to-toggle, no
 * continuous. Auto-release after `HOLD_NOTICE_MS` (250ms) of held
 * state gives the user a visual hint that "I'm listening".
 */
export function WhistleMiniFAB(): JSX.Element {
  let sessionId: string | null = null;
  let pressed = false;
  let showHint = false;
  let hintTimer: number | null = null;

  const ensureSessionId = (): string => {
    if (sessionId === null) {
      sessionId = makeSessionId();
    }
    return sessionId;
  };

  const onPointerDown = (): void => {
    if (pressed) return;
    pressed = true;
    showHint = false;
    if (hintTimer !== null) window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      hintTimer = null;
      showHint = true;
    }, HOLD_NOTICE_MS);
    const sid = ensureSessionId();
    void runEffectSafely(
      Effect.gen(function* () {
        yield* startWhistle({ sessionId: sid });
      }),
    );
  };

  const onPointerUp = (): void => {
    if (!pressed) return;
    pressed = false;
    if (hintTimer !== null) {
      window.clearTimeout(hintTimer);
      hintTimer = null;
    }
    showHint = false;
    void runEffectSafely(
      Effect.gen(function* () {
        yield* commitWhistle();
      }),
    );
    void runEffectSafely(stopWhistle());
  };

  const titleText = (): string => {
    const err = whistleError();
    if (err !== null) return err;
    return 'Насвисти мелодию';
  };

  return (
    <button
      type="button"
      class="voice-mini-fab voice-mini-fab--whistle"
      data-state={whistleState().tag}
      title={titleText()}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { if (pressed) onPointerUp(); }}
      onPointerCancel={() => { if (pressed) onPointerUp(); }}
      aria-label="Свист → музыка"
    >
      <WhistleIcon size={18} />
      <span class="voice-mini-fab__label" aria-hidden="true">Свист</span>
      <Show when={showHint && (whistleState().tag === 'arming' || whistleState().tag === 'recording')}>
        <span class="voice-mini-fab__hint" aria-hidden="true">
          слушаю…
        </span>
      </Show>
    </button>
  );
}

/** Stable session id; prefer crypto.randomUUID when available. */
const makeSessionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `whistle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Run a possibly-failing Effect with a user-facing toast on failure. */
const runEffectSafely = async (
  eff: Effect.Effect<unknown, unknown, never>,
): Promise<void> => {
  try {
    await Effect.runPromise(eff as never);
  } catch (err) {
    const msg = (() => {
      if (typeof err === 'object' && err !== null) {
        const tag = (err as { readonly _tag?: unknown })._tag;
        if (tag === 'MicBusy') {
          const e = err as MicBusyError;
          return 'Микрофон занят другим режимом ('
            + e.conflictingChannel.owner.kind + ')';
        }
      }
      return err instanceof Error ? err.message : String(err);
    })();
    consoleStore.pushToast({
      severity: 'warn',
      title: 'Свист',
      body: msg,
    });
  }
};
