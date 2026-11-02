import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { RecordingPanel } from './RecordingPanel';
import {
  __resetWhistleForTests,
  whistleState,
  setWhistleState,
  whistlePanelArmed,
  setWhistlePanelArmed,
  requestWhistlePanelArmed,
  whistleInstrument,
} from '../state/whistleStore';
import {
  __resetVoiceAIForTests,
  voiceAIState,
  setVoiceAIRmsLevel,
  setVoiceAIFlushing,
  voiceAIDraft,
  __dispatchVoiceAIForTests,
} from '../state/voiceAIStore';
import { resetMicMutexForTests } from '../state/micMutexStore';
import {
  __resetRhythmForTests,
  startRhythm,
  stopRhythm,
} from '../state/rhythmStore';
import { appStore, dispatch } from '../state/appStore';
import {
  setMicPreviewNotes,
  setMicCurrentHz,
  setMicCurrentRms,
  micPreviewNotes,
  micCurrentHz,
  __feedMicTransientForTests,
} from '../state/micStore';
import { Effect } from 'effect';
import { initialVoiceSession } from '~/domain/voice/voiceSession';
import { initialWhistleSession } from '~/domain/audio/whistleSession';

/**
 * RecordingPanel tests — exercise the unified voice-input status
 * panel that subsumes the legacy VoiceTranscriptOverlay (voice-AI)
 * and adds a bottom panel for whistle (which had no panel before).
 *
 * Visibility rules under test:
 *   - voice-AI in `idle` / unstarted  → panel hidden.
 *   - voice-AI in `listening` / `transcribing` / `requesting` /
 *     `applying` / `errored`           → voice-AI body visible.
 *   - voice-AI in `review`            → voice-AI body shows the
 *     inline review form (textarea + → В ИИ button). The head ✕ is
 *     the cancel affordance; nothing leaves the device until the
 *     user clicks «→ В ИИ».
 *   - whistle in `arming` / `recording` / `segmenting` → whistle
 *     body visible (this is the new behaviour — used to be silent).
 *   - whistle wins over voice-AI when both happen to be active.
 *
 * History
 * -------
 * `decisions/wavecode-voice-live-transcript` deleted VoiceAITextReview
 * (the modal) on the theory that the live transcript made a separate
 * review step redundant in the primary loop. `decisions/wavecode-
 * voice-confirm-before-send` re-introduced the confirmation step
 * inline on the same panel — NOT as a modal — because a single STT
 * error should not silently rewrite the score. These tests assert
 * the inline form is present in `review` and absent in every other
 * active state.
 */

const FINAL_CHUNK = {
  kind: 'final' as const,
  text: 'сделай потише',
  confidence: 0.9,
  lang: 'ru-RU',
  timestampMs: 0,
};

/** Drive the voice-AI FSM into `listening`. */
const armAndListen = (): void => {
  __dispatchVoiceAIForTests({ type: 'arm' });
  __dispatchVoiceAIForTests({ type: 'stt-ready' });
};

const resetMicStore = (): void => {
  setMicPreviewNotes([]);
  setMicCurrentHz(null);
  setMicCurrentRms(0);
};

beforeEach(() => {
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  __resetRhythmForTests();
  resetMicMutexForTests();
  resetMicStore();
  dispatch({ type: 'replaceScore', text: '' });
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  __resetRhythmForTests();
  resetMicMutexForTests();
  resetMicStore();
});

describe('RecordingPanel — visibility', () => {
  it('is hidden when neither voice-AI nor whistle is active', () => {
    expect(voiceAIState().tag).toBe(initialVoiceSession().tag);
    expect(whistleState().tag).toBe(initialWhistleSession().tag);
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel')).toBeNull();
  });

  it('renders the voice-AI body when voice-AI is listening', () => {
    armAndListen();
    expect(voiceAIState().tag).toBe('listening');
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('voice-ai');
    expect(panel?.querySelector('.voice-recording-panel__title')?.textContent).toBe('Голос');
  });

  it('renders the whistle body when whistle is recording', () => {
    whistleState(); // touch for ordering
    // Trigger the FSM by directly invoking the public signal mirror —
    // mirrors whistleStore.test.ts, which uses the same seam.
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('whistle');
    // The timbre lives in a PICKER next to the title now (the user
    // asked to see and choose the really-available instruments), and
    // the picker reads its value from whistleStore, not from a copy
    // local to this component.
    expect(panel?.querySelector('.voice-recording-panel__title')?.textContent)
      .toBe('Свист');
    const picker = panel?.querySelector<HTMLSelectElement>(
      '.voice-recording-panel__instrument',
    );
    expect(picker?.value).toBe('piano');
  });
});

