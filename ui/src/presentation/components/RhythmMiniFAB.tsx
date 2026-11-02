import { Show, type JSX } from 'solid-js';
import { Cause, Effect, Exit } from 'effect';
import {
  rhythmPhase,
  rhythmError,
  rhythmPanelArmed,
  rhythmHits,
  startRhythm,
  stopRhythm,
  ensureRhythmSessionId,
} from '../state/rhythmStore';
import { RhythmIcon } from '../icons';
import { consoleStore } from './consoleStore';
import type { MicBusyError } from '~/domain/audio/MicChannel';

/**
 * RhythmMiniFAB — tap-a-rhythm control.
 *
 * The third button of the voice cluster, next to «Голос» and
 * «Свист». It records PERCUSSION: the user knocks on the table or
 * claps into the microphone, the hits are placed on the app's step
 * grid and the result is committed into the score as a drum pattern.
 *
 * Why a separate button
 * ---------------------
 * The whistle button used to carry both: sustained pitches became
 * notes AND the percussive hits the detector saw in the same take
 * were committed next to them. But the detector fires on the
 * whistle's own ATTACK, so every phrase sprouted a stray clap — the
 * "a beat appears out of nowhere" complaint. Splitting the flows
 * removes the ambiguity: the whistle is a melody, the rhythm is a
 * groove, and each one owns its buffer.
 *
 * The gesture matches the other two buttons: tap to start, tap to
 * stop. The take can be paused and continued, and the panel stays
 * open with «Применить» until the user commits or drops it.
 */
export function RhythmMiniFAB(): JSX.Element {
  const isRecording = (): boolean => rhythmPhase() === 'recording';

  const onToggle = (): void => {
    if (isRecording()) {
      // Pause. The hits stay in the buffer, the panel stays on
      // screen (the armed flag) so «Применить» remains reachable.
      void runEffectSafely(stopRhythm());
      return;
    }
    void runEffectSafely(
      startRhythm({ sessionId: ensureRhythmSessionId() }),
    );
  };

  const titleText = (): string => {
    const err = rhythmError();
    if (err !== null) return err;
    return isRecording()
      ? 'Остановить запись ритма'
      : 'Записать ритм ударами (нажми, чтобы начать; нажми ещё раз, чтобы остановить)';
  };

  const pausedHint = (): string => {
    const count = rhythmHits().length;
    return count > 0
      ? `на паузе · ${count} ударов`
      : 'на паузе';
  };

  return (
    <button
      type="button"
      class="voice-mini-fab voice-mini-fab--rhythm"
      data-state={rhythmPhase()}
      data-rec-state={isRecording() ? 'on' : 'off'}
      data-panel-armed={rhythmPanelArmed() ? 'true' : 'false'}
      aria-pressed={isRecording() ? 'true' : 'false'}
      title={titleText()}
      onClick={onToggle}
      aria-label={isRecording() ? 'Остановить запись ритма' : 'Начать запись ритма'}
    >
      <Show
        when={isRecording()}
        fallback={<RhythmIcon size={18} />}
      >
        {/* While recording the button IS the REC button: the drum
         * glyph is replaced by the blinking dot. */}
        <span class="voice-mini-fab__rec-dot" aria-hidden="true" />
      </Show>
      <span class="voice-mini-fab__label" aria-hidden="true">
        {isRecording() ? 'REC' : 'Ритм'}
      </span>
      <Show when={isRecording()}>
        <span class="voice-mini-fab__hint" aria-hidden="true">
          слушаю удары…
        </span>
      </Show>
      <Show when={rhythmPanelArmed() && !isRecording()}>
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
 * Mirrors `WhistleMiniFAB.runEffectSafely`: `runPromiseExit` +
 * `Cause.squash` so the typed `MicBusyError` reaches the formatter
 * instead of the runtime's `FiberFailure` wrapper.
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
    title: 'Ритм',
    body: msg,
  });
};
