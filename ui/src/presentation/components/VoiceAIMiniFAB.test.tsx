import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { VoiceAIMiniFAB } from './VoiceAIMiniFAB';
import { __resetVoiceAIForTests } from '../state/voiceAIStore';
import { __resetWhistleForTests } from '../state/whistleStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * VoiceAIMiniFAB render tests.
 *
 *   1. Renders with `.voice-mini-fab--ai` and a mic icon (svg).
 *   2. Disabled state when `voiceAISupported()` flips false.
 *   3. pointerdown/up wires through to the store's `startVoiceAI`
 *      / `stopVoiceAI` Effects (verified by FSM transition under
 *      the no-handle fallback path).
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
  /** REGRESSION (2026-10-19): pre-fix code dispatched pointerdown then
   *  pointerup synchronously. `clearTimer()` nulled `pressTimer`,
   *  so the next line's `pressTimer === null` check read `true`,
   *  made the handler think the hold had already fired, and
   *  bailed before calling `startVoiceAI`. Result: every fast tap
   *  silently exited with no session. Test pins the post-fix
   *  behaviour: a fast pointerdown→up MUST land the FSM in a
   *  non-idle state (the no-handle fallback makes it `errored`
   *  since there's no real orchestrator, which is fine — the
   *  critical assertion is "left idle"). */
  it('fast pointerdown+pointerup (tap) does NOT silently exit', async () => {
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    // Synchronous — well under the 50ms debounce window.
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    const state = btn.getAttribute('data-state');
    // The no-handle fallback in startVoiceAI dispatches `errored`,
    // so data-state must reflect an active-tag (anything but 'idle').
    expect(state).not.toBe('idle');
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
    // through the debounce to `startVoiceAI({mode:'oneshot'})`. In
    // the no-handle fallback that lands the orchestrator FSM in
    // `errored` and resets our local FSM back to idle (the auto-sync
    // effect) — but the IMPORTANT proof is that SOMETHING started
    // (i.e. data-state left `idle`), which the OLD bug prevented.
    const { container } = render(() => <VoiceAIMiniFAB lang="ru-RU" />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--ai',
    )!;
    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(btn.getAttribute('data-state')).not.toBe('idle');
    fireEvent.pointerUp(btn);
  });
});