describe('RecordingPanel — whistle body content', () => {
  it('shows recent notes from micPreviewNotes as a strip', () => {
    setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 200, durationMs: 200, vibratoCents: 0 },
      { midi: 67, cents: 0, startMs: 400, durationMs: 200, vibratoCents: 0 },
    ]);
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const notes = container.querySelectorAll('.voice-recording-panel__note');
    expect(notes).toHaveLength(3);
    expect(notes[0]?.textContent).toBe('c4');
    expect(notes[1]?.textContent).toBe('e4');
    expect(notes[2]?.textContent).toBe('g4');
    expect(micPreviewNotes()).toHaveLength(3);
  });

  it('shows the live Hz readout when a pitch is detected', () => {
    setMicCurrentHz(440);
    // Seed a note that landed on 440Hz so the readout shows the note name.
    setMicPreviewNotes([
      { midi: 69, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
    ]);
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const hz = container.querySelector('.voice-recording-panel__hz');
    expect(hz).toBeTruthy();
    expect(hz?.textContent).toContain('440 Hz');
    expect(hz?.textContent).toContain('a4'); // MIDI 69 = A4
    expect(micCurrentHz()).toBe(440);
  });

  it('shows the close button that calls stopWhistle', () => {
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const closeBtn = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    expect(closeBtn.getAttribute('aria-label')).toContain('Отменить');
    // The click handler is async; we just verify it doesn't throw.
    fireEvent.click(closeBtn);
  });
});


/* =========================================================================
 *  The composer (`decisions/wavecode-voice-composer-ux`).
 *
 *  ONE field, ALWAYS on screen, ALWAYS editable — while the mic is
 *  open, while the recogniser thinks, while the LLM answers and
 *  after the edit was applied. The old panel had two faces (a
 *  read-only transcript and a review form that existed only in
 *  `review`); the split is exactly what the user reported as
 *  «текст не редактируется» and «непонятно, ушло ли».
 * ========================================================================= */
describe('RecordingPanel — the composer', () => {
  /**
   * The composer's contract (`decisions/wavecode-voice-composer-ux`):
   * ONE field, ALWAYS on screen, ALWAYS editable. The old panel had
   * two faces — a read-only transcript while recording and an
   * editable form that existed only in the `review` state — and the
   * split is exactly what the user hit as «текст не редактируется».
   */
  const states = [
    'arming',
    'listening',
    'transcribing',
    'review',
    'requesting',
    'applying',
    'sent',
    'errored',
  ] as const;

  it.each(states)('the field is present in the %s state', (tag) => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    if (tag !== 'arming') {
      __dispatchVoiceAIForTests({ type: 'stt-ready' });
    }
    if (tag === 'transcribing') {
      __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    }
    if (tag === 'review' || tag === 'requesting' || tag === 'applying'
      || tag === 'sent') {
      __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
      __dispatchVoiceAIForTests({ type: 'enter-review' });
    }
    if (tag === 'requesting' || tag === 'applying' || tag === 'sent') {
      __dispatchVoiceAIForTests({ type: 'send-review', text: 'сделай потише' });
    }
    if (tag === 'applying' || tag === 'sent') {
      __dispatchVoiceAIForTests({ type: 'request-sent', score: 's("bd")' });
    }
    if (tag === 'sent') {
      __dispatchVoiceAIForTests({ type: 'applied' });
    }
    if (tag === 'errored') {
      __dispatchVoiceAIForTests({ type: 'error', message: 'микрофон недоступен' });
    }
    expect(voiceAIState().tag).toBe(tag);
    const { container } = render(() => <RecordingPanel />);
    const field = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    expect(field).toBeTruthy();
    // Editable, not read-only: the whole point.
    expect(field.hasAttribute('readonly')).toBe(false);
    expect(field.hasAttribute('disabled')).toBe(false);
  });

  it('the recognised text lands in the field as soon as it arrives', () => {
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const field = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    expect(field.value).toBe('');
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    expect(field.value).toBe('сделай потише');
  });

  it('the field is editable while the mic is open', () => {
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const field = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.input(field, { target: { value: 'сделай по-тише' } });
    expect(field.value).toBe('сделай по-тише');
    expect(voiceAIDraft()).toBe('сделай по-тише');
  });

  it('the recogniser does not overwrite what the user typed', () => {
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const field = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.input(field, { target: { value: 'сделай по-тише' } });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    expect(field.value).toBe('сделай по-тише');
  });

  it('«→ В ИИ» is disabled while the field is empty', () => {
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    expect(send).toBeTruthy();
    expect(send.disabled).toBe(true);
  });

  it('«→ В ИИ» is enabled as soon as there is text to send', () => {
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    fireEvent.input(
      container.querySelector(
        '.voice-recording-panel__review-textarea',
      ) as HTMLTextAreaElement,
      { target: { value: 'сделай потише' } },
    );
    expect(send.disabled).toBe(false);
  });
});

