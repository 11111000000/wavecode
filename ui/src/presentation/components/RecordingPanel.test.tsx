import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { RecordingPanel } from './RecordingPanel';
import {
  __resetVoiceAIForTests,
  voiceAIState,
  setVoiceAIRmsLevel,
  setVoiceAIFlushing,
  voiceAIDraft,
  __dispatchVoiceAIForTests,
} from '../state/voiceAIStore';
import { resetMicMutexForTests } from '../state/micMutexStore';
import { initialVoiceSession } from '~/domain/voice/voiceSession';

/**
 * RecordingPanel tests — the voice DOCK.
 *
 * The dock is the whole voice-input surface below the mic button.
 * It has three rows and a contract that outlived several redesigns:
 *
 *   - ONE field, ALWAYS on screen, ALWAYS editable — the transcript
 *     while the recogniser talks and the editable text afterwards
 *     (`decisions/wavecode-voice-composer-ux`).
 *   - ONE status line with a phrase per FSM state — the answer to
 *     «ушло не ушло, крутится или нет».
 *   - ONE action — «→ В ИИ», which becomes «Отменить отправку»
 *     while the request is on the wire.
 *
 * What is deliberately NOT tested here any more:
 *   - the whistle body (the whistle path is the Mic bottom sheet now);
 *   - the panel's own ●REC button (the mini-FAB IS the record
 *     control — two red dots meant two meanings);
 *   - the «Очистить текст» button (the textarea has a native
 *     select-and-delete; a text action does not belong in a voice
 *     dock).
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

/** Drive the FSM into `review` with the given text. */
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

beforeEach(() => {
  __resetVoiceAIForTests();
  resetMicMutexForTests();
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
  resetMicMutexForTests();
});

describe('RecordingPanel — visibility', () => {
  it('is hidden when the voice session is idle', () => {
    expect(voiceAIState().tag).toBe(initialVoiceSession().tag);
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel')).toBeNull();
  });

  it('renders the dock when voice-AI is listening', () => {
    armAndListen();
    expect(voiceAIState().tag).toBe('listening');
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('voice-ai');
  });

  it('has no header row — the title and the error pill are gone', () => {
    // «Голос» as a heading was noise: the user pressed the mic button
    // and knows what it does. The «⚠ ошибка» pill said what the status
    // line already says.
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__head')).toBeNull();
    expect(container.querySelector('.voice-recording-panel__title')).toBeNull();
    expect(container.querySelector('.voice-recording-panel__err-pill')).toBeNull();
  });

  it('has no record button of its own — the mini-FAB is the record control', () => {
    // Two red ●REC dots on screen at once, both meaning «recording»,
    // neither obviously the real one.
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__rec')).toBeNull();
    expect(container.querySelector('.voice-recording-panel__rec-dot')).toBeNull();
  });

  it('has no «Очистить текст» button — the textarea is the text surface', () => {
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__btn--clear')).toBeNull();
  });
});

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

  it('REGRESSION: «→ В ИИ» is offered while the take is still running', () => {
    // The button used to be enabled but dead outside `review` /
    // `sent`: the orchestrator bailed out of `runRouteFromReview` and
    // the press vanished. Now the press is honoured — the take stops
    // and the transcript goes out when it lands.
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    expect(send).toBeTruthy();
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

  it('says the error IN the status line — no separate error pill', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'error', message: 'микрофон недоступен' });
    const { container } = render(() => <RecordingPanel />);
    expect(
      container.querySelector('.voice-recording-panel__status-text')?.textContent,
    ).toContain('микрофон недоступен');
  });
});

describe('RecordingPanel — sending, cancelling and sending again', () => {
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

    const { container } = render(() => <RecordingPanel />);
    expect(voiceAIState().tag).toBe('sent');
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

  it('the ✕ says what it does in each state', () => {
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    // Outside `review` the ✕ abandons the take — it does NOT stop the
    // recording (that is the mini-FAB) and it does not send anything.
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
    enterReviewWith('сделай потише');
    expect(voiceAIState().tag).toBe('review');
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__delete')).toBeNull();
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
