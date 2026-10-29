import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { VoiceFAB } from './VoiceFAB';
import {
  __resetVoiceAIForTests,
} from '../state/voiceAIStore';
import { __resetWhistleForTests } from '../state/whistleStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * VoiceFAB render tests.
 *
 *   1. Renders the FAB cluster with both mini-FABs (voice-AI and
 *      whistle) immediately — no speed-dial expansion needed.
 *   2. Both mini-FABs have their always-visible label so the user
 *      can tell them apart at a glance.
 *   3. Each mini-FAB carries the correct modifier class.
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

describe('VoiceFAB — cluster renders without expansion', () => {
  it('renders the voice-fab-group cluster', () => {
    const { container } = render(() => <VoiceFAB />);
    const group = container.querySelector('.voice-fab-group');
    expect(group).toBeTruthy();
  });

  it('renders both mini-FABs immediately on first render (no expand needed)', () => {
    const { container } = render(() => <VoiceFAB />);
    const minis = container.querySelectorAll('.voice-mini-fab');
    expect(minis.length).toBe(2);
  });

  it('shows both always-visible labels "Голос" and "Свист"', () => {
    const { container } = render(() => <VoiceFAB />);
    const labels = container.querySelectorAll('.voice-mini-fab__label');
    const texts = Array.from(labels).map((el) => el.textContent?.trim());
    expect(texts).toContain('Голос');
    expect(texts).toContain('Свист');
  });

  it('renders one voice-AI and one whistle mini-FAB', () => {
    const { container } = render(() => <VoiceFAB />);
    expect(
      container.querySelector('.voice-mini-fab--ai'),
    ).toBeTruthy();
    expect(
      container.querySelector('.voice-mini-fab--whistle'),
    ).toBeTruthy();
  });
});