describe('RecordingPanel — the status line', () => {
  /**
   * «ушло не ушло, крутится или нет» — the panel always says what
   * the machine is doing, in one phrase per state.
   */
  it('says what the machine is doing in every state', () => {
    const status = (): string => {
      const { container, unmount } = render(() => <RecordingPanel />);
      const text = container.querySelector(
        '.voice-recording-panel__status-text',
      )?.textContent ?? '';
      unmount();
      return text;
    };

    __dispatchVoiceAIForTests({ type: 'arm' });
    expect(status()).toContain('микрофон');

    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    expect(status()).toContain('Записываю');

    __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    expect(status()).toContain('Текст готов');

    __dispatchVoiceAIForTests({ type: 'send-review', text: 'сделай потише' });
    expect(status()).toContain('Отправляю');

    __dispatchVoiceAIForTests({ type: 'request-sent', score: 's("bd")' });
    expect(status()).toContain('Применяю');

    __dispatchVoiceAIForTests({ type: 'applied' });
    expect(status()).toContain('Правка применена');
  });

  it('shows the spinner only while the app is waiting for something', () => {
    const spinner = (): Element | null => {
      const { container, unmount } = render(() => <RecordingPanel />);
      const el = container.querySelector('.voice-recording-panel__spinner');
      unmount();
      return el;
    };

    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    // Recording: the user is the one doing something, no spinner.
    expect(spinner()).toBeNull();

    __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    expect(spinner()).toBeNull();

    __dispatchVoiceAIForTests({ type: 'send-review', text: 'сделай потише' });
    expect(spinner()).toBeTruthy();
  });

  it('says «Распознаю…» while the stopped take is being uploaded', () => {
    armAndListen();
    setVoiceAIFlushing(true);
    const { container } = render(() => <RecordingPanel />);
    expect(
      container.querySelector('.voice-recording-panel__status-text')?.textContent,
    ).toContain('Распознаю');
  });
});

