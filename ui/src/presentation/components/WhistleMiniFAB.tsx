import { Show, type JSX } from 'solid-js';
import { Cause, Effect, Exit } from 'effect';
import {
  whistleState,
  whistleError,
  whistleInstrumentLabel,
  whistlePanelArmed,
  startWhistle,
  stopWhistle,
  requestWhistlePanelArmed,
  ensureWhistleSessionId,
} from '../state/whistleStore';
import { micPreviewNotes } from '../state/micStore';
import { WhistleIcon } from '../icons';
import { consoleStore } from './consoleStore';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import { primeMicAudioContext } from '~/infrastructure/audio/micAudioContext';

/**
 * WhistleMiniFAB — whistle-to-score control.
 *
 * One gesture, one meaning: a press toggles the recording.
 *
 *   press → the whistle starts, the button turns into a REC button
 *           (red dot, «REC» chip) and the panel shows the take.
 *   press → the take pauses. The notes stay in the buffer, the panel
 *           stays open with «Применить», and the next press
 *           CONTINUES the same take — the notes whistled so far are
 *           not thrown away.
 *
 * Why the press-and-hold gesture is gone
 * -------------------------------------
 * The old contract was "hold the button and whistle; release to
 * stop". It fought the user on two fronts: a hold cannot express
 * "keep recording after I let go", and every note had to fit inside
 * one grip. The toggle matches the voice button (one rule for the
 * whole cluster: tap to start, tap to stop) and gives the whistle
 * the same pause/resume semantics the voice take already had.
 *
 * What the pause keeps
 * --------------------
 * `stopWhistle` releases the mic but leaves the segmenter's buffer
 * alone — the notes stay in `micPreviewNotes`. The next start resumes
 * with `keepBufferedNotes`, so the segmenter is not wiped by the mic
 * restart. «Применить» in the panel splices the WHOLE buffer, not
 * just the last leg.
 */
export function WhistleMiniFAB(): JSX.Element {
  const isRecording = (): boolean => {
    const tag = whistleState().tag;
    return tag === 'arming' || tag === 'recording';
  };

  const onToggle = (): void => {
    if (isRecording()) {
      // Pause. The notes stay buffered, the panel stays on screen
      // (the armed flag) so «Применить» remains reachable, and the
      // next press continues the take.
      void runEffectSafely(stopWhistle());
      requestWhistlePanelArmed();
      return;
    }
    // The mic AudioContext has to be created AND started inside this
    // click — on iOS a context created later (after the permission
    // prompt) stays suspended and hears nothing. See
    // `micAudioContext.ts`.
    primeMicAudioContext();
    void runEffectSafely(
      startWhistle({ sessionId: ensureWhistleSessionId() }),
    );
  };

  const titleText = (): string => {
    const err = whistleError();
    if (err !== null) return err;
    return isRecording()
      ? 'Остановить запись свиста'
      : 'Насвисти мелодию (нажми, чтобы записать; нажми ещё раз, чтобы остановить)';
  };

  const pausedHint = (): string => {
    const count = micPreviewNotes().length;
    return count > 0
      ? `на паузе · ${count} нот`
      : 'на паузе';
  };

  return (
    <button
      type="button"
      class="voice-mini-fab voice-mini-fab--whistle"
      data-state={whistleState().tag}
      data-rec-state={isRecording() ? 'on' : 'off'}
      data-panel-armed={whistlePanelArmed() ? 'true' : 'false'}
      aria-pressed={isRecording() ? 'true' : 'false'}
      title={titleText()}
      onClick={onToggle}
      aria-label={isRecording() ? 'Остановить запись свиста' : 'Начать запись свиста'}
    >
      <Show
        when={isRecording()}
        fallback={<WhistleIcon size={18} />}
      >
        {/* While recording the button IS the REC button: the whistle
         * glyph is replaced by the blinking dot. */}
        <span class="voice-mini-fab__rec-dot" aria-hidden="true" />
      </Show>
      <span class="voice-mini-fab__label" aria-hidden="true">
        {isRecording() ? 'REC' : 'Свист'}
      </span>
      <Show when={isRecording()}>
        {/* The instrument belongs in the chip: whistle has no selector,
         * so «слушаю…» alone left the user guessing what would come out
         * of the speakers. `whistleInstrumentLabel` reads the same
         * store signal the session was started with. */}
        <span class="voice-mini-fab__hint" aria-hidden="true">
          слушаю… · {whistleInstrumentLabel()}
        </span>
      </Show>
      <Show when={whistlePanelArmed() && !isRecording()}>
        <span
          class="voice-mini-fab__hint voice-mini-fab__hint--armed"
          aria-hidden="true"
        >
          {pausedHint()}
        </span>
      </Show>
    </button>
  );
}

/**
 * Run a possibly-failing Effect with a user-facing toast on failure.
 *
 * `runPromiseExit` + `Cause.squash` instead of `runPromise`: the
 * latter rejects with the runtime's `FiberFailure` wrapper, whose
 * `_tag` is not 'MicBusy' — the typed error never reached the
 * formatter and the toast showed the raw JSON of the error object.
 */
const runEffectSafely = async (
  eff: Effect.Effect<unknown, unknown, never>,
): Promise<void> => {
  const exit = await Effect.runPromiseExit(eff as Effect.Effect<unknown, never, never>);
  if (Exit.isSuccess(exit)) return;
  const err = Cause.squash(exit.cause);
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
};
