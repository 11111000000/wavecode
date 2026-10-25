import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { Effect, Stream } from 'effect';
import { VoiceAIMiniFAB } from './VoiceAIMiniFAB';
import {
  __resetVoiceAIForTests,
  __publishVoiceAIStateForTests,
  __setVoiceAIHandleForTests,
  voiceAIState,
  voiceAIFlushing,
} from '../state/voiceAIStore';
import { __resetWhistleForTests } from '../state/whistleStore';
import { resetMicMutexForTests } from '../state/micMutexStore';
import { initialTranscriptState } from '~/domain/voice/Transcript';

/**
 * VoiceAIMiniFAB render tests.
 *
 * The button is a TOGGLE (`decisions/wavecode-voice-fab-toggle-rec`):
 *
 *   press → the take starts, the button becomes a REC button;
 *   press → the take stops and the transcript lands in the panel.
 *
 * The old contract (hold ≥ 50 ms to record, tap to arm the panel)
 * is gone: a hold cannot express "keep recording after I let go",
 * and the recording has to survive the finger leaving the button.
 */

beforeEach(() => {
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  resetMicMutexForTests();
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  resetMicMutexForTests();
});

/**
 * A stand-in orchestrator handle that records what it was asked to do.
 * The default test setup leaves `handle === null`, which drives the
 * `errored` fallback — so the live-take assertions below install this
 * fake and publish the FSM state by hand, the way production does.
 */
const fakeHandle = (calls: { start: number; stop: number }) => ({
  start: () => Effect.sync(() => { calls.start += 1; }),
  stop: () => Effect.sync(() => { calls.stop += 1; }),
  onChunk: () => Effect.void,
  enterReview: () => Effect.void,
  sendReview: () => Effect.void,
  cancelReview: () => Effect.void,
  dismiss: () => Effect.void,
  cancelInFlight: () => Effect.void,
  stream: Stream.empty,
});

const listeningState = () => ({
  tag: 'listening' as const,
  transcript: initialTranscriptState('ru-RU'),
  continuous: false,
});

/** Let the fire-and-forget Effect settle. */
const settle = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 30));

describe('VoiceAIMiniFAB — render', () => {
  it('renders with class voice-mini-fab voice-mini-fab--ai', () => {
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector('.voice-mini-fab.voice-mini-fab--ai');
    expect(btn).toBeTruthy();
  });

  it('renders an SVG mic icon', () => {
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector('.voice-mini-fab')!;
    const svg = btn.querySelector('svg.wc-icon');
    expect(svg).toBeTruthy();
  });

  it('is enabled when voiceAISupported is true', () => {
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    expect(btn.disabled).toBe(false);
  });
});

describe('VoiceAIMiniFAB — the press toggles the take', () => {
  it('a press starts a session', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.click(btn);
    await settle();
    expect(calls.start).toBe(1);
    expect(calls.stop).toBe(0);
  });

  it('the next press stops the session', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.click(btn);
    await settle();
    // The orchestrator now reports a live take — the production shape.
    __publishVoiceAIStateForTests(listeningState());
    fireEvent.click(btn);
    await settle();
    expect(calls.stop).toBe(1);
    expect(calls.start).toBe(1);
  });

  it('REGRESSION: the take survives the finger leaving the button', async () => {
    // The whole point of the toggle: releasing the pointer must NOT
    // end the recording. A browser turns pointerdown+pointerup into
    // a `click` — and it is that click that starts the take. The
    // pointerup itself must not stop it.
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    await settle();
    __publishVoiceAIStateForTests(listeningState());
    await settle();

    expect(calls.start).toBe(1);
    expect(calls.stop).toBe(0);
    // ...and the button still shows that the mic is open.
    expect(btn.getAttribute('data-rec-state')).toBe('on');
  });

  it('a press while the take is being flushed changes nothing', async () => {
    // Between the stop and the transcript landing the take is
    // already closed — the audio is on its way to the recogniser.
    // A press in that window must not start a second take.
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.click(btn);
    await settle();
    __publishVoiceAIStateForTests(listeningState());
    fireEvent.click(btn);
    await settle();
    expect(calls.stop).toBe(1);

    // `stopVoiceAI` raises the flush flag: the FSM is still
    // `listening`, but the recording is over.
    expect(voiceAIFlushing()).toBe(true);
    fireEvent.click(btn);
    await settle();
    expect(calls.start).toBe(1);
    expect(calls.stop).toBe(1);
  });
});

describe('VoiceAIMiniFAB — the REC state', () => {
  it('turns into a REC button while the take is running', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    expect(btn.getAttribute('data-rec-state')).toBe('off');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.voice-mini-fab__rec-dot')).toBeNull();
    expect(btn.querySelector('.voice-mini-fab__label')?.textContent).toBe('Голос');

    fireEvent.click(btn);
    await settle();
    __publishVoiceAIStateForTests(listeningState());

    expect(btn.getAttribute('data-rec-state')).toBe('on');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    // The mic glyph is replaced by the blinking dot.
    expect(container.querySelector('.voice-mini-fab__rec-dot')).toBeTruthy();
    expect(btn.querySelector('svg.wc-icon')).toBeNull();
    expect(btn.querySelector('.voice-mini-fab__label')?.textContent).toBe('REC');
  });

  it('shows «Слушаю…» in the hint chip while recording', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.click(btn);
    await settle();
    __publishVoiceAIStateForTests(listeningState());
    const hint = container.querySelector('.voice-mini-fab__hint');
    expect(hint?.textContent).toContain('Слушаю');
  });

  it('shows «распознаю…» while the stopped take is being uploaded', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.click(btn);
    await settle();
    __publishVoiceAIStateForTests(listeningState());
    fireEvent.click(btn);
    await settle();
    const hint = container.querySelector('.voice-mini-fab__hint');
    expect(hint?.textContent).toContain('распознаю');
  });

  it('goes back to the idle look when the take ends', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.click(btn);
    await settle();
    __publishVoiceAIStateForTests(listeningState());
    expect(btn.getAttribute('data-rec-state')).toBe('on');

    __publishVoiceAIStateForTests({ tag: 'idle' });
    expect(btn.getAttribute('data-rec-state')).toBe('off');
    expect(container.querySelector('.voice-mini-fab__rec-dot')).toBeNull();
    expect(voiceAIState().tag).toBe('idle');
  });
});