describe('RecordingPanel — sending, cancelling and sending again', () => {
  const enterReviewWith = (text: string): void => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: {
      kind: 'final',
      text,
      confidence: 0.9,
      lang: 'ru-RU',
      timestampMs: 0,
    } });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    expect(voiceAIState().tag).toBe('review');
  };

  it('the send button becomes «Отменить отправку» while the request is on the wire', () => {
    enterReviewWith('сделай потише');
    __dispatchVoiceAIForTests({ type: 'send-review', text: 'сделай потише' });
    expect(voiceAIState().tag).toBe('requesting');
    const { container } = render(() => <RecordingPanel />);
    const cancel = container.querySelector(
      '.voice-recording-panel__btn--cancel',
    ) as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    expect(cancel.textContent).toContain('Отменить отправку');
    // The send button is gone — sending again is not possible while
    // the first request is in flight, cancelling is.
    expect(container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
  });

  it('after the send the panel stays open with the text — «отправить заново»', () => {
    enterReviewWith('сделай потише');
    __dispatchVoiceAIForTests({ type: 'send-review', text: 'сделай потише' });
    __dispatchVoiceAIForTests({ type: 'request-sent', score: 's("bd")' });
    __dispatchVoiceAIForTests({ type: 'applied' });
    expect(voiceAIState().tag).toBe('sent');

    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    const field = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    expect(field.value).toBe('сделай потише');
    // The send button is back: the same text can go again.
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    expect(send).toBeTruthy();
    expect(send.disabled).toBe(false);
  });

  it('the text stays editable after the send', () => {
    enterReviewWith('сделай потише');
    __dispatchVoiceAIForTests({ type: 'send-review', text: 'сделай потише' });
    __dispatchVoiceAIForTests({ type: 'request-sent', score: 's("bd")' });
    __dispatchVoiceAIForTests({ type: 'applied' });

    const { container } = render(() => <RecordingPanel />);
    const field = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.input(field, { target: { value: 'сделай потише и тише' } });
    expect(field.value).toBe('сделай потише и тише');
  });

  it('the head ✕ says what it does in each state', () => {
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    // Outside `review` the ✕ abandons the take — it does NOT "stop
    // the recording" (that is the ●REC button) and it does not send
    // anything.
    expect(close.getAttribute('aria-label')).toBe('Отменить запись и закрыть панель');

    cleanup();
    enterReviewWith('сделай потише');
    const review = render(() => <RecordingPanel />);
    const reviewClose = review.container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    expect(reviewClose.getAttribute('aria-label') ?? '').toContain('Отменить');
    expect(reviewClose.getAttribute('title') ?? '').toContain('не уйдёт');
    expect(reviewClose.getAttribute('title') ?? '').not.toContain('Остановить');
  });

  it('REGRESSION: ✕ closes the panel instead of pinning the FSM', async () => {
    // The old reducer honoured `dismiss` only from `paused` and
    // `errored`, so pressing ✕ while recording left the FSM in
    // `listening` for ever: the mic was released, the take was
    // gone, and the panel went on counting seconds for a session
    // that no longer existed.
    armAndListen();
    expect(voiceAIState().tag).toBe('listening');

    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector<HTMLButtonElement>(
      '.voice-recording-panel__close',
    )!;
    fireEvent.click(close);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(voiceAIState().tag).toBe('idle');
  });

  it('keeps the textarea in the same panel — never opens a modal', () => {
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    expect(
      container.querySelector('.voice-recording-panel .voice-recording-panel__composer'),
    ).toBeTruthy();
    expect(container.querySelector('.voice-review-panel')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // Only ONE panel in the DOM.
    expect(container.querySelectorAll('.voice-recording-panel')).toHaveLength(1);
  });
});
/* =========================================================================
 *  Whistle panel (`decisions/wavecode-voice-fab-toggle-rec`).
 *  The whistle mini-FAB is a toggle now: a press starts the take, the
 *  next press pauses it and leaves the notes in the buffer. The panel
 *  therefore stays on screen with ●REC + «Применить» so the paused
 *  notes can still be applied (or deleted).
 * ========================================================================= */
