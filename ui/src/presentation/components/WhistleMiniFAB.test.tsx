import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { WhistleMiniFAB } from './WhistleMiniFAB';
import { __resetWhistleForTests, whistleState } from '../state/whistleStore';
import { __resetVoiceAIForTests } from '../state/voiceAIStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * WhistleMiniFAB render tests.
 *
 *   1. Renders with `.voice-mini-fab--whistle` and a whistle icon.
 *   2. pointerdown / pointerup wires through to start/stop via the
 *      store's `startWhistle` / `stopWhistle` Effects. Under the
 *      no-handle fallback the FSM lands in `arming`.
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

describe('WhistleMiniFAB — pointerdown / pointerup', () => {
  it('pointerdown starts a session (FSM lands in non-idle under fallback)', async () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(whistleState().tag).not.toBe('idle');
  });

  it('pointerup stops the session (FSM returns to idle)', async () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.pointerDown(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    fireEvent.pointerUp(btn);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(whistleState().tag).toBe('idle');
  });
});
