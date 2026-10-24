import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { RecordingPanel } from './RecordingPanel';
import {
  __resetWhistleForTests,
  whistleState,
  setWhistleState,
  whistlePanelArmed,
  setWhistlePanelArmed,
  requestWhistlePanelArmed,
} from '../state/whistleStore';
import {
  __resetVoiceAIForTests,
  voiceAIState,
  setVoiceAITranscript,
  setVoiceAIRmsLevel,
  voiceAIPanelArmed,
  setVoiceAIPanelArmed,
  requestVoiceAIPanelArmed,
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

  it('REGRESSION: ✕ closes the panel instead of parking it at «на паузе»', async () => {
    // ✕ called `stopVoiceAI()`, which dispatches `pause` — and `mode`
    // treats `paused` as a VISIBLE state, so the panel stayed on screen
    // showing «на паузе». The button is labelled «закрыть», so it must
    // close: `dismissVoiceAI()` tears the session down AND forces the
    // FSM back to `idle`.
    armAndListen();
    expect(voiceAIState().tag).toBe('listening');

    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector<HTMLButtonElement>(
      '.voice-recording-panel__close',
    )!;
    expect(close).not.toBeNull();
    fireEvent.click(close);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Either the test handle never had a real orchestrator (so the
    // panel's mode is driven purely by the FSM), in which case the
    // FSM must be `idle`; either way the panel must be gone.
    expect(voiceAIState().tag).toBe('idle');
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

  it('seeds the buffer from the interim when the take produced no final chunk', () => {
    // The relay answers `{"text": ""}` often enough that a take can
    // end with an interim and no final. Before the fix the review
    // form opened EMPTY — the recognised text was on screen and the
    // send button was disabled, so there was no way to send it.
    __dispatchVoiceAIForTests({ type: 'arm' });
    __dispatchVoiceAIForTests({ type: 'stt-ready' });
    __dispatchVoiceAIForTests({ type: 'chunk', chunk: {
      kind: 'interim',
      text: 'сделай бас быстрее',
      confidence: 0.9,
      lang: 'ru-RU',
      timestampMs: 0,
    } });
    __dispatchVoiceAIForTests({ type: 'enter-review' });
    expect(voiceAIState().tag).toBe('review');

    const { container } = render(() => <RecordingPanel />);
    const ta = container.querySelector(
      '.voice-recording-panel__review-textarea',
    ) as HTMLTextAreaElement;
    const send = container.querySelector(
      '.voice-recording-panel__btn--primary',
    ) as HTMLButtonElement;
    expect(ta.value).toBe('сделай бас быстрее');
    expect(send.disabled).toBe(false);
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
/* =========================================================================
 *  Armed states (`decisions/wavecode-voice-rec-and-meter`).
 *  When the user fast-taps a mini-FAB, the panel renders an
 *  "вооружена, ждёт ●REC" body with a single ●REC button (voice-AI)
 *  or ●REC + «Применить» (whistle). These tests pin that contract.
 * ========================================================================= */
describe('RecordingPanel — voice-AI armed body', () => {
  it('is hidden when the panel is not armed and the FSM is idle', () => {
    expect(voiceAIPanelArmed()).toBe(false);
    expect(voiceAIState().tag).toBe('idle');
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel')).toBeNull();
  });

  it('renders the armed body when the panel is armed but no session is running', () => {
    requestVoiceAIPanelArmed();
    expect(voiceAIPanelArmed()).toBe(true);
    expect(voiceAIState().tag).toBe('idle');
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('voice-ai-armed');
    expect(panel?.getAttribute('data-state')).toBe('armed');
    // Title carries the "готов к записи" suffix so the user
    // understands the panel is open but idle.
    expect(panel?.querySelector('.voice-recording-panel__title')?.textContent)
      .toContain('Голос');
    expect(panel?.querySelector('.voice-recording-panel__title')?.textContent)
      .toContain('готов к записи');
    // The ●REC button must be present and NOT highlighted.
    const rec = container.querySelector(
      '.voice-recording-panel__rec',
    ) as HTMLButtonElement;
    expect(rec).toBeTruthy();
    expect(rec.getAttribute('data-rec-state')).toBe('off');
    // No review form, no live transcript — the live body would be
    // misleading because no STT engine is running.
    expect(container.querySelector('.voice-recording-panel__transcript')).toBeNull();
    expect(container.querySelector('.voice-recording-panel__review-textarea')).toBeNull();
    // No «Применить» analogue on the voice-AI armed body — there
    // is no transcript to dispatch yet. The «→ В ИИ» button
    // belongs to the `review` state which fires after the first
    // final chunk lands.
    expect(container.querySelector('.voice-recording-panel__btn--primary')).toBeNull();
  });

  it('head ✕ in armed state clears the panel without ever running a session', () => {
    requestVoiceAIPanelArmed();
    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-label')).toContain('Закрыть без записи');
    fireEvent.click(close);
    expect(voiceAIPanelArmed()).toBe(false);
    expect(container.querySelector('.voice-recording-panel')).toBeNull();
  });
});

describe('RecordingPanel — whistle armed body', () => {
  it('renders ●REC (off) and «Применить» (disabled) when armed with no notes', () => {
    requestWhistlePanelArmed();
    expect(whistlePanelArmed()).toBe(true);
    expect(whistleState().tag).toBe('idle');
    expect(micPreviewNotes().length).toBe(0);
    const { container } = render(() => <RecordingPanel />);
    const panel = container.querySelector('.voice-recording-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-mode')).toBe('whistle-armed');
    expect(panel?.getAttribute('data-state')).toBe('armed');
    const rec = container.querySelector(
      '.voice-recording-panel__rec',
    ) as HTMLButtonElement;
    expect(rec).toBeTruthy();
    expect(rec.getAttribute('data-rec-state')).toBe('off');
    const apply = container.querySelector(
      '.voice-recording-panel__btn--apply',
    ) as HTMLButtonElement;
    expect(apply).toBeTruthy();
    // No notes buffered → disabled. The user must record before
    // they can apply anything.
    expect(apply.disabled).toBe(true);
  });

  it('«Применить» stays disabled even with the panel armed but no notes', () => {
    requestWhistlePanelArmed();
    const { container } = render(() => <RecordingPanel />);
    const apply = container.querySelector(
      '.voice-recording-panel__btn--apply',
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    // Empty-buffer safety: dispatching would be a no-op anyway,
    // but the disabled gate prevents the no-op accidental press.
    expect(apply.disabled).toBe(true);
  });

  it('whistle panel shows the ●REC + «Применить» pair even after recording stops', () => {
    // While the panel is armed and a session has produced notes,
    // the user must be able to re-arm, stop, and apply without
    // leaving the panel. We simulate "user recorded and stopped"
    // by holding whistlePanelArmed + seeding micPreviewNotes.
    requestWhistlePanelArmed();
    setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 200, durationMs: 200, vibratoCents: 0 },
    ]);
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <RecordingPanel />);
    // While the FSM is in `recording`, the panel transitions to
    // the regular "whistle" mode (not "armed") — the orchestrator
    // drives the visibility. The key assertion is that the
    // ●REC button is highlighted.
    const rec = container.querySelector(
      '.voice-recording-panel__rec',
    ) as HTMLButtonElement;
    expect(rec).toBeTruthy();
    expect(rec.getAttribute('data-rec-state')).toBe('on');
    // The strip shows the buffered notes.
    expect(container.querySelectorAll('.voice-recording-panel__note')).toHaveLength(2);
  });

  it('head ✕ in armed state clears the panel without sending notes', () => {
    requestWhistlePanelArmed();
    setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
    ]);
    const { container } = render(() => <RecordingPanel />);
    const close = container.querySelector(
      '.voice-recording-panel__close',
    ) as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toContain('Закрыть без записи');
    fireEvent.click(close);
    expect(whistlePanelArmed()).toBe(false);
    // Notes stay in `micPreviewNotes` — that buffer survives
    // unless the orchestrator's commit clears it. The user can
    // re-open the panel and apply them later if they want.
    expect(micPreviewNotes().length).toBe(1);
  });
});