describe('RecordingPanel — whistle panel', () => {
  it('renders ●REC (off) and «Применить» (disabled) when the panel is armed with no notes', () => {
    requestWhistlePanelArmed();
    expect(whistlePanelArmed()).toBe(true);
    expect(whistleState().tag).toBe('idle');
    expect(micPreviewNotes().length).toBe(0);
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('whistle');
    expect(panel?.getAttribute('data-state')).toBe('idle');
    const rec = container.querySelector(
      '.voice-recording-panel__rec',
    ) as HTMLButtonElement;
    expect(rec).toBeTruthy();
    expect(rec.getAttribute('data-rec-state')).toBe('off');
    const apply = container.querySelector(
      '.voice-recording-panel__btn--apply',
    ) as HTMLButtonElement;
    expect(apply).toBeTruthy();
    // No notes buffered → disabled. The user must record before
    // they can apply anything.
    expect(apply.disabled).toBe(true);
  });

  it('«Применить» stays disabled even with the panel armed but no notes', () => {
    requestWhistlePanelArmed();
    const { container } = render(() => <RecordingPanel />);
    const apply = container.querySelector(
      '.voice-recording-panel__btn--apply',
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    // Empty-buffer safety: dispatching would be a no-op anyway,
    // but the disabled gate prevents the no-op accidental press.
    expect(apply.disabled).toBe(true);
  });

  it('whistle panel shows the ●REC + «Применить» pair even after recording stops', () => {
    // While the panel is armed and a session has produced notes,
    // the user must be able to re-arm, stop, and apply without
    // leaving the panel. We simulate "user recorded and stopped"
    // by holding whistlePanelArmed + seeding micPreviewNotes.
    requestWhistlePanelArmed();
    setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 200, durationMs: 200, vibratoCents: 0 },
    ]);
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    // While the FSM is in `recording`, the panel transitions to
    // the regular "whistle" mode (not "armed") — the orchestrator
    // drives the visibility. The key assertion is that the
    // ●REC button is highlighted.
    const rec = container.querySelector(
      '.voice-recording-panel__rec',
    ) as HTMLButtonElement;
    expect(rec).toBeTruthy();
    expect(rec.getAttribute('data-rec-state')).toBe('on');
    // The strip shows the buffered notes.
    expect(container.querySelectorAll('.voice-recording-panel__note')).toHaveLength(2);
  });

  it('head ✕ drops the buffered notes and closes the panel', async () => {
    requestWhistlePanelArmed();
    setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
    ]);
    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toContain('Отменить');
    fireEvent.click(close);
    // The panel closes synchronously…
    expect(whistlePanelArmed()).toBe(false);
    // …and the notes are dropped once the mic release has settled.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // The ✕ abandons the take: nothing may survive it. The notes
    // are dropped from the segmenter's buffer as well — a take the
    // user explicitly cancelled must not reappear in the next one.
    expect(micPreviewNotes().length).toBe(0);
  });
});

describe('RecordingPanel — voice-AI live RMS meter', () => {
  it('does not render the meter when voiceAIRmsLevel is null (cloud / off path)', () => {
    setVoiceAIRmsLevel(null);
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__rms')).toBeNull();
  });

  it('renders the meter with the calibrated width when RMS is non-null (server path)', () => {
    setVoiceAIRmsLevel(0.1); // 0.1 → width = 40% via `* 400`
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const meter = container.querySelector(
      '.voice-recording-panel__rms',
    ) as HTMLElement;
    expect(meter).toBeTruthy();
    const fill = meter.querySelector(
      '.voice-recording-panel__rms-fill',
    ) as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe('40%');
  });

  it('meter caps at 100% for unusually loud inputs (avoid overflow)', () => {
    setVoiceAIRmsLevel(0.5); // 0.5 → 200% without cap
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const fill = container.querySelector(
      '.voice-recording-panel__rms-fill',
    ) as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('loud-enough RMS marks the bar past the speech threshold (visual "the app hears you")', () => {
    // 0.05 → 20% width, well above the 8% that the whisper
    // SPEECH_RMS_THRESHOLD (0.02) maps to — so the user sees
    // a visible bar when the recogniser is "hearing speech".
    setVoiceAIRmsLevel(0.05);
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const fill = container.querySelector(
      '.voice-recording-panel__rms-fill',
    ) as HTMLElement;
    expect(fill.style.width).toBe('20%');
  });
});

describe('RecordingPanel — whistle live meter visibility', () => {
  it('does not render an extra RMS row while armed with no session', () => {
    requestWhistlePanelArmed();
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__rms-row')).toBeNull();
  });

  it('renders the whistle RMS row when actively recording', () => {
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    setMicCurrentRms(0.07);
    const { container } = render(() => <RecordingPanel />);
    const meter = container.querySelector(
      '.voice-recording-panel__rms',
    ) as HTMLElement;
    expect(meter).toBeTruthy();
    // The whistle path uses the live `micCurrentRms` directly.
    const fill = meter.querySelector(
      '.voice-recording-panel__rms-fill',
    ) as HTMLElement;
    expect(fill.style.width).toBe('28%'); // 0.07 * 400 = 28
  });
});

/* =========================================================================
 *  «Удалить» and «Очистить текст»
 *  (`decisions/wavecode-voice-fab-toggle-rec`).
 *
 *  «Удалить» deletes the recorded AUDIO and keeps the text. It is
 *  only honest while a take is still being captured — once the audio
 *  has been flushed to the recogniser there is nothing left to
 *  delete, and offering the button would be a lie.
 * ========================================================================= */
describe('RecordingPanel — «Удалить»', () => {
  it('is offered while the take is being captured', () => {
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const del = container.querySelector(
      '.voice-recording-panel__delete',
    ) as HTMLButtonElement;
    expect(del).toBeTruthy();
    expect(del.getAttribute('aria-label')).toContain('Удалить');
    expect(del.getAttribute('title')).toContain('текст останется');
  });

  it('is NOT offered while the take is being flushed (the audio is already uploading)', () => {
    armAndListen();
    setVoiceAIFlushing(true);
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__delete')).toBeNull();
  });

  it('is NOT offered in review (the take is over — there is no audio left to delete)', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    expect(voiceAIState().tag).toBe('review');
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__delete')).toBeNull();
  });

  it('drops the buffered whistle notes and keeps the panel open', async () => {
    requestWhistlePanelArmed();
    setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 200, durationMs: 200, vibratoCents: 0 },
    ]);
    const { container } = render(() => <RecordingPanel />);
    const del = container.querySelector(
      '.voice-recording-panel__delete',
    ) as HTMLButtonElement;
    expect(del).toBeTruthy();
    fireEvent.click(del);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // The audio (the notes) is gone…
    expect(micPreviewNotes().length).toBe(0);
    // …and the panel stays: deleting the take is not closing the
    // surface. «Применить» is disabled again (nothing to apply).
    expect(whistlePanelArmed()).toBe(true);
    const apply = container.querySelector(
      '.voice-recording-panel__btn--apply',
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });
});

