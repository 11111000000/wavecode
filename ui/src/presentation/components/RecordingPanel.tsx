import { Show, For, createMemo, type JSX } from 'solid-js';
import {
  voiceAIState,
  voiceAIElapsedSec,
  voiceAIFlushing,
  voiceAIRmsLevel,
  voiceAIDraft,
  setVoiceAIDraftText,
  clearVoiceAIDraft,
  cancelVoiceAIReview,
  cancelVoiceAISend,
  sendVoiceAIReview,
  dismissVoiceAI,
  discardVoiceAITake,
  startVoiceAI,
  stopVoiceAI,
} from '../state/voiceAIStore';
import {
  whistleState,
  whistleError,
  whistleInstrument,
  whistlePanelArmed,
  startWhistle,
  commitWhistle,
  stopWhistle,
  clearWhistlePanelArmed,
  discardWhistleTake,
  chooseWhistleInstrument,
  ensureWhistleSessionId,
} from '../state/whistleStore';
import {
  micPreviewNotes,
  micCurrentHz,
  micCurrentRms,
  clearPreview,
} from '../state/micStore';
import { MicIcon, WhistleIcon, CloseIcon, SendIcon, TrashIcon } from '../icons';
import { Effect } from 'effect';
import type { AudioNote } from '~/domain/audio/micCapture';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import type { SttUnsupportedError } from '~/application/voice/STTEngine';
import { noteNumberToName } from '~/domain/music/notes';
import { MELODIC_SOUNDS } from '~/domain/sounds';
import { consoleStore } from './consoleStore';

/**
 * RecordingPanel — bottom-anchored status panel that surfaces the
 * state of whichever voice input is currently active:
 *
 *   - `voice-ai`  — an active voice-AI session. The panel is a
 *                   COMPOSER: one editable field that holds the
 *                   recognised text, a status line that says what
 *                   the machine is doing right now, and the three
 *                   controls that matter — ●REC, «→ В ИИ» and ✕.
 *   - `whistle`   — an active whistle session OR buffered notes
 *                   awaiting apply.
 *   - `hidden`    — no panel.
 *
 * The whistle wins over voice-AI (the mic mutex should prevent them
 * running simultaneously; this is a tiebreaker for transient state).
 *
 * The voice-AI body used to have two faces: a read-only live
 * transcript while recording, and an editable form that only existed
 * in the `review` state. That split is what the user hit as
 * «текст не редактируется», «непонятно, ушло или нет» and «отменить
 * непонятно как» — see `decisions/wavecode-voice-composer-ux`. The
 * composer is ONE face: the field is always there, always editable,
 * and the status line says plainly whether the app is recording,
 * recognising, sending, done or broken.
 *
 * Three buttons live in the panel:
 *
 *   - «Удалить» — deletes the RECORDED AUDIO and keeps the text.
 *     For the whistle that means dropping the buffered notes (the
 *     panel stays open); for the voice it means ending the take
 *     without uploading it, so whatever was already recognised stays
 *     on screen. See `decisions/wavecode-voice-fab-toggle-rec`.
 *   - «● REC» — starts a take, and stops the running one. The panel
 *     is self-sufficient: the mini-FAB is an entry point, not the
 *     only way to drive the recording.
 *   - «→ В ИИ» — sends the text. While the request is on the wire
 *     the same button becomes «Отменить отправку», so the user can
 *     pull the plug and send again.
 *
 * Why the panel has no "armed" mode any more
 * ------------------------------------------
 * The panel used to open in an "вооружена, ждёт ●REC" state: a tap
 * on the mini-FAB only armed the panel and the user had to press
 * ●REC inside it. The mini-FABs are toggle buttons now — the FAB
 * IS the REC control — so a second way to start the same take would
 * have been a duplicate affordance reachable by nobody.
 */
type Mode = 'voice-ai' | 'whistle' | 'hidden';

