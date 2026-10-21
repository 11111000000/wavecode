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
  setVoiceAITranscript,
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
 *   - voice-AI in `review`            → voice-AI body shows the
 *     inline review form (textarea + → В ИИ button). The head ✕ is
 *     the cancel affordance; nothing leaves the device until the
 *     user clicks «→ В ИИ».
 *   - whistle in `arming` / `recording` / `segmenting` → whistle
 *     body visible (this is the new behaviour — used to be silent).
 *   - whistle wins over voice-AI when both happen to be active.
 *
 * History
 * -------
 * `decisions/wavecode-voice-live-transcript` deleted VoiceAITextReview
 * (the modal) on the theory that the live transcript made a separate
 * review step redundant in the primary loop. `decisions/wavecode-
 * voice-confirm-before-send` re-introduced the confirmation step
 * inline on the same panel — NOT as a modal — because a single STT
 * error should not silently rewrite the score. These tests assert
 * the inline form is present in `review` and absent in every other
 * active state.
 */

const FINAL_CHUNK = {
  kind: 'final' as const,
  text: 'сделай потише',
  confidence: 0.9,
  lang: 'ru-RU',
  timestampMs: 0,
};

/** Drive the voice-AI FSM into `listening`. */
const armAndListen = (): void => {
  __dispatchVoiceAIForTests({ type: 'arm' });
  __dispatchVoiceAIForTests({ type: 'stt-ready' });
};

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
    armAndListen();
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
    // Whistle has no instrument selector, so the panel title is the
    // only place the timbre shows up — and it reads it from
    // whistleStore, not from a copy local to this component.
    expect(panel?.querySelector('.voice-recording-panel__title')?.textContent)
      .toBe('Свист · пианино');
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
  it('shows a recording counter while listening with no transcript yet', () => {
    // Server STT has no interim text: one upload covers the whole
    // utterance, so the only honest signal that the mic is hot is
    // the elapsed-seconds counter (decisions/wavecode-server-stt).
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const body = container.querySelector('.voice-recording-panel__transcript');
    expect(body).toBeTruthy();
    expect(body?.textContent).toBe('записываю… 0 с');
  });

  it('prefers the transcript over the counter once text arrives', () => {
    armAndListen();
    // `setVoiceAITranscript` rather than `__dispatchVoiceAIForTests`:
    // the panel reads the transcript signal, which in production is
    // fed by `initVoiceAI`'s subscription to the FSM stream.
    setVoiceAITranscript({
      chunks: [{
        kind: 'interim',
        text: 'слышу: сделай',
        confidence: 0.8,
        lang: 'ru-RU',
        timestampMs: 0,
      }],
      interim: 'слышу: сделай',
      final: '',
      startedAtMs: 0,
      stoppedAtMs: null,
      lang: 'ru-RU',
    });
    const { container } = render(() => <RecordingPanel />);
    const body = container.querySelector('.voice-recording-panel__transcript');
    expect(body?.textContent).toBe('слышу: сделай');
  });

  it('does NOT show the review affordance while listening (live transcript owns the primary loop)', () => {
    // decisions/wavecode-voice-fab, outcome `voice-ai-fab-press-and-hold`:
    // press → speak → auto-commit on the final chunk. The
    // `wavecode-voice-live-transcript` path makes the transcript
    // visible on the panel itself — a separate «Проверить» button is
    // redundant. The button must not be in the DOM at all — not merely
    // disabled, which still renders a visible target.
    armAndListen();
    expect(voiceAIState().tag).toBe('listening');
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
    expect(container.querySelector('.voice-recording-panel__actions')).toBeNull();
    // The rest of the panel keeps working — we hid a button, not the card.
    expect(container.querySelector('.voice-recording-panel__close')).toBeTruthy();
  });

  it('keeps the review affordance hidden through transcribing / requesting / applying', () => {
    const toTranscribing = (): void => {
      armAndListen();
      __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    };
    toTranscribing();
    expect(voiceAIState().tag).toBe('transcribing');
    const transcribing = render(() => <RecordingPanel />);
    expect(transcribing.container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
    cleanup();

    __dispatchVoiceAIForTests({ type: 'commit' });
    expect(voiceAIState().tag).toBe('requesting');
    const requesting = render(() => <RecordingPanel />);
    expect(requesting.container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
    cleanup();

    __dispatchVoiceAIForTests({ type: 'request-sent', score: 's("bd")' });
    expect(voiceAIState().tag).toBe('applying');
    const applying = render(() => <RecordingPanel />);
    expect(applying.container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
  });

  it('does NOT show the review affordance in paused either (live transcript made it redundant)', () => {
    // After `wavecode-voice-live-transcript`, the panel's transcript
    // area carries the latest interim or final text directly. The
    // «Проверить» escape hatch into the review modal is gone — the
    // user reads their words on the panel itself. The FSM `paused`
    // tag is still reachable via ✕ but has no UI affordance any more.
    armAndListen();
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: FINAL_CHUNK });
    __dispatchVoiceAIForTests({ type: 'pause' });
    expect(voiceAIState().tag).toBe('paused');
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
    expect(container.querySelector('.voice-recording-panel__actions')).toBeNull();
  });

  it('hides the review affordance when the session errored', () => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'error', message: 'permission denied' });
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
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

