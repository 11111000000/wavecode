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
const MIN_HOLD_BEFORE_RELEASE_OK_MS = 80;

/**
 * WhistleMiniFAB — press-and-hold mini button for whistle-to-score.
 *
 *   - pointerdown → acquire `mic-direct` + start orchestrator
 *   - pointerup   → commit (notesToSnippet → audio.eval) → stop
 *
 * The session is "press-and-hold" only — no tap-to-toggle, no
 * continuous. Auto-release after `HOLD_NOTICE_MS` (250ms) of held
 * state gives the user a visual hint that "I'm listening".
 *
 * Mobile quirk (2026-10-19): on Android Chrome a quick touch fires
 * `pointerleave` ~10-40ms after `pointerdown` (even without the
 * finger moving), so the OLD design's "if pointerleave/cancel →
 * commit" branch fired on every short press, even when the user
 * intended to hold. Result: a `commit()` ran on an empty buffer
 * every time, generating zero notes, and the FSM cycled to idle
 * without ever producing audio. The new design gates the release
 * on a minimum-hold threshold (`MIN_HOLD_BEFORE_RELEASE_OK_MS`):
 * if pointerup/-leave/-cancel fires BEFORE that elapsed, we
 * ignore the release and KEEP listening — the user genuinely held
 * the button and the browser just spat out a transient event.
 */
export function WhistleMiniFAB(): JSX.Element {
  let sessionId: string | null = null;
  let pressed = false;
  let showHint = false;
  let hintTimer: number | null = null;
  /** Wall-clock ms when the user pressed down. Used to gate the
   *  `pointerup` / `pointerleave` / `pointercancel` branches: only
   *  commits+stops if the press has been held longer than
   *  `MIN_HOLD_BEFORE_RELEASE_OK_MS`. Mobile Chrome spuriously
   *  fires `pointerleave` ~10-40ms after `pointerdown`; without
   *  this gate, every short press would commit an empty buffer. */
  let pressedAtMs: number | null = null;

  const ensureSessionId = (): string => {
    if (sessionId === null) {
      sessionId = makeSessionId();
    }
    return sessionId;
  };

  const onPointerDown = (): void => {
    if (pressed) return;
    pressed = true;
    pressedAtMs = Date.now();
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

  /** True only when the user genuinely held the button long enough
   *  to have produced real audio. Below the threshold, `pointerleave`
   *  and `pointercancel` on mobile Chrome fire spuriously, and we
   *  must NOT release the session in response. */
  const isHoldLongEnough = (): boolean => {
    if (pressedAtMs === null) return false;
    return Date.now() - pressedAtMs >= MIN_HOLD_BEFORE_RELEASE_OK_MS;
  };

  const releaseIfReal = (): void => {
    if (!pressed) return;
    if (!isHoldLongEnough()) return;
    pressed = false;
    pressedAtMs = null;
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
      data-pressed={pressed ? 'true' : 'false'}
      title={titleText()}
      onPointerDown={onPointerDown}
      onPointerUp={releaseIfReal}
      onPointerLeave={releaseIfReal}
      onPointerCancel={releaseIfReal}
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
