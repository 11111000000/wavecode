import { Show, For, createMemo, createSignal, type JSX } from 'solid-js';
import {
  voiceAIState,
  voiceAITranscript,
  voiceAIElapsedSec,
  stopVoiceAI,
  cancelVoiceAIReview,
  sendVoiceAIReview,
} from '../state/voiceAIStore';
import {
  whistleState,
  whistleError,
  whistleInstrumentLabel,
  stopWhistle,
} from '../state/whistleStore';
import {
  micPreviewNotes,
  micCurrentHz,
  micCurrentRms,
} from '../state/micStore';
import { MicIcon, WhistleIcon, CloseIcon, SendIcon } from '../icons';
import { Effect } from 'effect';
import type { AudioNote } from '~/domain/audio/micCapture';
import { noteNumberToName } from '~/domain/music/notes';

/**
 * RecordingPanel — bottom-anchored status panel that surfaces the
 * state of whichever voice input is currently active.
 *
 * Replaces the previous arrangement where:
 *   - VoiceAIMiniFAB had a tiny inline "слушаю…" chip in the button
 *     and a separate VoiceTranscriptOverlay (a chip floating above
 *     the FAB cluster);
 *   - WhistleMiniFAB had no bottom feedback at all.
 *
 * UX problems that motivated this panel:
 *   1. Two FABs side-by-side, each with their own feedback surface —
 *      users couldn't tell which one was active or what it was
 *      doing.
 *   2. Whistle had nothing at the bottom while recording, so
 *      pressing the FAB and seeing "nothing happens" was a black
 *      box. The user couldn't see whether the mic was hot, what
 *      pitch was being detected, or what notes had been segmented.
 *   3. VoiceTranscriptOverlay only fired for voice-AI, not whistle —
 *      inconsistent visual model.
 *
 * What this panel shows
 * --------------------
 * - For voice-AI:
 *   - `listening` / `transcribing`: 🎙️ + live transcript text (or the
 *     «записываю… N с» counter when no interim text has arrived —
 *     server STT can take 5-9 s for the first interim, see
 *     `decisions/wavecode-voice-live-transcript`).
 *   - `review`: 🎙️ + editable textarea seeded with the joined
 *     final transcript + a primary «→ В ИИ» button that calls
 *     `sendVoiceAIReview`. The head ✕ becomes the cancel-review
 *     affordance and drops the buffer; nothing is sent.
 *   - `requesting` / `applying`: «жду ответ ИИ…» / «применяю…».
 *   - `errored`: error pill + the error text.
 * - For whistle (arming/recording/segmenting):
 *     🎵 «Свист · <инструмент>» + last detected note name + Hz readout
 *     + a horizontal strip of recent notes ("c4 e4 g4") + RMS bar.
 *
 * Why the review form is inline
 * -----------------------------
 * The inline form replaces the previous modal-style VoiceAITextReview
 * (deleted in `decisions/wavecode-voice-live-transcript`). The whole
 * flow now lives on the same bottom panel as the live transcript —
 * the user sees their words materialize while talking, and the
 * same panel becomes the editor + send affordance when the
 * utterance finalises. Confirmation is not a separate step in
 * the visual hierarchy; it's the natural next thing the panel
 * shows. See `decisions/wavecode-voice-confirm-before-send`.
 *
 * Visibility precedence
 * ---------------------
 * If both voice-AI AND whistle happen to be active (they share a mic
 * mutex so this should be rare, but the FSM is decoupled enough to
 * allow it during transitions), whistle wins for the bottom row
 * because it's a faster, time-bounded gesture; voice-AI's review
 * state keeps the panel visible via this same component instead of
 * a modal, so the user is never searching for an obscured dialog.
 */
type Mode = 'voice-ai' | 'whistle' | 'hidden';

