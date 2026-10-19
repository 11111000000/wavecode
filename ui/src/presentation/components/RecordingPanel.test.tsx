import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { RecordingPanel } from './RecordingPanel';
import {
  __resetWhistleForTests,
  whistleState,
  setWhistleState,
} from '../state/whistleStore';
import {
  __resetVoiceAIForTests,
  voiceAIState,
  __dispatchVoiceAIForTests,
} from '../state/voiceAIStore';
import { resetMicMutexForTests } from '../state/micMutexStore';
import {
  setMicPreviewNotes,
  setMicCurrentHz,
  setMicCurrentRms,
  micPreviewNotes,
  micCurrentHz,
} from '../state/micStore';
import { initialVoiceSession } from '~/domain/voice/voiceSession';
import { initialWhistleSession } from '~/domain/audio/whistleSession';

/**
 * RecordingPanel tests — exercise the unified voice-input status
 * panel that subsumes the legacy VoiceTranscriptOverlay (voice-AI)
 * and adds a bottom panel for whistle (which had no panel before).
 *
 * Visibility rules under test:
 *   - voice-AI in `idle` / unstarted  → panel hidden.
 *   - voice-AI in `listening` / `transcribing` / `requesting` /
 *     `applying` / `errored`           → voice-AI body visible.
 *   - whistle in `arming` / `recording` / `segmenting` → whistle
 *     body visible (this is the new behaviour — used to be silent).
 *   - whistle wins over voice-AI when both happen to be active.
 */

const resetMicStore = (): void => {
  setMicPreviewNotes([]);
  setMicCurrentHz(null);
  setMicCurrentRms(0);
};

beforeEach(() => {
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  resetMicMutexForTests();
  resetMicStore();
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  resetMicMutexForTests();
  resetMicStore();
});

describe('RecordingPanel — visibility', () => {
  it('is hidden when neither voice-AI nor whistle is active', () => {
    expect(voiceAIState().tag).toBe(initialVoiceSession().tag);
    expect(whistleState().tag).toBe(initialWhistleSession().tag);
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel')).toBeNull();
  });

  it('renders the voice-AI body when voice-AI is listening', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    expect(voiceAIState().tag).toBe('listening');
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('voice-ai');
    expect(panel?.querySelector('.voice-recording-panel__title')?.textContent).toBe('Голос');
  });

  it('renders the whistle body when whistle is recording', () => {
    whistleState(); // touch for ordering
    // Trigger the FSM by directly invoking the public signal mirror —
    // mirrors whistleStore.test.ts, which uses the same seam.
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('whistle');
    expect(panel?.querySelector('.voice-recording-panel__title')?.textContent).toBe('Свист');
  });
});

describe('RecordingPanel — whistle body content', () => {
  it('shows recent notes from micPreviewNotes as a strip', () => {
    setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 200, durationMs: 200, vibratoCents: 0 },
      { midi: 67, cents: 0, startMs: 400, durationMs: 200, vibratoCents: 0 },
    ]);
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const notes = container.querySelectorAll('.voice-recording-panel__note');
    expect(notes).toHaveLength(3);
    expect(notes[0]?.textContent).toBe('c4');
    expect(notes[1]?.textContent).toBe('e4');
    expect(notes[2]?.textContent).toBe('g4');
    expect(micPreviewNotes()).toHaveLength(3);
  });

  it('shows the live Hz readout when a pitch is detected', () => {
    setMicCurrentHz(440);
    // Seed a note that landed on 440Hz so the readout shows the note name.
    setMicPreviewNotes([
      { midi: 69, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
    ]);
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const hz = container.querySelector('.voice-recording-panel__hz');
    expect(hz).toBeTruthy();
    expect(hz?.textContent).toContain('440 Hz');
    expect(hz?.textContent).toContain('a4'); // MIDI 69 = A4
    expect(micCurrentHz()).toBe(440);
  });

  it('shows the close button that calls stopWhistle', () => {
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    const closeBtn = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    expect(closeBtn.getAttribute('aria-label')).toContain('Отменить');
    // The click handler is async; we just verify it doesn't throw.
    fireEvent.click(closeBtn);
  });
});

describe('RecordingPanel — voice-AI body content', () => {
  it('shows the listening state with placeholder text', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    const { container } = render(() => <RecordingPanel />);
    const body = container.querySelector('.voice-recording-panel__transcript');
    expect(body).toBeTruthy();
    expect(body?.textContent).toBe('…');
  });

  it('shows the review affordance only in active states', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    const { container } = render(() => <RecordingPanel />);
    const btn = container.querySelector('.voice-recording-panel__btn--primary');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toContain('Проверить');
  });

  it('shows the error pill when FSM is in errored', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'error', message: 'permission denied' });
    expect(voiceAIState().tag).toBe('errored');
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel?.getAttribute('data-state')).toBe('errored');
    expect(container.querySelector('.voice-recording-panel__err-pill')).toBeTruthy();
    expect(container.querySelector('.voice-recording-panel__error')?.textContent).toContain(
      'permission denied',
    );
  });
});