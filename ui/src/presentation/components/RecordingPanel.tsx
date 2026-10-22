import { Show, For, createMemo, createSignal, type JSX } from 'solid-js';
import {
  voiceAIState,
  voiceAITranscript,
  voiceAIElapsedSec,
  voiceAIRmsLevel,
  voiceAIPanelArmed,
  cancelVoiceAIReview,
  sendVoiceAIReview,
  startVoiceAI,
  clearVoiceAIPanelArmed,
  dismissVoiceAI,
} from '../state/voiceAIStore';
import {
  whistleState,
  whistleError,
  whistleInstrumentLabel,
  whistlePanelArmed,
  startWhistle,
  commitWhistle,
  stopWhistle,
  clearWhistlePanelArmed,
} from '../state/whistleStore';
import {
  micPreviewNotes,
  micCurrentHz,
  micCurrentRms,
} from '../state/micStore';
import { MicIcon, WhistleIcon, CloseIcon, SendIcon } from '../icons';
import { Effect } from 'effect';
import type { AudioNote } from '~/domain/audio/micCapture';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import { noteNumberToName } from '~/domain/music/notes';
import { consoleStore } from './consoleStore';

/**
 * RecordingPanel — bottom-anchored status panel that surfaces the
 * state of whichever voice input is currently active. Each FAB taps
 * the panel into one of four visible modes:
 *
 *   - `voice-ai-armed`   — user tapped «Голос» quickly; panel is
 *                         open with a ●REC button. No session is
 *                         running yet. Pressing ●REC starts it.
 *   - `voice-ai`         — an active session. Shows the live
 *                         transcript OR the «записываю… N с»
 *                         counter (server STT has 5-9 s before the
 *                         first interim lands; see
 *                         `decisions/wavecode-voice-live-transcript`).
 *                         On the server path a live RMS bar makes
 *                         the mic activity visible.
 *   - `whistle-armed`    — user tapped «Свист» quickly; panel shows
 *                         ●REC + «Применить». «Применить» is
 *                         disabled until at least one note is
 *                         buffered.
 *   - `whistle`          — an active whistle session OR buffered
 *                         notes awaiting apply.
 *   - `hidden`           — no panel.
 *
 * The default priority is whistle over voice-AI (mic mutex should
 * prevent them running simultaneously; this is a tiebreaker for
 * transient state). Each mode carries its own ●REC toggle;
 * `VoiceAIMiniFAB` and `WhistleMiniFAB` have their own press-cycle
 * wiring that does NOT start a session on a fast tap.
 *
 * Why the `armed` UI state lives here, not in `voiceSessionReducer`
 * -------------------------------------------------------------
 * Adding an `armed` variant to the domain FSM would (a) double the
 * state space (`armed-oneshot`, `armed-continuous`, ...) without
 * observable value beyond "panel is open"; (b) make the reducer an
 * awkward place for what is genuinely a presentation concern (the
 * user *opened* the panel); (c) require scattering `setVoiceAIPanel
 * Armed(false)` across every reducer transition that might exit
 * armed. A side signal in `voiceAIStore` / `whistleStore` is the
 * minimum surface that captures "the user has the panel open and
 * hasn't yet decided to record" — see
 * `decisions/wavecode-voice-rec-and-meter` outcome
 * `armed-state-lives-in-presentation-not-domain-fsm`.
 */
type Mode =
  | 'voice-ai-armed'
  | 'voice-ai'
  | 'whistle-armed'
  | 'whistle'
  | 'hidden';

export function RecordingPanel(): JSX.Element {
  const mode = createMemo<Mode>(() => {
    const w = whistleState().tag;
    if (w === 'arming' || w === 'recording' || w === 'segmenting') {
      return 'whistle';
    }
    if (whistlePanelArmed()) return 'whistle-armed';
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
    if (voiceAIPanelArmed()) return 'voice-ai-armed';
    return 'hidden';
  });

  return (
    <Show when={mode() !== 'hidden'}>
      <div
        class="voice-recording-panel"
        data-mode={mode()}
        data-state={mode() === 'voice-ai'
          ? voiceAIState().tag
          : mode() === 'voice-ai-armed'
            ? 'armed'
            : mode() === 'whistle-armed'
              ? 'armed'
              : whistleState().tag}
        role="status"
        aria-live="polite"
      >
        <Show when={mode() === 'voice-ai' || mode() === 'voice-ai-armed'}>
          <VoiceAIBody armed={mode() === 'voice-ai-armed'} />
        </Show>
        <Show when={mode() === 'whistle' || mode() === 'whistle-armed'}>
          <WhistleBody armed={mode() === 'whistle-armed'} />
        </Show>
      </div>
    </Show>
  );
}

/* ── voice-AI body ─────────────────────────────────────────────────── */