export function RecordingPanel(): JSX.Element {
  const mode = createMemo<Mode>(() => {
    const w = whistleState().tag;
    if (w === 'arming' || w === 'recording' || w === 'segmenting') {
      return 'whistle';
    }
    const v = voiceAIState().tag;
    if (
      v === 'listening'
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

const VoiceAIBody = (): JSX.Element => {
  /* The head ✕ has two distinct semantics depending on FSM tag:
   *   - listening / transcribing / requesting / applying / paused /
   *     errored: stop the session (`stopVoiceAI` → `handle.stop()`
   *     dispatches `pause`).
   *   - review: drop the unsent buffer (`cancelVoiceAIReview` —
   *     nothing is sent to the LLM either way, but a session that
   *     the user has shaped but not committed must not linger).
   *
   * The intent is to keep the affordance count fixed at one — the
   * same button, two clearly-different click outcomes, no extra ✕
   * row that the user has to disambiguate. */
  const onClose = async (): Promise<void> => {
    try {
      if (voiceAIState().tag === 'review') {
        await Effect.runPromise(cancelVoiceAIReview());
      } else {
        await Effect.runPromise(stopVoiceAI());
      }
    } catch {
      /* orchestrator handles error recovery */
    }
  };

  return (
    <>
      <div class="voice-recording-panel__head">
        <span class="voice-recording-panel__icon voice-recording-panel__icon--ai" aria-hidden="true">
          <MicIcon size={16} />
        </span>
        <span class="voice-recording-panel__title">Голос</span>
        <Show when={voiceAIState().tag === 'errored'}>
          <span class="voice-recording-panel__err-pill">⚠ ошибка</span>
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
      <Show when={voiceAIState().tag === 'review'} fallback={<VoiceAILiveBody />}>
        <VoiceAIReviewBody />
      </Show>
    </>
  );
};

/**
 * Live body — the listening/transcribing/requesting/applying/errored
 * states. Shows interim text when STT has it, falls back to the
 * «записываю… N с» counter on silence (server STT can wait 5-9 s
 * for the first interim — see `decisions/wavecode-voice-live-transcript`).
 */
const VoiceAILiveBody = (): JSX.Element => (
  <div class="voice-recording-panel__body">
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
            : voiceAIState().tag === 'paused' ? 'на паузе'
            : (voiceAIState().tag === 'listening' || voiceAIState().tag === 'arming')
              ? `записываю… ${voiceAIElapsedSec()} с`
            : '…')}
      </span>
    </Show>
  </div>
);

/**
 * Review body — `review` state. Editable textarea + primary
 * «→ В ИИ» button.
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
    try {
      await Effect.runPromise(stopWhistle());
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
      default: return '';
    }
  };
  const noteLabel = (notes: ReadonlyArray<AudioNote>): string => {
    if (notes.length === 0) return '';
    const last = notes[notes.length - 1]!;
    return noteNumberToName(last.midi).toLowerCase();
  };
  // Cap the visible strip at 8 notes so the panel width stays bounded
  // on mobile; older notes are still in the buffer (and get committed
  // by the orchestrator on release), they just aren't shown here.
  const PREVIEW_LIMIT = 8;
  const recentNotes = createMemo(() => micPreviewNotes().slice(-PREVIEW_LIMIT));

  return (
    <>
      <div class="voice-recording-panel__head">
        <span class="voice-recording-panel__icon voice-recording-panel__icon--whistle" aria-hidden="true">
          <WhistleIcon size={16} />
        </span>
        <span class="voice-recording-panel__title">Свист · {whistleInstrumentLabel()}</span>
        <Show when={whistleState().tag === 'errored'}>
          <span class="voice-recording-panel__err-pill">⚠ {whistleError() ?? 'ошибка'}</span>
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
      <div class="voice-recording-panel__body">
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
      <div class="voice-recording-panel__actions">
        <span class="voice-recording-panel__hint" aria-hidden="true">
          Отпусти кнопку — ноты вставятся
        </span>
        <div class="voice-recording-panel__rms" aria-hidden="true">
          <div
            class="voice-recording-panel__rms-fill"
            style={{ width: `${Math.min(100, Math.round(micCurrentRms() * 400))}%` }}
          />
        </div>
        <span class="voice-recording-panel__count">
          {micPreviewNotes().length} нот
        </span>
      </div>
    </>
  );
};