/* =========================================================================
 *  Inline review form (`decisions/wavecode-voice-confirm-before-send`).
 *  Asserts that in the FSM's `review` state the panel surfaces an
 *  editable textarea seeded with the joined final transcript plus a
 *  «→ В ИИ» primary button that is disabled while the text is empty.
 *  The head ✕ in `review` doubles as the "drop the buffer, do not
 *  send" affordance.
 * ========================================================================= */
describe('RecordingPanel — review form (voice-AI inline confirmation)', () => {
  /** Drive FSM to `review` with a known transcript. We use
   *  `__dispatchVoiceAIForTests` to skip the orchestrator's auto-
   *  review path; the test only cares about the rendered DOM. */
  const enterReviewWith = (text: string): void => {
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: {
      kind: 'final',
      text,
      confidence: 0.9,
      lang: 'ru-RU',
      timestampMs: 0,
    } });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    expect(voiceAIState().tag).toBe('review');
  };

  it('renders an editable textarea seeded with the recognised text', () => {
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    const ta = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe('сделай потише');
    expect(ta.getAttribute('aria-label')).toContain('Распознанный текст');
  });

  it('renders the → В ИИ button enabled when the buffer is non-empty', () => {
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    expect(send).toBeTruthy();
    expect(send.textContent).toContain('В ИИ');
    expect(send.disabled).toBe(false);
  });

  it('disables the → В ИИ button when the buffer is whitespace-only', () => {
    enterReviewWith('   ');
    const { container } = render(() => <RecordingPanel />);
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    expect(send).toBeTruthy();
    expect(send.disabled).toBe(true);
  });

  it('disables the → В ИИ button after the user clears the textarea', () => {
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    const ta = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.input(ta, { target: { value: '' } });
    expect(send.disabled).toBe(true);
  });

  it('keeps the textarea in the same panel — never opens a modal', () => {
    // The explicit accept criterion for re-introducing the
    // confirmation step (`decisions/wavecode-voice-confirm-before-send`):
    // confirmation lives on the same bottom panel as the live
    // transcript, NOT in a modal. Lock the layout: no element with
    // modal-ish classes, no `.voice-review-panel` (the deleted
    // modal's class name) anywhere.
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    expect(
      container.querySelector('.voice-recording-panel .voice-recording-panel__review'),
    ).toBeTruthy();
    expect(container.querySelector('.voice-review-panel')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('re-uses the live panel — no two-panels-at-once layout', () => {
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    // Only ONE .voice-recording-panel in the DOM, even though we're
    // rendering the inline review form (the legacy modal used to
    // overlay a SECOND panel on top of this one).
    const panels = container.querySelectorAll('.voice-recording-panel');
    expect(panels).toHaveLength(1);
  });

  it('head ✕ label switches to "Отменить и не отправлять текст в ИИ" in review', () => {
    // Functional test, not behavioural: verifies that in `review`
    // state, the head ✕ button advertises its drop-buffer
    // semantics (rather than its listening-state "stop recording"
    // semantics). The aria-label is what the screen reader reads,
    // which is the user-visible contract.
    enterReviewWith('сделай потише');
    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-label') ?? '').toContain('Отменить');
    expect(close.getAttribute('title') ?? '').toContain('Отменить');
    expect(close.getAttribute('title') ?? '').toContain('не уйдёт');
  });

  it('head ✕ label keeps the "stop recording" semantics outside of review', () => {
    armAndListen();
    expect(voiceAIState().tag).toBe('listening');
    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-label')).toBe('Остановить запись');
  });

  it('does NOT show the review form when the FSM is listening (textarea would overwrite live text)', () => {
    // Sanity check on the inverse invariant: in `listening` the
    // user must see the live transcript evolving; showing a
    // textarea on top of it would freeze the visible text and
    // break the live-utterance loop.
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__review-textarea')).toBeNull();
    expect(container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
    // ...but the live transcript is still there.
    expect(container.querySelector('.voice-recording-panel__transcript')).toBeTruthy();
  });
});