import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { WhistleMiniFAB } from './WhistleMiniFAB';
import {
  __resetWhistleForTests,
  whistleState,
  setWhistleState,
  whistleInstrumentLabel,
  whistlePanelArmed,
} from '../state/whistleStore';
import { __resetVoiceAIForTests } from '../state/voiceAIStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * WhistleMiniFAB render tests.
 *
 *   1. Renders with `.voice-mini-fab--whistle` and a whistle icon.
 *   2. pointerdown / pointerup wires through to start/stop via the
 *      store's `startWhistle` / `stopWhistle` Effects. Under the
 *      no-handle fallback the FSM lands in `arming`.
 *
 * The minimal-hold gate (`MIN_HOLD_BEFORE_RELEASE_OK_MS` =
 * 80 ms) added on 2026-10-19 requires `pointerup` to be preceded
 * by enough wall-clock time on `pointerdown`. The "real" release
 * test below uses 120ms to clear the threshold.
 */

const HOLD_GUARD_MS = 120;

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

describe('WhistleMiniFAB — render', () => {
  it('renders with class voice-mini-fab--whistle', () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector('.voice-mini-fab.voice-mini-fab--whistle');
    expect(btn).toBeTruthy();
  });

  it('renders an SVG whistle icon', () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector('.voice-mini-fab')!;
    const svg = btn.querySelector('svg.wc-icon');
    expect(svg).toBeTruthy();
  });
});

describe('WhistleMiniFAB — hint chip names the instrument', () => {
  it('shows "слушаю… · пианино" while recording', async () => {
    // Whistle dropped its instrument selector, so before this the chip
    // said only "слушаю…" and the user had no way to know what would
    // come out of the speakers. The chip now names the instrument.
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <WhistleMiniFAB />);
    fireEvent.pointerDown(container.querySelector<HTMLButtonElement>('.voice-mini-fab--whistle')!);
    // The chip only appears after HOLD_NOTICE_MS of held state.
    await new Promise<void>((resolve) => setTimeout(resolve, HOLD_GUARD_MS + 200));
    const hint = container.querySelector('.voice-mini-fab__hint');
    expect(hint?.textContent).toContain('слушаю…');
    expect(hint?.textContent).toContain(whistleInstrumentLabel());
    expect(hint?.textContent).toContain('пианино');
  });
});

describe('WhistleMiniFAB — pointerdown / pointerup', () => {
  it('pointerdown starts a session (FSM lands in non-idle under fallback)', async () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, HOLD_GUARD_MS));
    expect(whistleState().tag).not.toBe('idle');
  });

  it('pointerup stops the session (FSM returns to idle)', async () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, HOLD_GUARD_MS));
    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, HOLD_GUARD_MS));
    expect(whistleState().tag).toBe('idle');
  });

  it('REGRESSION (2026-10-21): hold-and-release keeps the panel armed so «Применить» stays reachable', async () => {
    // `stopWhistle()` drops the whistle FSM back to `idle`, and
    // `RecordingPanel.mode` only stays visible while the FSM is
    // arming/recording/segmenting OR while `whistlePanelArmed`
    // holds. Without arming on the release path a hold-and-release
    // takes the panel off screen together with the notes the user
    // just whistled, and those notes can never be spliced.
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, HOLD_GUARD_MS));
    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, HOLD_GUARD_MS));

    expect(whistleState().tag).toBe('idle');
    expect(whistlePanelArmed()).toBe(true);
  });

  it('REGRESSION (2026-10-19): fast pointerleave immediately after pointerdown does NOT commit an empty buffer', async () => {
    // Mobile Chrome fires `pointerleave` ~10-40ms after `pointerdown`
    // even when the user intended to hold the button. Without the
    // MIN_HOLD_BEFORE_RELEASE_OK_MS gate, `commitWhistle()` ran on
    // an empty buffer immediately, generating zero notes, and the
    // FSM cycled to idle without producing audio. Pin the new
    // behaviour: a sub-threshold pointerleave leaves the session
    // ACTIVE.
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.pointerDown(btn);
    // Simulate the spurious pointerleave that mobile Chrome emits
    // ~15ms after pointerdown — well under the 80ms gate.
    btn.dispatchEvent(new Event('pointerleave', { bubbles: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // FSM should still be in a recording state — pointerleave was
    // ignored as too short.
    expect(whistleState().tag).not.toBe('idle');
    // Now properly release after >80ms hold.
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, HOLD_GUARD_MS));
    expect(whistleState().tag).toBe('idle');
  });
});