export function RecordingPanel(): JSX.Element {
  const mode = createMemo<Mode>(() => {
    const w = whistleState().tag;
    if (w === 'arming' || w === 'recording' || w === 'segmenting') {
      return 'whistle';
    }
    if (whistlePanelArmed()) return 'whistle';
    const v = voiceAIState().tag;
    if (
      v === 'arming'
      || v === 'listening'
      || v === 'transcribing'
      || v === 'requesting'
      || v === 'applying'
      || v === 'errored'
      || v === 'paused'
      || v === 'review'
      || v === 'sent'
    ) {
      return 'voice-ai';
    }
    return 'hidden';
  });

  return (
    <Show when={mode() !== 'hidden'}>
      <div
        class="voice-recording-panel"
        data-mode={mode()}
        data-state={mode() === 'voice-ai'
          ? voiceAIState().tag
          : whistleState().tag}
        role="status"
        aria-live="polite"
      >
        <Show when={mode() === 'voice-ai'}>
          <VoiceAIBody />
        </Show>
        <Show when={mode() === 'whistle'}>
          <WhistleBody />
        </Show>
      </div>
    </Show>
  );
}

/* ── voice-AI body ─────────────────────────────────────────────────── */

/**
 * The composer.
 *
 * The field is ALWAYS rendered and ALWAYS editable — while the mic
 * is open, while the recogniser is thinking, while the LLM is
 * answering and after the edit was applied. The text the recogniser
 * produces lands in the field as soon as it exists, and the user's
 * edits stick (the store's dirty flag stops the recogniser from
 * overwriting them).
 *
 * The head ✕ closes the panel and abandons the take. The ●REC button
 * stops the recording but keeps the text. Those are different things
 * and they have different buttons, because the old panel had ONE ✕
 * that meant "stop" in some states and "abort" in others and "close"
 * in the rest — the user could not tell which one they were about to
 * press.
 */
