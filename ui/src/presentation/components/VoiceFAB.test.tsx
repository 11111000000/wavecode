import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { VoiceFAB } from './VoiceFAB';
import {
  __resetVoiceAIForTests,
} from '../state/voiceAIStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * VoiceFAB render tests.
 *
 *   1. The cluster renders without any expansion step.
 *   2. There is EXACTLY ONE floating control — the whistle button is
 *      gone, the Mic bottom sheet is the whistle path now.
 *   3. The one button that is left has an always-visible label, so
 *      the user can tell what it does at a glance.
 */

beforeEach(() => {
  __resetVoiceAIForTests();
  resetMicMutexForTests();
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
  resetMicMutexForTests();
});

describe('VoiceFAB — one floating control', () => {
  it('renders the voice-fab-group cluster', () => {
    const { container } = render(() => <VoiceFAB />);
    const group = container.querySelector('.voice-fab-group');
    expect(group).toBeTruthy();
  });

  it('renders exactly ONE mini-FAB (the whistle button is gone)', () => {
    // Two floating microphone buttons meant two ways to open the same
    // device. The whistle path lives in the Mic bottom sheet now.
    const { container } = render(() => <VoiceFAB />);
    const minis = container.querySelectorAll('.voice-mini-fab');
    expect(minis.length).toBe(1);
    expect(container.querySelector('.voice-mini-fab--ai')).toBeTruthy();
    expect(container.querySelector('.voice-mini-fab--whistle')).toBeNull();
  });

  it('shows the always-visible label "Голос"', () => {
    const { container } = render(() => <VoiceFAB />);
    const labels = container.querySelectorAll('.voice-mini-fab__label');
    const texts = Array.from(labels).map((el) => el.textContent?.trim());
    expect(texts).toContain('Голос');
  });
});
