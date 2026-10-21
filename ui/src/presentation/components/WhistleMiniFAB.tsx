import { Show, createSignal, type JSX } from 'solid-js';
import { Effect } from 'effect';
import {
  whistleState,
  whistleError,
  whistleInstrumentLabel,
  whistlePanelArmed,
  startWhistle,
  stopWhistle,
  requestWhistlePanelArmed,
} from '../state/whistleStore';
import { WhistleIcon } from '../icons';
import { consoleStore } from './consoleStore';
import type { MicBusyError } from '~/domain/audio/MicChannel';

const HOLD_NOTICE_MS = 250;
const MIN_HOLD_BEFORE_RELEASE_OK_MS = 80;

/**
 * WhistleMiniFAB — whistle-to-score control with two gestures:
 *
 *   - Hold (≥ 80ms)         → start the orchestrator immediately;
 *                            release stops it. NO commit on release —
 *                            the buffered notes stay in the panel's
 *                            «Применить» queue.
 *   - Quick tap (< 80ms)    → the orchestrator was started briefly,
 *                            but on `pointerup` we stop it AND
 *                            open the `RecordingPanel` in its
 *                            "armed, ждёт ●REC" state. The user
 *                            then presses ●REC to actually start
 *                            and «Применить» to splice.
 *
 * Why commit-on-release was removed
 * ---------------------------------
 * The previous lifecycle (release splices the buffered snippet)
 * paired poorly with the new REC-toggle affordance: a user could
 * press-and-release (auto-splice) AND THEN press «Применить» again,
 * producing two `dispatch replaceScore` calls for the same notes.
 * The fix is to keep the orchestrator alive on release (it just
 * stops recording, leaving the buffered notes untouched) and let
 * «Применить» in the panel own the splice. While the panel is open
 * the user can re-press ●REC to add more notes before «Применить»
 * applies the combined buffer in one shot.
 *
 * Mobile quirk (2026-10-19 + 2026-10-21)
 * --------------------------------------
 * Android Chrome fires `pointerleave` ~10-40ms after `pointerdown`
 * (even without the finger moving). The legacy code gated ALL
 * releases on `MIN_HOLD_BEFORE_RELEASE_OK_MS` to ignore the
 * spurious event. The new code keeps the gate but separates
 * handlers: `pointerleave/cancel` still ignore sub-threshold
 * events entirely, `pointerup` distinguishes hold-release (stop)
 * from fast-tap (stop+open panel) using the same threshold.
 *
 * The orchestrator is started immediately on `pointerdown` (no
 * deferred-start timer) so the existing 2026-10-19 regression
 * test "sub-threshold pointerleave does NOT abort an active
 * recording" remains valid byte-for-byte — the difference vs the
 * previous code is only what `onPointerUp` does on a sub-threshold
 * tap (it opens the panel as well).
 */
export function WhistleMiniFAB(): JSX.Element {
  let sessionId: string | null = null;
  let pressed = false;
  const [showHint, setShowHint] = createSignal(false);
  let hintTimer: number | null = null;
  /** Wall-clock ms when the user pressed down. Used to gate the
   *  `pointerup` / `pointerleave` / `pointercancel` branches. */
  let pressedAtMs: number | null = null;

  const ensureSessionId = (): string => {
    if (sessionId === null) {
      sessionId = makeSessionId();
    }
    return sessionId;
  };

  const cancelHintTimer = (): void => {
    if (hintTimer !== null) {
      window.clearTimeout(hintTimer);
      hintTimer = null;
    }
  };

  const onPointerDown = (): void => {
    if (pressed) return;
    pressed = true;
    pressedAtMs = Date.now();
    setShowHint(false);
    cancelHintTimer();
    hintTimer = window.setTimeout(() => {
      hintTimer = null;
      setShowHint(true);
    }, HOLD_NOTICE_MS);
    // Start immediately — same as before. The release handler
    // decides whether to stop only (hold) or stop + open panel
    // (fast tap) using `isHoldLongEnough()`. Immediate start keeps
    // the 2026-10-19 regression test valid.
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

  /** Sub-threshold release on `pointerleave` / `pointercancel`.
   *  Mobile Chrome spuriously fires these ~10-40ms after
   *  `pointerdown`. We must NOT honour them — only the eventual
   *  `pointerup` decides what to do. */
  const onSpuriousLeave = (): void => {
    if (!pressed) return;
    if (!isHoldLongEnough()) return;
    // Past the threshold and we still got a leave — treat as a real
    // release (the user dragged the finger off). Stop the
    // orchestrator; notes stay buffered.
    pressed = false;
    pressedAtMs = null;
    cancelHintTimer();
    setShowHint(false);
    void runEffectSafely(stopWhistle());
  };

  const onPointerUp = (): void => {
    if (!pressed) return;
    const heldLongEnough = isHoldLongEnough();
    pressed = false;
    pressedAtMs = null;
    cancelHintTimer();
    setShowHint(false);
    if (heldLongEnough) {
      // Real hold-and-release: just stop the orchestrator. Notes
      // are NOT committed; the user must press «Применить» inside
      // the panel to splice them into score. This is what
      // decisions/wavecode-voice-rec-and-meter changes vs the
      // previous auto-commit-on-release path.
      //
      // The panel MUST be armed on this path too, not just on the
      // fast-tap path: `stopWhistle()` drops the whistle FSM back
      // to `idle`, and `RecordingPanel.mode` only stays visible
      // while the FSM is `arming`/`recording`/`segmenting` OR while
      // `whistlePanelArmed` holds. Without arming here a
      // hold-and-release would take the panel off screen together
      // with the notes the user just whistled — they would have to
      // whistle again, from scratch, to get them spliced.
      void runEffectSafely(stopWhistle());
      requestWhistlePanelArmed();
      return;
    }
    // Sub-threshold `pointerup` after a quick tap. The session
    // was briefly started on `pointerdown`; we stop it now and
    // open the panel in its "armed, ждёт ●REC" state. The user
    // then has to press ●REC to actually start a recording and
    // «Применить» to splice into score.
    void runEffectSafely(stopWhistle());
    requestWhistlePanelArmed();
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
      data-panel-armed={whistlePanelArmed() ? 'true' : 'false'}
      title={titleText()}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onSpuriousLeave}
      onPointerCancel={onSpuriousLeave}
      aria-label="Свист → музыка"
    >
      <WhistleIcon size={18} />
      <span class="voice-mini-fab__label" aria-hidden="true">Свист</span>
      <Show when={showHint() && (whistleState().tag === 'arming' || whistleState().tag === 'recording')}>
        {/* The instrument belongs in the chip: whistle has no selector,
         * so «слушаю…» alone left the user guessing what would come out
         * of the speakers. `whistleInstrumentLabel` reads the same
         * store signal the session was started with. */}
        <span class="voice-mini-fab__hint" aria-hidden="true">
          слушаю… · {whistleInstrumentLabel()}
        </span>
      </Show>
      <Show when={whistlePanelArmed() && whistleState().tag === 'idle'}>
        <span
          class="voice-mini-fab__hint voice-mini-fab__hint--armed"
          aria-hidden="true"
        >
          жду ●REC
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
