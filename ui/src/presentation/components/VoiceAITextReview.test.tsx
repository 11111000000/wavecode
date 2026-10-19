import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { VoiceAITextReview } from './VoiceAITextReview';
import {
  __resetVoiceAIForTests,
  __dispatchVoiceAIForTests,
  __setVoiceAIHandleForTests,
  voiceAIState,
} from '../state/voiceAIStore';
import type { VoiceSessionHandle } from '~/application/voice/VoiceAISession';
import { Ref } from 'effect';
import { initialVoiceSession, type VoiceSessionState } from '~/domain/voice/voiceSession';
import { __resetWhistleForTests } from '../state/whistleStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * VoiceAITextReview render tests.
 *
 *   1. Hidden when FSM is in idle / listening / etc.
 *   2. Renders the editable textarea + 3 action buttons when FSM
 *      is in `review`.
 *   3. The textarea is seeded from `review.editedText`.
 *   4. Send / Cancel buttons update FSM as expected.
 */

/** Minimal handle that mimics the production orchestrator's review
 *  flow: sendReview dispatches `send-review` and routes the
 *  edited text through a no-op LLM (lands the FSM at `idle`); cancelReview
 *  dispatches `cancel-review`. */
const installFake = (): void => {
  const stateRef = Ref.unsafeMake<VoiceSessionState>(initialVoiceSession());
  const setState = (next: VoiceSessionState): void => {
    Effect.runSync(Ref.set(stateRef, next));
    // Mirror to the Solid signal so the test's `voiceAIState()`
    // reads the same truth as production code.
    setVoiceAISignal(next);
  };
  const handle: VoiceSessionHandle = {
    stateRef,
    start: () => Effect.void,
    stop: () => Effect.sync(() => { setState({ tag: 'idle' }); }),
    onChunk: () => Effect.void,
    cancelInFlight: () => Effect.sync(() => { setState({ tag: 'idle' }); }),
    enterReview: () =>
      Effect.sync(() => {
        const cur = voiceAIState();
        if (cur.tag === 'listening' || cur.tag === 'transcribing' || cur.tag === 'paused') {
          setState({
            tag: 'review',
            transcript: cur.transcript,
            editedText: cur.transcript.final.trim(),
          });
        }
      }),
    sendReview: (text: string) =>
      Effect.sync(() => {
        const cur = voiceAIState();
        if (cur.tag === 'review') {
          setState({
            tag: 'requesting',
            transcript: { ...cur.transcript, final: text },
            continuous: false,
          });
        }
      }),
    cancelReview: () =>
      Effect.sync(() => {
        const cur = voiceAIState();
        if (cur.tag === 'review') {
          setState({ tag: 'idle' });
        }
      }),
    stream: Effect.runSync(
      Effect.succeed((async function* () { yield []; })() as never),
    ) as never,
  } as VoiceSessionHandle;
  __setVoiceAIHandleForTests(handle);
};

import { Effect } from 'effect';
import { setVoiceAIState as setVoiceAISignal } from '../state/voiceAIStore';

beforeEach(() => {
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  resetMicMutexForTests();
  installFake();
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  resetMicMutexForTests();
});

describe('VoiceAITextReview — render', () => {
  it('does NOT render when the FSM is idle', () => {
    const { container } = render(() => <VoiceAITextReview />);
    expect(container.querySelector('.voice-review-panel')).toBeNull();
  });

  it('renders the panel when the FSM is in `review`', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: {
      kind: 'final',
      text: 'сделай побыстрее',
      confidence: 0.9,
      lang: 'ru-RU',
      timestampMs: 0,
    } });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    expect(voiceAIState().tag).toBe('review');

    const { container } = render(() => <VoiceAITextReview />);
    const panel = container.querySelector('.voice-review-panel');
    expect(panel).toBeTruthy();
    const textarea = container.querySelector('.voice-review-panel__textarea') as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    expect(textarea?.value).toBe('сделай побыстрее');
    const buttons = container.querySelectorAll('.voice-review-panel__btn');
    expect(buttons.length).toBe(3);
  });

  it('disables Send when the textarea is empty', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    const { container } = render(() => <VoiceAITextReview />);
    const sendBtn = container.querySelector<HTMLButtonElement>(
      '.voice-review-panel__btn--primary',
    )!;
    expect(sendBtn.disabled).toBe(true);
  });

  it('enables Send when the textarea has content; click flips FSM to requesting', async () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: {
      kind: 'final',
      text: 'seeded text',
      confidence: 0.9,
      lang: 'ru-RU',
      timestampMs: 0,
    } });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    const { container } = render(() => <VoiceAITextReview />);
    const sendBtn = container.querySelector<HTMLButtonElement>(
      '.voice-review-panel__btn--primary',
    )!;
    expect(sendBtn.disabled).toBe(false);

    fireEvent.click(sendBtn);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    // The fake's sendReview dispatches `send-review` which lands
    // us in `requesting` (no real LLM).
    expect(voiceAIState().tag).toBe('requesting');
  });

  it('Cancel closes the panel back to idle', async () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: {
      kind: 'final',
      text: 'seeded',
      confidence: 0.9,
      lang: 'ru-RU',
      timestampMs: 0,
    } });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    const { container } = render(() => <VoiceAITextReview />);
    const cancelBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.voice-review-panel__btn'),
    ).find((b) => b.textContent?.includes('Отменить'))!;
    fireEvent.click(cancelBtn);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(voiceAIState().tag).toBe('idle');
  });
});
