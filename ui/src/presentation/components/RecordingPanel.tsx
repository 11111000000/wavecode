import { Show, createMemo, type JSX } from 'solid-js';
import {
  voiceAIState,
  voiceAIElapsedSec,
  voiceAIFlushing,
  voiceAIRmsLevel,
  voiceAIDraft,
  setVoiceAIDraftText,
  cancelVoiceAIReview,
  cancelVoiceAISend,
  sendVoiceAIReview,
  dismissVoiceAI,
  discardVoiceAITake,
} from '../state/voiceAIStore';
import { CloseIcon, SendIcon, TrashIcon } from '../icons';
import { Effect } from 'effect';
import { consoleStore } from './consoleStore';

/**
 * RecordingPanel — the voice dock.
 *
 * ONE dock, ONE status line, ONE action.
 * ---------------------------------------
 * The panel used to be a floating box with a header of its own: a mic
 * icon, the title «Голос», an «⚠ ошибка» pill, a trash button and a
 * close button — and then a second red ●REC button that did exactly
 * what the mini-FAB next to it did. Two red dots on screen at once,
 * both meaning «recording», neither obviously the real one.
 *
 * The dock is now three rows and nothing else:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ ⟳ Записываю… 7 с           ▓▓▓▓░░░░   🗑  ✕ │
 *   ├──────────────────────────────────────────────┤
 *   │ распознанный текст…                          │
 *   │                                              │
 *   │                                  [ → В ИИ ]  │
 *   └──────────────────────────────────────────────┘
 *
 *   row 1 — what the machine is doing. The spinner appears only
 *           when the machine is the one working; the level bar
 *           appears only while the mic is open. The trash appears
 *           only while there is still audio to throw away.
 *   row 2 — the composer. Always present, always editable, in
 *           EVERY state of the machine. It is the transcript while
 *           the recogniser talks and the editable text afterwards.
 *   row 3 — the one action that follows the text.
 *
 * What is NOT here and why
 * -------------------------
 *   - The header row. «Голос» as a title is noise: the user pressed
 *     the mic button and knows what it does. The error pill said
 *     what the status line already says.
 *   - The ●REC button. The mini-FAB IS the record control — one
 *     gesture, one meaning. A second one next to it was a
 *     duplicate affordance reachable by nobody.
 *   - The «Очистить» button. It is a TEXT action in a VOICE dock,
 *     and the textarea it clears already has a native select-and-
 *     delete. Two text actions in a row that has one.
 *
 * The confirm-before-send contract stays: nothing reaches the LLM
 * until the user presses «→ В ИИ» (see
 * `decisions/wavecode-voice-confirm-before-send`).
 */

export function RecordingPanel(): JSX.Element {
  const visible = createMemo<boolean>(() => {
    const v = voiceAIState().tag;
    return (
      v === 'arming'
      || v === 'listening'
      || v === 'transcribing'
      || v === 'requesting'
      || v === 'applying'
      || v === 'errored'
      || v === 'paused'
      || v === 'review'
      || v === 'sent'
    );
  });

  return (
    <Show when={visible()}>
      <div
        class="voice-recording-panel"
        data-mode="voice-ai"
        data-state={voiceAIState().tag}
        role="status"
        aria-live="polite"
      >
        <VoiceAIDock />
      </div>
    </Show>
  );
}

/* ── the dock ──────────────────────────────────────────────────────── */

