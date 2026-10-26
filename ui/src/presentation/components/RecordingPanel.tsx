import { Show, For, createMemo, createSignal, type JSX } from 'solid-js';
import {
  voiceAIState,
  voiceAITranscript,
  voiceAIElapsedSec,
  voiceAIFlushing,
  voiceAIRmsLevel,
  cancelVoiceAIReview,
  sendVoiceAIReview,
  dismissVoiceAI,
  discardVoiceAITake,
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
import { noteNumberToName } from '~/domain/music/notes';
import { MELODIC_SOUNDS } from '~/domain/sounds';
import { consoleStore } from './consoleStore';

/**
 * RecordingPanel — bottom-anchored status panel that surfaces the
 * state of whichever voice input is currently active:
 *
 *   - `voice-ai`  — an active voice-AI session. Shows the live
 *                   transcript OR the «записываю… N с» counter
 *                   (server STT needs ~16 s before the first interim
 *                   lands; see `decisions/wavecode-voice-live-transcript`).
 *                   On the server path a live RMS bar makes the mic
 *                   activity visible. After the take stops, the same
 *                   panel switches to the review form (editable
 *                   recognised text + «→ В ИИ»).
 *   - `whistle`   — an active whistle session OR buffered notes
 *                   awaiting apply.
 *   - `hidden`    — no panel.
 *
 * The whistle wins over voice-AI (the mic mutex should prevent them
 * running simultaneously; this is a tiebreaker for transient state).
 *
 * Two buttons live in the panel:
 *
 *   - «Удалить» — deletes the RECORDED AUDIO and keeps the text.
 *     For the whistle that means dropping the buffered notes (the
 *     panel stays open); for the voice it means ending the take
 *     without uploading it, so whatever was already recognised stays
 *     on screen. See `decisions/wavecode-voice-fab-toggle-rec`.
 *   - «Очистить текст» — a small button next to the recognised-text
 *     field that empties it. The «→ В ИИ» button goes disabled with
 *     it, so an emptied field can never send an empty instruction.
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
 * The head ✕ always closes the panel and discards the take.
 *
 * It used to call `stopVoiceAI()`, which dispatches `pause` — and
 * since `mode` treats `paused` as a visible state, the panel stayed
 * on screen showing «на паузе» instead of going away. The button
 * is labelled «закрыть», so it must close: `dismiss` is the FSM
 * event that returns any active state to `idle`, and the mic
 * channel has to be released too, which is what `stopVoiceAI`
 * does — so call both and let `dismiss` win the final state.
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
          aria-label={
            voiceAIState().tag === 'review'
              ? 'Отменить и не отправлять текст в ИИ'
              : 'Остановить запись'
          }
          title={
            voiceAIState().tag === 'review'
              ? 'Отменить — текст в ИИ не уйдёт'
              : 'Остановить голосовой ввод'
          }
          onClick={() => { void onClose(); }}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <Show
        when={voiceAIState().tag === 'review'}
        fallback={<VoiceAILiveBody />}
      >
        <VoiceAIReviewBody />
      </Show>
    </>
  );
};

/**
 * Live body — the arming/listening/transcribing/requesting/applying/
 * errored states. Shows interim text when STT has it, falls back to
 * the «записываю… N с» counter on silence (server STT needs ~16 s for
 * the first interim — see `decisions/wavecode-voice-live-transcript`).
 *
 * The RMS meter is rendered ONLY when `voiceAIRmsLevel()` is non-null,
 * which is the case when our code owns the mic (server path). On the
 * Web Speech path Chrome keeps the mic to itself and there is no
 * analysable stream to meter — pretending we have one would be
 * dishonest (see `decisions/wavecode-voice-rec-and-meter` outcome
 * `meter-availability-is-server-only`).
 */
const VoiceAILiveBody = (): JSX.Element => {
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
  return (
    <div class="voice-recording-panel__body voice-recording-panel__body--live">
      <Show
        when={voiceAIState().tag !== 'errored'}
        fallback={
          <span class="voice-recording-panel__error">
            {(() => {
              const s = voiceAIState();
              return s.tag === 'errored' ? s.error : 'Ошибка голосового ввода';
            })()}
          </span>
        }
      >
        <span class="voice-recording-panel__transcript">
          {voiceAITranscript().interim
            || voiceAITranscript().final
            || (voiceAIState().tag === 'applying' ? 'применяю правку…'
              : voiceAIState().tag === 'requesting' ? 'жду ответ ИИ…'
              : voiceAIState().tag === 'paused'
                ? 'на паузе · нажмите кнопку ещё раз, чтобы продолжить'
              : voiceAIState().tag === 'arming'
                ? 'готовлю микрофон…'
              : (voiceAIState().tag === 'listening')
                ? (voiceAIFlushing()
                  // Button released, take is being uploaded. The mic
                  // is already closed, so «записываю… N с» would be
                  // a lie that also looks like a hang for the ~4 s
                  // the round trip takes.
                  ? 'распознаю…'
                  : `записываю… ${voiceAIElapsedSec()} с`)
              : '…')}
        </span>
      </Show>
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
  );
};

/**
 * Review body — `review` state. Editable textarea + primary
 * «→ В ИИ» button + a small «Очистить текст» button.
 *
 * Why a local signal instead of dispatching `edit-review` on every
 * keystroke
 * ----------------------------------------------------------
 * The reducer exposes `edit-review` precisely so the buffer can be
 * re-shaped mid-review, but dispatching per keystroke would flood
 * the FSM's `Ref` and re-publish on the queue unnecessarily (the
 * reducer IS smart enough to dedupe same-text edits via reference
 * equality, but the dispatcher is still doing work). A local
 * `createSignal` initialised from the orchestrator's `editedText`
 * at mount captures the entire flow without touching the reducer:
 * the textarea is uncontrolled-style on the FSM, controlled-style
 * on the user. The orchestrator only sees the final value when
 * the user presses «→ В ИИ».
 *
 * If a future iteration wants to surface per-keystroke validation
 * (e.g., a green-vs-red hint that the LLM would refuse this text),
 * wiring `effect` to `dispatch({ type: 'edit-review', text })` is
 * a 4-line change inside `setEditText`. We deliberately defer it.
 */
const VoiceAIReviewBody = (): JSX.Element => {
  const initial = (): string => {
    const s = voiceAIState();
    return s.tag === 'review' ? s.editedText : '';
  };
  const [editText, setEditText] = createSignal<string>(initial());
  const isEmpty = (): boolean => editText().trim().length === 0;

  const onSend = async (): Promise<void> => {
    if (isEmpty()) return;
    try {
      await Effect.runPromise(sendVoiceAIReview(editText()));
    } catch {
      /* orchestrator handles error recovery */
    }
  };

  return (
    <div class="voice-recording-panel__review">
      <textarea
        class="voice-recording-panel__review-textarea"
        rows={2}
        value={editText()}
        aria-label="Распознанный текст — отредактируйте перед отправкой"
        placeholder="Говорите — текст появится здесь"
        onInput={(e) => { setEditText(e.currentTarget.value); }}
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
      <div class="voice-recording-panel__actions">
        <span class="voice-recording-panel__hint" aria-hidden="true">
          Проверьте и нажмите «→ В ИИ»
        </span>
        {/* «Очистить текст» — empties the recognised-text field.
         * The «→ В ИИ» button is disabled while the field is empty,
         * so an emptied field can never send an empty instruction. */}
        <button
          type="button"
          class="voice-recording-panel__btn voice-recording-panel__btn--clear"
          aria-label="Очистить распознанный текст"
          title="Очистить распознанный текст"
          disabled={isEmpty()}
          onClick={() => { setEditText(''); }}
        >
          Очистить текст
        </button>
        <button
          type="button"
          class="voice-recording-panel__btn voice-recording-panel__btn--primary"
          aria-label="Отправить отредактированный текст в ИИ"
          title="Отправить в ИИ (Cmd/Ctrl+Enter)"
          disabled={isEmpty()}
          onClick={() => { void onSend(); }}
        >
          <SendIcon size={12} />
          <span>→ В ИИ</span>
        </button>
      </div>
    </div>
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