const VoiceAIBody = (props: { readonly armed: boolean }): JSX.Element => {
  /* The head ✕ always closes the panel and discards the take.
   *
   * It used to call `stopVoiceAI()`, which dispatches `pause` — and
   * since `mode` treats `paused` as a visible state, the panel stayed
   * on screen showing «на паузе» instead of going away. The button
   * is labelled «закрыть», so it must close: `dismiss` is the FSM
   * event that returns any active state to `idle`, and the mic
   * channel has to be released too, which is what `stopVoiceAI`
   * does — so call both and let `dismiss` win the final state. */
  const onClose = async (): Promise<void> => {
    try {
      if (props.armed || voiceAIPanelArmed()) {
        clearVoiceAIPanelArmed();
        return;
      }
      if (voiceAIState().tag === 'review') {
        await Effect.runPromise(cancelVoiceAIReview());
        return;
      }
      await Effect.runPromise(dismissVoiceAI());
    } catch {
      /* orchestrator handles error recovery */
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
        <span class="voice-recording-panel__title">
          {props.armed ? 'Голос · готов к записи' : 'Голос'}
        </span>
        <Show when={voiceAIState().tag === 'errored'}>
          <span class="voice-recording-panel__err-pill">⚠ ошибка</span>
        </Show>
        <button
          type="button"
          class="voice-recording-panel__close"
          aria-label={
            props.armed
              ? 'Закрыть без записи'
              : voiceAIState().tag === 'review'
                ? 'Отменить и не отправлять текст в ИИ'
                : 'Остановить запись'
          }
          title={
            props.armed
              ? 'Закрыть — запись ещё не началась'
              : voiceAIState().tag === 'review'
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
        fallback={props.armed
          ? <VoiceAIArmedBody />
          : <VoiceAILiveBody />}
      >
        <VoiceAIReviewBody />
      </Show>
    </>
  );
};

/**
 * Armed body — no live STT yet. One button: ●REC. Pressing it
 * clears `voiceAIPanelArmed` and starts a continuous session; from
 * here the live body takes over. There is deliberately no «Применить»
 * or «→ В ИИ» button here: there is no transcribed text yet, and
 * the submit affordance (textarea + «→ В ИИ») is the `review` body
 * that appears after the first `final` chunk lands.
 */
const VoiceAIArmedBody = (): JSX.Element => {
  const onRec = async (): Promise<void> => {
    clearVoiceAIPanelArmed();
    try {
      await Effect.runPromise(
        startVoiceAI({ mode: 'continuous', lang: 'ru-RU' }),
      );
    } catch {
      /* orchestrator surfaces the error; the panel stays open */
    }
  };
  return (
    <div class="voice-recording-panel__armed">
      <button
        type="button"
        class="voice-recording-panel__rec voice-recording-panel__rec--off"
        aria-label="Начать запись"
        title="Начать запись"
        data-rec-state="off"
        onClick={() => { void onRec(); }}
      >
        <span class="voice-recording-panel__rec-dot" aria-hidden="true" />
        <span class="voice-recording-panel__rec-label">REC</span>
      </button>
      <span class="voice-recording-panel__hint">
        Нажмите ●REC, когда будете готовы
      </span>
    </div>
  );
};

/**
 * Live body — the listening/transcribing/requesting/applying/errored
 * states. Shows interim text when STT has it, falls back to the
 * «записываю… N с» counter on silence (server STT can wait 5-9 s
 * for the first interim — see `decisions/wavecode-voice-live-transcript`).
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
              : voiceAIState().tag === 'paused' ? 'на паузе'
              : (voiceAIState().tag === 'listening' || voiceAIState().tag === 'arming')
                ? `записываю… ${voiceAIElapsedSec()} с`
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

const WhistleBody = (props: { readonly armed: boolean }): JSX.Element => {
  const onCancel = async (): Promise<void> => {
    try {
      // Both armed and active sessions respond to ✕ by clearing
      // the buffer and dropping any in-progress recording.
      if (props.armed) {
        clearWhistlePanelArmed();
        return;
      }
      await Effect.runPromise(stopWhistle());
      clearWhistlePanelArmed();
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
      default: return props.armed ? 'Готов к записи' : '';
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
      // Toggle on: clear the armed state and start. `startWhistle`
      // asserts the press-id from the chip; we mint a stable one
      // and idempotently reuse it across the panel's lifetime.
      clearWhistlePanelArmed();
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

  return (
    <>
      <div class="voice-recording-panel__head">
        <span
          class="voice-recording-panel__icon voice-recording-panel__icon--whistle"
          aria-hidden="true"
        >
          <WhistleIcon size={16} />
        </span>
        <span class="voice-recording-panel__title">
          Свист · {whistleInstrumentLabel()}
        </span>
        <Show when={whistleState().tag === 'errored'}>
          <span class="voice-recording-panel__err-pill">⚠ {whistleError() ?? 'ошибка'}</span>
        </Show>
        <button
          type="button"
          class="voice-recording-panel__close"
          aria-label={
            props.armed
              ? 'Закрыть без записи'
              : 'Отменить запись свиста'
          }
          title={
            props.armed
              ? 'Закрыть — запись ещё не началась'
              : 'Отменить запись и не вставлять ничего в score'
          }
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
          {props.armed && !hasNotes()
            ? 'Нажмите ●REC, когда будете готовы'
            : hasNotes()
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
      <Show when={isRecording() && props.armed === false}>
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

/* Stable session id, shared across the panel's lifetime so a tap on
 * ●REC doesn't acquire and release the mic mutex under two different
 * ids. Mirrors `WhistleMiniFAB.ensureSessionId` but lives in the
 * panel because the FAB no longer owns the start path. */
let whistlePanelSessionId: string | null = null;
const ensureWhistleSessionId = (): string => {
  if (whistlePanelSessionId === null) {
    whistlePanelSessionId = makeWhistleSessionId();
  }
  return whistlePanelSessionId;
};
const makeWhistleSessionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `whistle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