const VoiceAIDock = (): JSX.Element => {
  const onClose = async (): Promise<void> => {
    try {
      if (voiceAIState().tag === 'review') {
        await Effect.runPromise(cancelVoiceAIReview());
        return;
      }
      await Effect.runPromise(dismissVoiceAI());
    } catch {
      /* orchestrator handles error recovery */
    }
  };

  /**
   * «Удалить» — delete the audio, keep the text.
   *
   * Only offered while a take is actually being captured: once the
   * take has been stopped the audio is already on its way to the
   * recogniser, and a button that pretends to recall it would be
   * lying. The flush window is excluded for the same reason.
   */
  const canDiscard = (): boolean => {
    const tag = voiceAIState().tag;
    if (tag === 'arming') return true;
    return tag === 'listening' && !voiceAIFlushing();
  };

  const onDiscard = async (): Promise<void> => {
    try {
      await Effect.runPromise(discardVoiceAITake());
    } catch {
      /* the orchestrator surfaces the error */
    }
  };

  /** Is the request on the wire? */
  const sendInFlight = (): boolean => {
    const tag = voiceAIState().tag;
    return tag === 'requesting' || tag === 'applying';
  };

  /** Is the machine working on something the user is waiting for? */
  const isBusy = (): boolean =>
    sendInFlight()
    || voiceAIState().tag === 'transcribing'
    || (voiceAIState().tag === 'listening' && voiceAIFlushing());

  const isEmpty = (): boolean => voiceAIDraft().trim().length === 0;

  /**
   * Can the composer be sent right now?
   *
   * It can, in more states than it used to. The button used to be
   * enabled whenever the field held text and then quietly did
   * nothing outside `review` / `sent` — the press vanished. Now the
   * press is honoured everywhere it can be: from a live take it
   * stops the take and sends the transcript the moment it lands.
   */
  const canSend = (): boolean => {
    const tag = voiceAIState().tag;
    if (tag === 'errored' || tag === 'idle') return false;
    if (sendInFlight()) return false;
    return true;
  };

  const onSend = async (): Promise<void> => {
    if (isEmpty()) return;
    try {
      await Effect.runPromise(sendVoiceAIReview(voiceAIDraft()));
    } catch {
      /* orchestrator handles error recovery */
    }
  };

  const onCancelSend = async (): Promise<void> => {
    try {
      await Effect.runPromise(cancelVoiceAISend());
      consoleStore.pushToast({
        severity: 'info',
        title: 'Голос',
        body: 'Отправка отменена — текст остался в поле',
      });
    } catch {
      /* ditto */
    }
  };

  /**
   * What the machine is doing, in the user's words.
   *
   * This line is the whole answer to «ушло не ушло, крутится или
   * нет». Every state the session can be in has exactly one phrase,
   * and none of them is a lie: the panel never says «записываю» when
   * the mic is closed, and never says nothing at all.
   */
  const statusText = (): string => {
    const tag = voiceAIState().tag;
    switch (tag) {
      case 'arming':
        return 'Готовлю микрофон…';
      case 'listening':
        // The button was released, the take is uploading: the mic is
        // already closed, so «записываю… N с» would be a lie that
        // also looks like a hang for the ~16 s the round trip takes.
        return voiceAIFlushing()
          ? 'Распознаю…'
          : `Записываю… ${voiceAIElapsedSec()} с`;
      case 'transcribing':
        return 'Распознаю…';
      case 'requesting':
        return 'Отправляю в ИИ…';
      case 'applying':
        return 'Применяю правку…';
      case 'review':
        return 'Текст готов — правьте и отправляйте';
      case 'sent':
        return '✓ Правка применена — можно отправить заново';
      case 'paused':
        return 'Запись на паузе — нажмите кнопку микрофона, чтобы продолжить';
      case 'errored': {
        const s = voiceAIState();
        return s.tag === 'errored' ? s.error : 'Ошибка голосового ввода';
      }
      default:
        return '…';
    }
  };

  const meterWidthPct = (): number => {
    const lvl = voiceAIRmsLevel();
    if (lvl === null) return 0;
    // Same `* 400` calibration as the whistle panel's
    // `__rms-fill`. The whisper speech gate (SPEECH_RMS_THRESHOLD =
    // 0.02) flips at width = 8%, a calm voice at 30 cm sits around
    // 0.05-0.10 → 20-40%, and a loud speech event briefly hits
    // 80-100%. A user who sees the bar cross "20%" can be
    // confident the recogniser is hearing speech.
    return Math.min(100, Math.round(lvl * 400));
  };

  const closeLabel = (): string =>
    voiceAIState().tag === 'review'
      ? 'Отменить и не отправлять текст в ИИ'
      : 'Отменить запись и закрыть панель';

  const closeTitle = (): string =>
    voiceAIState().tag === 'review'
      ? 'Отменить — текст в ИИ не уйдёт'
      : 'Отменить запись и закрыть панель';

  return (
    <>
      <div class="voice-recording-panel__status">
        <Show when={isBusy()}>
          <span class="voice-recording-panel__spinner" aria-hidden="true" />
        </Show>
        <span class="voice-recording-panel__status-text">{statusText()}</span>
        <Show when={voiceAIRmsLevel() !== null}>
          <span
            class="voice-recording-panel__rms"
            aria-label="Громкость голоса"
            aria-hidden="true"
          >
            <span
              class="voice-recording-panel__rms-fill"
              style={{ width: `${meterWidthPct()}%` }}
            />
          </span>
        </Show>
        <Show when={canDiscard()}>
          <button
            type="button"
            class="voice-recording-panel__delete"
            aria-label="Удалить запись"
            title="Удалить запись (текст останется)"
            onClick={() => { void onDiscard(); }}
          >
            <TrashIcon size={13} />
          </button>
        </Show>
        <button
          type="button"
          class="voice-recording-panel__close"
          aria-label={closeLabel()}
          title={closeTitle()}
          onClick={() => { void onClose(); }}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div class="voice-recording-panel__composer">
        <textarea
          class="voice-recording-panel__review-textarea"
          rows={2}
          value={voiceAIDraft()}
          aria-label="Распознанный текст — его можно править перед отправкой"
          placeholder="Говорите — текст появится здесь"
          onInput={(e) => { setVoiceAIDraftText(e.currentTarget.value); }}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter is the keyboard equivalent of «→ В ИИ».
            // Plain Enter inserts a newline (textarea default);
            // holding the modifier is the only way to send without
            // the mouse.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void onSend();
            }
          }}
        />
      </div>

      <div class="voice-recording-panel__actions">
        <Show
          when={sendInFlight()}
          fallback={
            <Show when={canSend()}>
              <button
                type="button"
                class="voice-recording-panel__btn voice-recording-panel__btn--primary"
                aria-label="Отправить текст в ИИ"
                title="Отправить в ИИ (Cmd/Ctrl+Enter)"
                disabled={isEmpty()}
                onClick={() => { void onSend(); }}
              >
                <SendIcon size={12} />
                <span>→ В ИИ</span>
              </button>
            </Show>
          }
        >
          <button
            type="button"
            class="voice-recording-panel__btn voice-recording-panel__btn--cancel"
            aria-label="Отменить отправку в ИИ"
            title="Отменить отправку — текст останется в поле"
            onClick={() => { void onCancelSend(); }}
          >
            <CloseIcon size={12} />
            <span>Отменить отправку</span>
          </button>
        </Show>
      </div>
    </>
  );
};