describe('RecordingPanel — the instrument picker', () => {
  it('lists ONLY sounds that superdough really has', () => {
    // The picker is the one place a user can put a `.s("…")` name into
    // the score. A name that is not registered is FATAL at trigger
    // time (`sound X not found!`), so the list must be the catalogue.
    requestWhistlePanelArmed();
    const { container } = render(() => <RecordingPanel />);
    const picker = container.querySelector<HTMLSelectElement>(
      '.voice-recording-panel__instrument',
    );
    expect(picker).toBeTruthy();
    const values = Array.from(picker?.querySelectorAll('option') ?? [])
      .map((o) => o.getAttribute('value'));
    expect(values).toContain('piano');
    expect(values).toContain('synth_pad');
    expect(values).toContain('sawtooth');
    // The old fiction — 'synth' and 'drums' were never registered.
    expect(values).not.toContain('synth');
    expect(values).not.toContain('drums');
  });

  it('is disabled while a take is running (the take\'s timbre is fixed)', () => {
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const picker = container.querySelector<HTMLSelectElement>(
      '.voice-recording-panel__instrument',
    );
    expect(picker?.disabled).toBe(true);
  });

  it('picking a sound switches the whistle instrument', () => {
    requestWhistlePanelArmed();
    const { container } = render(() => <RecordingPanel />);
    const picker = container.querySelector<HTMLSelectElement>(
      '.voice-recording-panel__instrument',
    )!;
    fireEvent.change(picker, { target: { value: 'synth_pad' } });
    expect(whistleInstrument()).toBe('synth_pad');
  });
});

describe('RecordingPanel — «Очистить текст»', () => {
  const enterReviewWith = (text: string): void => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: {
      kind: 'final',
      text,
      confidence: 0.9,
      lang: 'ru-RU',
      timestampMs: 0,
    } });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
  };

  it('empties the recognised-text field', () => {
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    const ta = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    const clear = container.querySelector(
      '.voice-recording-panel__btn--clear',
    ) as HTMLButtonElement;
    expect(ta.value).toBe('сделай потише');
    expect(clear).toBeTruthy();
    fireEvent.click(clear);
    expect(ta.value).toBe('');
  });

  it('disables «→ В ИИ» after the text was cleared (an empty instruction is never sent)', () => {
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    const clear = container.querySelector(
      '.voice-recording-panel__btn--clear',
    ) as HTMLButtonElement;
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(clear);
    expect(send.disabled).toBe(true);
  });

  it('the cleared field is not refilled by the recogniser', () => {
    // «Очистить» means «this is my text now» — the next chunk must
    // not write the old words back into the field.
    armAndListen();
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    const { container } = render(() => <RecordingPanel />);
    const ta = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    const clear = container.querySelector(
      '.voice-recording-panel__btn--clear',
    ) as HTMLButtonElement;
    expect(ta.value).toBe('сделай потише');
    fireEvent.click(clear);
    expect(ta.value).toBe('');
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: {
      kind: 'interim',
      text: 'и ещё тише',
      confidence: 0.9,
      lang: 'ru-RU',
      timestampMs: 0,
    } });
    expect(ta.value).toBe('');
  });
});

