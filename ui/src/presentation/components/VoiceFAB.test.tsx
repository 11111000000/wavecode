import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { VoiceFAB } from './VoiceFAB';
import {
  __resetVoiceAIForTests,
  __dispatchVoiceAIForTests,
} from '../state/voiceAIStore';
import { __resetWhistleForTests } from '../state/whistleStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * VoiceFAB render tests.
 *
 *   1. Renders the primary FAB + the speed-dial group.
 *   2. Tap-to-expand: clicking the primary reveals the two
 *      mini-FABs; clicking again collapses them.
 *   3. Auto-expand: when voice-AI leaves idle the mini-FABs render
 *      even without a tap.
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

describe('VoiceFAB — primary FAB renders', () => {
  it('renders the speed-dial group with the primary button', () => {
    const { container } = render(() => <VoiceFAB />);
    const group = container.querySelector('.voice-fab-group');
    expect(group).toBeTruthy();
    const primary = group!.querySelector('.wc-fab');
    expect(primary).toBeTruthy();
  });

  it('does NOT show the mini-FABs when nothing is active', () => {
    const { container } = render(() => <VoiceFAB />);
    expect(container.querySelector('.voice-mini-fab')).toBeNull();
  });
});

describe('VoiceFAB — expand / collapse', () => {
  it('clicking the primary FAB reveals the mini-FAB stack', () => {
    const { container } = render(() => <VoiceFAB />);
    const group = container.querySelector('.voice-fab-group')!;
    expect(group.getAttribute('data-expanded')).toBe('false');
    const primary = group.querySelector('.wc-fab')!;
    fireEvent.click(primary);
    expect(group.getAttribute('data-expanded')).toBe('true');
    const minis = container.querySelectorAll('.voice-mini-fab');
    expect(minis.length).toBe(2);
  });

  it('clicking again collapses the mini-FABs', () => {
    const { container } = render(() => <VoiceFAB />);
    const group = container.querySelector('.voice-fab-group')!;
    const primary = group.querySelector('.wc-fab')!;
    fireEvent.click(primary);
    fireEvent.click(primary);
    expect(group.getAttribute('data-expanded')).toBe('false');
    expect(container.querySelectorAll('.voice-mini-fab')).toHaveLength(0);
  });
});

describe('VoiceFAB — auto-expand on activity', () => {
  it('expands automatically when voice-AI leaves idle', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    const { container } = render(() => <VoiceFAB />);
    const group = container.querySelector('.voice-fab-group')!;
    expect(group.getAttribute('data-expanded')).toBe('true');
    const minis = container.querySelectorAll('.voice-mini-fab');
    expect(minis.length).toBe(2);
  });
});
