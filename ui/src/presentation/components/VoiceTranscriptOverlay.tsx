import { Show as _Show, type JSX } from 'solid-js';
import { Effect } from 'effect';
import {
  voiceAIState,
  voiceAITranscript,
  enterVoiceAIReview,
} from '../state/voiceAIStore';

/**
 * VoiceTranscriptOverlay — bottom-center chip with the live
 * transcript while voice-AI is active (or errored).
 *
 *   - `listening` / `transcribing` → 🎙️ слышу: <interim|final>
 *   - `applying` / `requesting`    → 🎙️ применяю правку
 *   - `errored`                    → ⚠ <error message>
 *   - everything else              → hidden
 *
 * Two call-to-action affordances are now attached to the overlay:
 *   - "Открыть для проверки" — appears while the FSM is in any
 *     active state (`listening` / `transcribing`). Tapping it
 *     dispatches `enter-review` on the orchestrator, freezing
 *     the STT stream and surfacing the buffer in
 *     `VoiceAITextReview` for edit-then-send. This is the
 *     opt-in branch — auto-commit (per final chunk) is still
 *     the default behaviour.
 *   - "Приостановить" — same chip while `listening`/`transcribing`
 *     (paired with the review button) so the user can manually
 *     stop without entering review.
 */
export function VoiceTranscriptOverlay(): JSX.Element {
  const isActive = (): boolean => {
    const tag = voiceAIState().tag;
    return tag === 'listening'
      || tag === 'transcribing'
      || tag === 'requesting'
      || tag === 'applying';
  };

  const onEnterReview = async (): Promise<void> => {
    try {
      await Effect.runPromise(enterVoiceAIReview());
    } catch {
      /* recover lives in the orchestrator; we don't crash the overlay. */
    }
  };

  return (
    <_Show when={(() => {
      const tag = voiceAIState().tag;
      return tag === 'listening'
        || tag === 'transcribing'
        || tag === 'requesting'
        || tag === 'applying'
        || tag === 'errored';
    })()}>
      <div
        class="voice-transcript-overlay"
        data-state={voiceAIState().tag}
      >
        <_Show
          when={voiceAIState().tag !== 'errored'}
          fallback={
            <>
              <span class="voice-transcript-overlay__icon">⚠</span>
              <span class="voice-transcript-overlay__error">
                {(() => {
                  const s = voiceAIState();
                  return s.tag === 'errored'
                    ? s.error
                    : 'Ошибка голосового ввода';
                })()}
              </span>
            </>
          }
        >
          <span class="voice-transcript-overlay__icon">🎙️</span>
          <span class="voice-transcript-overlay__text">
            {voiceAITranscript().interim
              || voiceAITranscript().final
              || (voiceAIState().tag === 'applying' ? 'применяю правку…'
                : voiceAIState().tag === 'requesting' ? 'жду ответ ИИ…'
                : '…')}
          </span>
        </_Show>
        <_Show when={isActive()}>
          <button
            type="button"
            class="voice-transcript-overlay__btn"
            aria-label="Открыть для проверки"
            title="Остановить запись и показать текст для редактирования перед отправкой в ИИ"
            onClick={() => { void onEnterReview(); }}
          >
            Проверить ▸
          </button>
        </_Show>
      </div>
    </_Show>
  );
}
