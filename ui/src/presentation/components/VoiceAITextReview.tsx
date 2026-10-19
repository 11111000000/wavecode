import { Show, createSignal, type JSX } from 'solid-js';
import { Effect } from 'effect';
import {
  voiceAIState,
  voiceAITranscript,
  sendVoiceAIReview,
  cancelVoiceAIReview,
} from '../state/voiceAIStore';
import { MicIcon, SendIcon, CloseIcon } from '../icons';

/**
 * VoiceAITextReview — panel that appears when the user pauses the
 * voice-AI session for review-and-edit before sending to the LLM.
 *
 * Triggered by the "Review" affordance in `RecordingPanel`
 * (or by tapping the VoiceAIMiniFAB while the session is active).
 * The orchestrator's `enterReview` stops the STT stream and
 * snapshots the transcript into `review.editedText` (which seeds
 * the editable buffer).
 *
 * UX
 * --
 *   ┌───────────────────────────────────────────────┐
 *   │ 🎙️ Проверь и отправь                          │
 *   │ ┌─────────────────────────────────────────┐   │
 *   │ │ editable textarea, seeded with final    │   │
 *   │ │ transcript text                          │   │
 *   │ └─────────────────────────────────────────┘   │
 *   │ [✕ cancel] [▷ record more] [↑ send to AI]    │
 *   └───────────────────────────────────────────────┘
 *
 * The text is an `<textarea>` (not a contentEditable div) so the
 * native autocorrect/spellcheck/IME pipeline works the way the
 * user expects on mobile. Tab/enter inside the textarea are text
 * keys; the modal-level hotkeys are owned by the parent's
 * `useKeyboardShortcuts`.
 *
 * Why it's a separate component (not just folded into
 * RecordingPanel)
 * -----------------------------------------------------------------------
 * `RecordingPanel` is the always-on live-status card
 * with a fixed layout (head + body + actions); the review state needs
 * a much richer layout (textarea + 3 actions) and longer-lived focus.
 * Splitting them keeps both readable and lets us polish the panel
 * separately.
 */

const runEffectSafely = async (
  eff: Effect.Effect<unknown, unknown, never>,
): Promise<void> => {
  try {
    await Effect.runPromise(eff as never);
  } catch {
    /* recover path lives in the orchestrator (toast on error); we
       intentionally swallow here — the modal closes itself on
       success, and stays open on failure, so there's nothing for the
       view to do besides not crash. */
  }
};

export function VoiceAITextReview(): JSX.Element {
  // Local editable buffer; seeded from the FSM's `editedText` on
  // first transition into review. We re-seed when the FSM's
  // `editedText` reference changes (e.g. after re-entering review
  // for a fresh session) and ignore typing-driven mid-edit changes.
  const [draft, setDraft] = createSignal('');
  const [seeded, setSeeded] = createSignal(false);

  const seedIfNeeded = (): void => {
    const s = voiceAIState();
    if (s.tag !== 'review') return;
    if (!seeded()) {
      setDraft(s.editedText);
      setSeeded(true);
    }
  };

  // Reset the seeded flag when we leave review so the next entry
  // re-seeds.
  const onLeave = (tag: string): void => {
    if (tag !== 'review') setSeeded(false);
  };

  return (
    <Show
      when={(() => {
        const s = voiceAIState();
        onLeave(s.tag);
        seedIfNeeded();
        return s.tag === 'review';
      })()}
    >
      <div
        class="voice-review-panel"
        data-state={voiceAIState().tag}
        role="dialog"
        aria-modal="true"
        aria-label="Проверь и отправь"
      >
        <header class="voice-review-panel__head">
          <span class="voice-review-panel__icon" aria-hidden="true">
            <MicIcon size={16} />
          </span>
          <h2 class="voice-review-panel__title">Проверь и отправь</h2>
          <button
            type="button"
            class="voice-review-panel__close"
            aria-label="Закрыть"
            onClick={() => { void runEffectSafely(cancelVoiceAIReview()); }}
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <textarea
          class="voice-review-panel__textarea"
          value={draft()}
          spellcheck={true}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="sentences"
          rows={4}
          aria-label="Текст для отправки в ИИ"
          placeholder="Отредактируй, если STT ошибся, и нажми «Отправить»"
          onInput={(e) => setDraft(e.currentTarget.value)}
        />

        <Show when={voiceAITranscript().interim}>
          <p class="voice-review-panel__interim" aria-live="polite">
            interim: {voiceAITranscript().interim}
          </p>
        </Show>

        <footer class="voice-review-panel__actions">
          <button
            type="button"
            class="voice-review-panel__btn voice-review-panel__btn--ghost"
            onClick={() => { void runEffectSafely(cancelVoiceAIReview()); }}
            title="Отменить dictation и вернуться к редактору"
          >
            <CloseIcon size={14} />
            <span>Отменить</span>
          </button>

          <button
            type="button"
            class="voice-review-panel__btn voice-review-panel__btn--secondary"
            onClick={() => {
              // Закрываем review-панель, микрофон освобождается.
              // Пользователь снова нажмёт на VoiceAIMiniFAB чтобы
              // начать новый dictation — это самое предсказуемое
              // поведение (без скрытого магического «продолжения»
              // буфера).  Если потом понадобится кнопка «продолжить
              // с того же места» — добавим orchestrator
              // `resumeFromReview()` отдельным шагом.
              setSeeded(false);
              void runEffectSafely(cancelVoiceAIReview());
            }}
            title="Отменить редактирование и вернуться к редактору"
          >
            <CloseIcon size={14} />
            <span>Закрыть</span>
          </button>

          <button
            type="button"
            class="voice-review-panel__btn voice-review-panel__btn--primary"
            disabled={draft().trim().length === 0}
            onClick={() => {
              const text = draft().trim();
              if (text.length === 0) return;
              void runEffectSafely(sendVoiceAIReview(text));
            }}
            title="Отправить отредактированный текст в ИИ"
          >
            <SendIcon size={14} />
            <span>Отправить в ИИ</span>
          </button>
        </footer>
      </div>
    </Show>
  );
}
