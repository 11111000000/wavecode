import { Show, For, createMemo, type JSX } from 'solid-js';
import {
  voiceAIState,
  voiceAITranscript,
  enterVoiceAIReview,
  stopVoiceAI,
} from '../state/voiceAIStore';
import {
  whistleState,
  whistleError,
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
 * - For voice-AI (any active FSM tag except idle/errored, plus errored):
 *     🎙️ «Слышу: …interim | final…» + a "Проверить" affordance.
 *     Same data the legacy VoiceTranscriptOverlay surfaced.
 * - For whistle (arming/recording/segmenting):
 *     🎵 «Свист: ▶ запись» + last detected note name + Hz readout
 *     + a horizontal strip of recent notes ("c4 e4 g4") + RMS bar.
 *     Notes are pulled from `micPreviewNotes` (the live segmenter
 *     buffer), not from `micTransients` — whistle is a notes-only
 *     feature, never drums.
 *
 * Visibility precedence
 * ---------------------
 * If both voice-AI AND whistle happen to be active (they share a mic
 * mutex so this should be rare, but the FSM is decoupled enough to
 * allow it during transitions), whistle wins for the bottom row
 * because it's a faster, time-bounded gesture; voice-AI stays
 * visible via its review modal.
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
  const onReview = async (): Promise<void> => {
    try {
      await Effect.runPromise(enterVoiceAIReview());
    } catch {
      /* orchestrator handles error recovery */
    }
  };
  const onStop = async (): Promise<void> => {
    try {
      await Effect.runPromise(stopVoiceAI());
    } catch {
      /* ditto */
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
          aria-label="Остановить запись"
          title="Остановить голосовой ввод"
          onClick={() => { void onStop(); }}
        >
          <CloseIcon size={14} />
        </button>
      </div>
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
                : voiceAIState().tag === 'review' ? 'проверь и отправь'
                : '…')}
          </span>
        </Show>
      </div>
      <div class="voice-recording-panel__actions">
        <button
          type="button"
          class="voice-recording-panel__btn voice-recording-panel__btn--primary"
          aria-label="Открыть для проверки и редактирования перед отправкой"
          title="Остановить запись и показать текст для редактирования"
          onClick={() => { void onReview(); }}
          disabled={voiceAIState().tag === 'errored'
            || voiceAIState().tag === 'paused'
            || voiceAIState().tag === 'review'
            || voiceAIState().tag === 'applying'
            || voiceAIState().tag === 'requesting'}
        >
          Проверить <SendIcon size={12} />
        </button>
      </div>
    </>
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
        <span class="voice-recording-panel__title">Свист</span>
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