describe('RecordingPanel — voice-AI live RMS meter', () => {
  it('does not render the meter when voiceAIRmsLevel is null (cloud / off path)', () => {
    setVoiceAIRmsLevel(null);
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__rms')).toBeNull();
  });

  it('renders the meter with the calibrated width when RMS is non-null (server path)', () => {
    setVoiceAIRmsLevel(0.1); // 0.1 → width = 40% via `* 400`
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const meter = container.querySelector(
      '.voice-recording-panel__rms',
    ) as HTMLElement;
    expect(meter).toBeTruthy();
    const fill = meter.querySelector(
      '.voice-recording-panel__rms-fill',
    ) as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe('40%');
  });

  it('meter caps at 100% for unusually loud inputs (avoid overflow)', () => {
    setVoiceAIRmsLevel(0.5); // 0.5 → 200% without cap
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const fill = container.querySelector(
      '.voice-recording-panel__rms-fill',
    ) as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('loud-enough RMS marks the bar past the speech threshold (visual "the app hears you")', () => {
    // 0.05 → 20% width, well above the 8% that the whisper
    // SPEECH_RMS_THRESHOLD (0.02) maps to — so the user sees
    // a visible bar when the recogniser is "hearing speech".
    setVoiceAIRmsLevel(0.05);
    armAndListen();
    const { container } = render(() => <RecordingPanel />);
    const fill = container.querySelector(
      '.voice-recording-panel__rms-fill',
    ) as HTMLElement;
    expect(fill.style.width).toBe('20%');
  });
});

describe('RecordingPanel — whistle live meter visibility', () => {
  it('does not render an extra RMS row while armed with no session', () => {
    requestWhistlePanelArmed();
    const { container } = render(() => <RecordingPanel />);
    expect(container.querySelector('.voice-recording-panel__rms-row')).toBeNull();
  });

  it('renders the whistle RMS row when actively recording', () => {
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    setMicCurrentRms(0.07);
    const { container } = render(() => <RecordingPanel />);
    const meter = container.querySelector(
      '.voice-recording-panel__rms',
    ) as HTMLElement;
    expect(meter).toBeTruthy();
    // The whistle path uses the live `micCurrentRms` directly.
    const fill = meter.querySelector(
      '.voice-recording-panel__rms-fill',
    ) as HTMLElement;
    expect(fill.style.width).toBe('28%'); // 0.07 * 400 = 28
  });
});

/* =========================================================================
 *  Reset checks — a stale `armed` flag from a previous test must not
 *  leak into the next test's rendering. The resets in
 *  `__resetVoiceAIForTests` / `__resetWhistleForTests` set the
 *  signals to false explicitly so that an explicit `set*PanelArmed`
 *  from a sibling test doesn't persist.
 * ========================================================================= */
describe('RecordingPanel — clean state between tests', () => {
  it('starts with voiceAIPanelArmed = false after reset', () => {
    setVoiceAIPanelArmed(true);
    __resetVoiceAIForTests();
    expect(voiceAIPanelArmed()).toBe(false);
  });

  it('starts with whistlePanelArmed = false after reset', () => {
    setWhistlePanelArmed(true);
    __resetWhistleForTests();
    expect(whistlePanelArmed()).toBe(false);
  });
});
