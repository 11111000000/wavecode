import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { VoiceTranscriptOverlay } from './VoiceTranscriptOverlay';
import {
  __resetVoiceAIForTests,
  __dispatchVoiceAIForTests,
  voiceAIState,
} from '../state/voiceAIStore';

/**
 * VoiceTranscriptOverlay render tests.
 *
 *   1. Hidden in `idle` (no overlay element).
 *   2. Shows the interim/final text in `listening`.
 *   3. Shows the error pill in `errored`.
 */

beforeEach(() => {
  __resetVoiceAIForTests();
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
});

describe('VoiceTranscriptOverlay — idle state', () => {
  it('renders nothing in idle', () => {
    expect(voiceAIState().tag).toBe('idle');
    const { container } = render(() => <VoiceTranscriptOverlay />);
    expect(container.querySelector('.voice-transcript-overlay')).toBeNull();
  });
});

describe('VoiceTranscriptOverlay — listening state', () => {
  it('renders the overlay with .voice-transcript-overlay--listening', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    expect(voiceAIState().tag).toBe('listening');
    const { container } = render(() => <VoiceTranscriptOverlay />);
    const overlay = container.querySelector('.voice-transcript-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay!.getAttribute('data-state')).toBe('listening');
  });

  it('renders the placeholder text when transcript is empty', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    const { container } = render(() => <VoiceTranscriptOverlay />);
    const text = container.querySelector('.voice-transcript-overlay__text');
    expect(text).toBeTruthy();
    // Empty transcript → placeholder '…'.
    expect(text!.textContent).toBe('…');
  });
});

describe('VoiceTranscriptOverlay — errored state', () => {
  it('renders the error variant when the FSM is errored', () => {
    __dispatchVoiceAIForTests({ type: 'error', message: 'Boom' });
    const { container } = render(() => <VoiceTranscriptOverlay />);
    const overlay = container.querySelector('.voice-transcript-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay!.getAttribute('data-state')).toBe('errored');
    const err = container.querySelector('.voice-transcript-overlay__error');
    expect(err).toBeTruthy();
    expect(err!.textContent).toContain('Boom');
  });
});
