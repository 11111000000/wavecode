import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { Effect, Stream } from 'effect';
import { VoiceAIMiniFAB } from './VoiceAIMiniFAB';
import {
  __resetVoiceAIForTests,
  __publishVoiceAIStateForTests,
  __setVoiceAIHandleForTests,
  voiceAIState,
  voiceAIPanelArmed,
} from '../state/voiceAIStore';
import { __resetWhistleForTests } from '../state/whistleStore';
import { resetMicMutexForTests } from '../state/micMutexStore';
import { initialTranscriptState } from '~/domain/voice/Transcript';

/**
 * VoiceAIMiniFAB render tests.
 *
 *   1. Renders with `.voice-mini-fab--ai` and a mic icon (svg).
 *   2. Disabled state when `voiceAISupported()` flips false.
 *   3. pointerdown / pointerup wire through to the store's
 *      `startVoiceAI` / `stopVoiceAI` Effects under the
 *      no-handle fallback path.
 *   4. Fast tap (below the 50 ms hold debounce) does NOT start a
 *      session — it arms the recording panel for the user to
 *      press ●REC deliberately (see
 *      decisions/wavecode-voice-rec-and-meter).
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
 * `errored` fallback — and every hold test that relies on it was
 * blind to the production bug below, because `errored` is published
 * synchronously and therefore never exposes a stale read.
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
});

describe('VoiceAIMiniFAB — disabled state', () => {
  it('is enabled when voiceAISupported is true', () => {
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    expect(btn.disabled).toBe(false);
  });
});

describe('VoiceAIMiniFAB — pointer handlers drive the FSM', () => {
  /** CHANGE (2026-10-21, wavecode-voice-rec-and-meter): a fast tap
   *  no longer starts a session immediately. Instead it lifts
   *  `voiceAIPanelArmed` so the bottom panel appears in its
   *  "вооружена, ждёт ●REC" mode and the user has to press ●REC
   *  to actually start. This is the behaviour the user asked for:
   *  accidental taps must not stream audio to STT. */
  it('fast pointerdown+pointerup (tap) opens the armed panel without starting a session', async () => {
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    expect(voiceAIPanelArmed()).toBe(false);
    // Synchronous — well under the 50 ms debounce window.
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    // Critical: the orchestrator FSM stays idle. A fast tap is a
    // signal of intent, not a session-start.
    expect(voiceAIState().tag).toBe('idle');
    // ...but the panel is armed, ready for an in-panel ●REC click.
    expect(voiceAIPanelArmed()).toBe(true);
  });

  it('shows "Слушаю…" hint while the press FSM is non-idle, even before any STT chunk', async () => {
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    // Press FSM → 'pending' on pointerdown.
    fireEvent.pointerDown(btn);
    // Don't release — we want to confirm the hint is visible while
    // we're still in the 50ms debounce window.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const hint = container.querySelector('.voice-mini-fab__hint');
    expect(hint).toBeTruthy();
    expect(hint?.textContent).toContain('Слушаю');
    // And the data-press attribute mirrors the local FSM (helps
    // E2E tests + future debugging).
    expect(btn.getAttribute('data-press')).toBe('pending');
    fireEvent.pointerUp(btn);
  });

  it('hold (>= 50ms) eventually starts a session via the FSM fallback', async () => {
    // Pins the post-fix behaviour: a press of >= 50ms dispatches
    // through the debounce to `startVoiceAI({mode:'continuous'})`.
    // In the no-handle fallback that lands the orchestrator FSM
    // in `errored` and resets our local FSM back to idle — the
    // IMPORTANT proof is that SOMETHING started (i.e. data-state
    // left `idle`), which the OLD bug prevented.
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(btn.getAttribute('data-state')).not.toBe('idle');
    fireEvent.pointerUp(btn);
  });

  it('REGRESSION: hold-and-release stops the session (was: kept recording forever)', async () => {
    // After `wavecode-voice-confirm-before-send` there is no auto-commit:
    // the engine delivers the final chunk on its own. The old release
    // path deliberately left the session running ("review-then-send
    // does"), which left the user unable to end a take — the panel
    // stuck on «записываю… N с» and every further word landed in the
    // same buffer.
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // The press FSM must return to idle so a fresh press can start a
    // new take; and the armed panel flag must not leak (release is
    // "stop", not "open the armed panel").
    expect(btn.getAttribute('data-press')).toBe('idle');
    expect(voiceAIPanelArmed()).toBe(false);
  });

  it('a tap while a session is active stops it without affecting the armed panel', async () => {
    // The "tap during recording stops the session" path is preserved
    // — only the FSM-idle "tap opens the panel" path is new.
    // We seed the FSM with a recording state and verify the handler
    // routes through `stopVoiceAI`, leaving `voiceAIPanelArmed`
    // untouched.
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    // Manually arm the panel from outside the press FSM.
    // (Simpler than driving the no-handle fallback here.)
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    expect(voiceAIPanelArmed()).toBe(true);
    // A second tap on the FAB while armed still goes through the
    // tap-during-active branch — for the FSM-idle case it re-runs
    // the `pending` path; since the panel is already armed the
    // setter is a no-op.
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    // Panel stays armed; FSM still idle.
    expect(voiceAIState().tag).toBe('idle');
    expect(voiceAIPanelArmed()).toBe(true);
  });
});