const VoiceAIBody = (): JSX.Element => {
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

  /**
   * Is the mic hot RIGHT NOW?
   *
   * The flush window counts as "not recording": the finger is off
   * the button, the audio is already on its way to the recogniser.
   * Showing «Стоп» there would offer to stop something that is
   * already stopped, and pressing ●REC would be the only sensible
   * thing to do (start the next take — the orchestrator waits the
   * flush out).
   */
  const isRecording = (): boolean =>
    !voiceAIFlushing()
    && (voiceAIState().tag === 'arming' || voiceAIState().tag === 'listening');

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

  const onRec = async (): Promise<void> => {
    try {
      if (isRecording()) {
        // Stop the take but keep the text: the audio is flushed to
        // the recogniser and the transcript lands in the field.
        await Effect.runPromise(stopVoiceAI());
        return;
      }
      // Start (or continue) a take. A press during the flush window
      // is NOT swallowed: the orchestrator waits the drain out and
      // then opens the mic. The old mini-FAB ignored that press
      // entirely, which is exactly the «повторная запись не
      // работает» report.
      await Effect.runPromise(
        startVoiceAI({ mode: 'continuous', lang: 'ru-RU' }).pipe(
          Effect.catchAll((err: MicBusyError | SttUnsupportedError) => Effect.sync(() => {
            consoleStore.pushToast({
              severity: 'warn',
              title: 'Голос',
              body: err._tag === 'MicBusy'
                ? 'Микрофон занят другим режимом ('
                  + err.conflictingChannel.owner.kind + ')'
                : err.message,
            });
          })),
        ),
      );
    } catch {
      /* ditto */
    }
  };

  const isEmpty = (): boolean => voiceAIDraft().trim().length === 0;

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
        return 'Запись на паузе — нажмите ● REC, чтобы продолжить';
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
      <div class="voice-recording-panel__head">
        <span
          class="voice-recording-panel__icon voice-recording-panel__icon--ai"
          aria-hidden="true"
        >
          <MicIcon size={16} />
        </span>
        <span class="voice-recording-panel__title">Голос</span>
        <Show when={voiceAIState().tag === 'errored'}>
          <span class="voice-recording-panel__err-pill">⚠ ошибка</span>
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
        </div>
      </div>

      <div class="voice-recording-panel__actions">
        <button
          type="button"
          class={
            isRecording()
              ? 'voice-recording-panel__rec voice-recording-panel__rec--on'
              : 'voice-recording-panel__rec voice-recording-panel__rec--off'
          }
          aria-label={isRecording() ? 'Остановить запись' : 'Начать запись'}
          aria-pressed={isRecording() ? 'true' : 'false'}
          title={
            isRecording()
              ? 'Остановить запись — текст останется в поле'
              : 'Начать запись'
          }
          data-rec-state={isRecording() ? 'on' : 'off'}
          onClick={() => { void onRec(); }}
        >
          <span class="voice-recording-panel__rec-dot" aria-hidden="true" />
          <span class="voice-recording-panel__rec-label">REC</span>
        </button>
        <button
          type="button"
          class="voice-recording-panel__btn voice-recording-panel__btn--clear"
          aria-label="Очистить распознанный текст"
          title="Очистить распознанный текст"
          disabled={isEmpty()}
          onClick={() => { clearVoiceAIDraft(); }}
        >
          Очистить
        </button>
        <Show
          when={sendInFlight()}
          fallback={
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

/* ── whistle body ──────────────────────────────────────────────────── */

const WhistleBody = (): JSX.Element => {
  const onCancel = async (): Promise<void> => {
    // Close the panel first — the flag is what keeps it on screen,
    // and the user asked to leave, not to wait for the mic release.
    clearWhistlePanelArmed();
    try {
      // The ✕ drops the buffered notes and any in-progress recording.
      await Effect.runPromise(stopWhistle());
      // `stopWhistle` republishes the closed notes into the preview
      // buffer, so the wipe has to come AFTER the stop — otherwise the
      // abandoned take would stay visible in the strip.
      clearPreview();
    } catch {
      /* ditto */
    }
  };
  const stageLabel = (): string => {
    const tag = whistleState().tag;
    switch (tag) {
      case 'arming': return 'Готовлю микрофон…';
      case 'recording': return 'Свисти — записываю';
      case 'segmenting': return 'Применяю…';
      case 'errored': return 'Ошибка';
      default: return 'Запись на паузе';
    }
  };
  const noteLabel = (notes: ReadonlyArray<AudioNote>): string => {
    if (notes.length === 0) return '';
    const last = notes[notes.length - 1]!;
    return noteNumberToName(last.midi).toLowerCase();
  };
  // Cap the visible strip at 8 notes so the panel width stays bounded
  // on mobile; older notes are still in the buffer (and get committed
  // by the orchestrator on «Применить»), they just aren't shown here.
  const PREVIEW_LIMIT = 8;
  const recentNotes = createMemo(() => micPreviewNotes().slice(-PREVIEW_LIMIT));
  const buffered = createMemo(() => micPreviewNotes().length > 0);
  const isRecording = createMemo(() => {
    const tag = whistleState().tag;
    return tag === 'arming' || tag === 'recording';
  });
  const hasNotes = createMemo(() => buffered());

  const onRec = async (): Promise<void> => {
    try {
      if (isRecording()) {
        // Toggle off: stop the orchestrator, leave the panel open
        // so the user can press «Применить» to splice the buffered
        // notes. `stopWhistle` releases the mic; the notes stay in
        // `micPreviewNotes` because that buffer is owned by
        // `micStore`, not the orchestrator.
        await Effect.runPromise(stopWhistle());
        return;
      }
      // Toggle on: start. `startWhistle` asserts the press-id from
      // the chip; we use the store's shared session id so the take
      // started by the FAB and the take stopped by the panel speak
      // the same id (the mic mutex releases by id).
      const sid = ensureWhistleSessionId();
      await Effect.runPromise(
        startWhistle({ sessionId: sid }).pipe(
          Effect.catchAll((err: MicBusyError) => Effect.sync(() => {
            consoleStore.pushToast({
              severity: 'warn',
              title: 'Свист',
              body: 'Микрофон занят другим режимом ('
                + err.conflictingChannel.owner.kind + ')',
            });
          })),
        ),
      );
    } catch {
      /* ditto */
    }
  };

  const onApply = async (): Promise<void> => {
    if (!hasNotes()) return;
    try {
      await Effect.runPromise(commitWhistle());
      clearWhistlePanelArmed();
    } catch {
      /* toast surfaces in the store */
    }
  };

  /** «Удалить» — drop the recorded audio (the buffered notes) and
   *  keep the panel open. The whistle has no transcript of its own,
   *  so "keep the text" degenerates to "keep the panel". */
  const onDelete = async (): Promise<void> => {
    try {
      await Effect.runPromise(discardWhistleTake());
    } catch {
      /* ditto */
    }
  };

  return (
    <>
      <div class="voice-recording-panel__head">
        <span
          class="voice-recording-panel__icon voice-recording-panel__icon--whistle"
          aria-hidden="true"
        >
          <WhistleIcon size={16} />
        </span>
        <span class="voice-recording-panel__title">Свист</span>
        {/* The instrument picker. A native <select> — it is the one
         * control that behaves well on a phone (the OS picker sheet)
         * and it lists ONLY sounds that superdough really has. */}
        <select
          class="voice-recording-panel__instrument"
          aria-label="Инструмент записи"
          title="Инструмент записи"
          value={whistleInstrument()}
          disabled={isRecording() || hasNotes()}
          onChange={(e) => { chooseWhistleInstrument(e.currentTarget.value); }}
        >
          <For each={MELODIC_SOUNDS}>
            {(s) => <option value={s.id}>{s.label}</option>}
          </For>
        </select>
        <Show when={whistleState().tag === 'errored'}>
          <span class="voice-recording-panel__err-pill">⚠ {whistleError() ?? 'ошибка'}</span>
        </Show>
        <Show when={hasNotes() || isRecording()}>
          <button
            type="button"
            class="voice-recording-panel__delete"
            aria-label="Удалить запись свиста"
            title="Удалить записанные ноты"
            onClick={() => { void onDelete(); }}
          >
            <TrashIcon size={13} />
          </button>
        </Show>
        <button
          type="button"
          class="voice-recording-panel__close"
          aria-label="Отменить запись свиста"
          title="Отменить запись и не вставлять ничего в score"
          onClick={() => { void onCancel(); }}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div class="voice-recording-panel__body voice-recording-panel__body--whistle">
        <span class="voice-recording-panel__stage">{stageLabel()}</span>
        <Show when={micCurrentHz() !== null && micCurrentHz()! > 0}>
          <span class="voice-recording-panel__hz">
            {Math.round(micCurrentHz()!)} Hz · {noteLabel(micPreviewNotes()) || '…'}
          </span>
        </Show>
      </div>
      <Show when={recentNotes().length > 0}>
        <div class="voice-recording-panel__strip" aria-label="Распознанные ноты">
          <For each={recentNotes()}>
            {(n) => (
              <span class="voice-recording-panel__note">
                {noteNumberToName(n.midi).toLowerCase()}
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="voice-recording-panel__actions voice-recording-panel__actions--split">
        <span class="voice-recording-panel__hint" aria-hidden="true">
          {hasNotes()
            ? 'Можно добавить ещё или применить'
            : 'Свистите — ноты появятся здесь'}
        </span>
        <button
          type="button"
          class={
            isRecording()
              ? 'voice-recording-panel__rec voice-recording-panel__rec--on'
              : 'voice-recording-panel__rec voice-recording-panel__rec--off'
          }
          aria-label={
            isRecording() ? 'Остановить запись' : 'Начать запись'
          }
          aria-pressed={isRecording() ? 'true' : 'false'}
          title={
            isRecording() ? 'Остановить запись' : 'Начать запись'
          }
          data-rec-state={isRecording() ? 'on' : 'off'}
          onClick={() => { void onRec(); }}
        >
          <span class="voice-recording-panel__rec-dot" aria-hidden="true" />
          <span class="voice-recording-panel__rec-label">REC</span>
        </button>
        <button
          type="button"
          class="voice-recording-panel__btn voice-recording-panel__btn--apply"
          aria-label="Вставить ноты в score"
          title={
            hasNotes()
              ? 'Добавить ноты в стек композиции'
              : 'Сначала запишите ноты'
          }
          disabled={!hasNotes()}
          onClick={() => { void onApply(); }}
        >
          <SendIcon size={12} />
          <span>Применить</span>
        </button>
        <span class="voice-recording-panel__count" aria-hidden="true">
          {micPreviewNotes().length} нот
        </span>
      </div>
      {/* Whistle's own RMS comes from the live mic pipeline
       * (`micCurrentRms`). Always rendered here when the panel is
       * open and recording is active; the meter plays the role of
       * "the app hears you" just as it does for voice-AI. */}
      <Show when={isRecording()}>
        <div class="voice-recording-panel__rms-row" aria-hidden="true">
          <div class="voice-recording-panel__rms">
            <div
              class="voice-recording-panel__rms-fill"
              style={{ width: `${Math.min(100, Math.round(micCurrentRms() * 400))}%` }}
            />
          </div>
        </div>
      </Show>
    </>
  );
};