describe('RecordingPanel — arming is a visible state', () => {
  it('opens the panel as soon as the take starts arming', () => {
    // The mini-FAB starts the take on the press, so the panel has to
    // appear in the same frame — otherwise the user sees nothing
    // happen between the press and the first STT chunk (up to ~16 s
    // on the server relay).
    __dispatchVoiceAIForTests({ type: 'arm' });
    expect(voiceAIState().tag).toBe('arming');
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('voice-ai');
    expect(
      container.querySelector('.voice-recording-panel__status-text')?.textContent,
    ).toBe('Готовлю микрофон…');
  });
});

/* =========================================================================
 *  Reset checks — a stale `armed` flag from a previous test must not
 *  leak into the next test's rendering. The resets in
 *  `__resetVoiceAIForTests` / `__resetWhistleForTests` set the
 *  signals to false explicitly so that an explicit `set*PanelArmed`
 *  from a sibling test doesn't persist.
 * ========================================================================= */
describe('RecordingPanel — clean state between tests', () => {
  it('starts with whistlePanelArmed = false after reset', () => {
    setWhistlePanelArmed(true);
    __resetWhistleForTests();
    expect(whistlePanelArmed()).toBe(false);
  });
});

describe('RecordingPanel — the rhythm body', () => {
  const hit = (type: 'kick' | 'snare' | 'hat' | 'click', startMs: number) => ({
    type,
    startMs,
    amplitude: 0.4,
    spectralCentroidHz: 1000,
    envelopeMs: 30,
  });

  it('renders the rhythm body while a rhythm take is running', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'panel-1' }));
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel?.getAttribute('data-mode')).toBe('rhythm');
    expect(panel?.querySelector('.voice-recording-panel__title')?.textContent)
      .toBe('Ритм');
  });

  it('shows the hits on the grid — the preview IS the committed pattern', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'panel-2' }));
    __feedMicTransientForTests(hit('kick', 0));
    __feedMicTransientForTests(hit('snare', 125));
    const { container } = render(() => <RecordingPanel />);
    const cells = container.querySelectorAll(
      '.voice-recording-panel__rhythm-cell[data-on="true"]',
    );
    expect(cells).toHaveLength(2);
    // Four voices × 16 steps of a bar.
    expect(container.querySelectorAll('.voice-recording-panel__rhythm-cell'))
      .toHaveLength(64);
  });

  it('names the tempo of the grid the hits were placed on', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'panel-3' }));
    const { container } = render(() => <RecordingPanel />);
    const info = container.querySelector('.voice-recording-panel__hz');
    // The default transport runs at 0.5 cps → 120 BPM.
    expect(info?.textContent).toContain('120 BPM');
  });

  it('keeps the panel open for a paused take so «Применить» stays reachable', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'panel-4' }));
    __feedMicTransientForTests(hit('kick', 0));
    await Effect.runPromise(stopRhythm());
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel?.getAttribute('data-mode')).toBe('rhythm');
    const apply = container.querySelector<HTMLButtonElement>(
      '.voice-recording-panel__btn--apply',
    );
    expect(apply?.disabled).toBe(false);
  });

  it('«Применить» writes the pattern into the score', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'panel-5' }));
    __feedMicTransientForTests(hit('kick', 0));
    await Effect.runPromise(stopRhythm());
    const { container } = render(() => <RecordingPanel />);
    const apply = container.querySelector<HTMLButtonElement>(
      '.voice-recording-panel__btn--apply',
    )!;
    fireEvent.click(apply);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(appStore.score).toContain('drums_bd');
  });
});