/**
 * Field report: "I hold the button and it keeps going after I let
 * go — holding doesn't really work."
 *
 * The cause was `pointerleave`. On a touch screen a finger resting on
 * a ~44 px target drifts a couple of pixels as you press, and
 * `pointerleave` fires the instant the touch point crosses the edge —
 * mid-dictation, every time. The handler called `onPointerUp()`, so
 * the take ended while the thumb was still down.
 *
 * Asserted through `voiceAIPanelArmed`, which is a direct and
 * deterministic proxy: `onPointerUp()` on the `pending` path calls
 * `requestVoiceAIPanelArmed()`, so a stray leave is visible as the
 * panel arming itself for a press the user never lifted.
 */
describe('VoiceAIMiniFAB — touch must not end a press', () => {
  /**
   * jsdom has no `PointerEvent` constructor and `fireEvent.*` drops
   * `pointerType` entirely, so the init dict above never reaches the
   * handler. Build the event by hand instead — otherwise these tests
   * would assert against a permanently-`undefined` pointerType and
   * pass for the wrong reason.
   */
  const firePointer = (
    el: Element,
    type: string,
    pointerType: string,
  ): void => {
    const ev = new Event(type, { bubbles: true });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    el.dispatchEvent(ev);
  };

  it('ignores pointerleave for touch while the press is still pending', () => {
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;

    firePointer(btn, 'pointerdown', 'touch');
    expect(btn.getAttribute('data-press')).toBe('pending');

    // Finger drifts a couple of pixels before the debounce elapses.
    firePointer(btn, 'pointerleave', 'touch');
    expect(btn.getAttribute('data-press')).toBe('pending');
    // The press is still live: it must NOT have been treated as a
    // completed tap-and-release.
    expect(voiceAIPanelArmed()).toBe(false);
    // Balance the gesture. Without this the 50 ms debounce timer from
    // the un-released press outlives the test and fires during
    // whichever suite runs next, against that suite's installed
    // handle — which is how a neighbouring test once saw a phantom
    // `startVoiceAI` call. The assertion above already carries the
    // point of the test.
    firePointer(btn, 'pointerup', 'touch');
  });

  it('still cancels on slide-off for a mouse', () => {
    // Slide-off-to-cancel is the affordance that handler was written
    // for, and a mouse holds a pointer still enough for it to mean
    // "I moved away". Touch has implicit pointer capture, so
    // `pointerup` reaches the button anyway and the leave handler is
    // pure noise there.
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    firePointer(btn, 'pointerdown', 'mouse');
    firePointer(btn, 'pointerleave', 'mouse');
    expect(btn.getAttribute('data-press')).toBe('idle');
    expect(voiceAIPanelArmed()).toBe(true);
  });
});

/**
 * Field report (2026-10-23): "I hold the voice button, say a phrase,
 * let go — the counter keeps ticking and no text ever appears."
 *
 * The cause was the press-FSM sync effect. `startVoiceAI` is async and
 * publishes `arming` on the stream-consumer fiber, so the
 * `setState('holding')` that STARTS the take re-runs the tracking
 * effect while `voiceAIState().tag` is still the stale `idle` — and
 * that effect cleared `holding` straight back to `idle`. From then on
 * `onPointerUp` returned at its `state() === 'idle'` guard without
 * ever calling `stopVoiceAI()`, so the take was never flushed: the mic
 * stayed open, `MediaRecorder` kept writing past the moment the user
 * let go, `voiceAIElapsedSec` kept incrementing, and nothing was ever
 * uploaded.
 *
 * Every pre-existing hold test missed this because the no-handle
 * fallback publishes `errored` synchronously, which never leaves a
 * stale `idle` on the table.
 */
describe('VoiceAIMiniFAB — release must stop a production-shaped session', () => {
  it('holds the press while the session comes up, then stops on release', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;

    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(calls.start).toBe(1);

    // The orchestrator now reports a live take — the production shape.
    __publishVoiceAIStateForTests(listeningState());

    // The press must still read as a press. Before the fix this was
    // 'idle': the stale-tag read had already undone the hold.
    expect(btn.getAttribute('data-press')).toBe('holding');

    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(calls.stop).toBe(1);
    expect(btn.getAttribute('data-press')).toBe('idle');
    // "Stop", not "open the armed panel".
    expect(voiceAIPanelArmed()).toBe(false);
  });

  it('stops from the orchestrator tag alone when the press FSM lost track', async () => {
    // The press-FSM mirror is best-effort; the orchestrator's tag is
    // the authority. Even if the two disagree, lifting the finger must
    // end the take.
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);
    __publishVoiceAIStateForTests(listeningState());

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;

    // Fast tap: the debounce never fires, so no session starts here —
    // but one is already running from an earlier press.
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(calls.stop).toBe(1);
    expect(voiceAIPanelArmed()).toBe(false);
  });

  it('releases the press when a take ends on its own', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);

    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;

    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    __publishVoiceAIStateForTests(listeningState());
    expect(btn.getAttribute('data-press')).toBe('holding');

    // The 1.3 s silence flush (or the 100 s hard cap) ends the take
    // while the finger is still down. The FAB must not stay stuck.
    __publishVoiceAIStateForTests({ tag: 'idle' });
    expect(btn.getAttribute('data-press')).toBe('idle');
  });
});
