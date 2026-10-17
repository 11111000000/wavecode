import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { MicPanel } from './MicPanel';

/**
 * MicPanel render tests (UX-redesign).
 *
 * Strategy:
 *   - Reset module-level signals from `micStore` in beforeEach so the
 *     panel starts from a known state (mirrors PianoToolbar.test.tsx).
 *   - Mock `~/infrastructure/audio/MicCapture` so `startMic()` doesn't
 *     actually try to grab a microphone.
 *   - Mock `~/presentation/state/audioActions` so the Demo button's
 *     `evalScore` and `stopAudio` calls are observable + non-throwing.
 *   - Render via @solidjs/testing-library and assert DOM structure.
 *
 * Default render shows the EMPTY state (no listening, no preview).
 * Tests for the 4-row full layout call `startMic()` first to flip
 * out of empty state; empty-state tests render as-is.
 *
 * The adapter (`micStoreAdapter`) re-exports the existing micStore
 * symbols, so the same `vi.mock('~/infrastructure/audio/MicCapture')`
 * we used in the old tests still works — the adapter doesn't change
 * the underlying pipeline.
 */

const { evalScoreMock, stopAudioMock } = vi.hoisted(() => ({
  evalScoreMock: vi.fn(async (_snippet: string) => undefined),
  stopAudioMock: vi.fn(async () => undefined),
}));

vi.mock('~/infrastructure/audio/./MicCapture', () => ({
  startMicDetector: () => ({
    getState: () => 'streaming',
    stop: async () => {},
  }),
  isMicSupported: () => true,
}));

vi.mock('../state/audioActions', () => ({
  evalScore: evalScoreMock,
  stopAudio: stopAudioMock,
}));

beforeEach(async () => {
  evalScoreMock.mockClear();
  stopAudioMock.mockClear();
  const w = await import('../state/micStore');
  w.setMicInstrument('piano');
  w.setMicSlot('append-stack');
  w.setMicEditorFocused(false);
  w.setMicEditorApi(undefined);
  w.clearPreview();
  await w.stopMic();
});

afterEach(() => {
  cleanup();
});

// ── empty state ───────────────────────────────────────────────────────

describe('MicPanel — top-level layout', () => {
  it('renders the new panel root with .mic-ux-panel class', () => {
    const { container } = render(() => <MicPanel />);
    const root = container.querySelector<HTMLDivElement>('.mic-ux-panel');
    expect(root).not.toBeNull();
    // Default: empty state.
    expect(root?.getAttribute('data-empty')).toBe('true');
  });

  it('flips to the full layout once the mic starts listening', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const root = container.querySelector<HTMLDivElement>('.mic-ux-panel');
    expect(root?.getAttribute('data-empty')).toBe('false');
    // All 4 rows visible.
    expect(container.querySelector('.mic-ux-row-status')).not.toBeNull();
    expect(container.querySelector('.mic-ux-row-cta')).not.toBeNull();
    expect(container.querySelector('.mic-ux-row-roll')).not.toBeNull();
    expect(container.querySelector('.mic-ux-row-meter')).not.toBeNull();
    await w.stopMic();
  });
});

describe('MicPanel — empty state', () => {
  it('renders the empty state when no listening + no preview + no error', () => {
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('.mic-ux-empty')).not.toBeNull();
  });

  it('shows the "Tap START" instruction', () => {
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('.mic-ux-empty-title')?.textContent).toContain(
      'Tap START',
    );
  });

  it('shows a sub-instruction with example inputs', () => {
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('.mic-ux-empty-sub')?.textContent).toContain(
      'beatbox',
    );
  });

  it('Demo button calls evalScore with a sample drum snippet', () => {
    const { container } = render(() => <MicPanel />);
    const demoBtn = container.querySelector<HTMLButtonElement>('.mic-ux-empty-demo')!;
    fireEvent.click(demoBtn);
    expect(evalScoreMock).toHaveBeenCalledTimes(1);
    const arg = evalScoreMock.mock.calls[0]?.[0] ?? '';
    expect(arg).toContain('drums_bd');
  });

  it('"Learn more" toggle reveals help text', () => {
    const { container } = render(() => <MicPanel />);
    const helpBtn = container.querySelector<HTMLButtonElement>('.mic-ux-empty-help')!;
    expect(container.querySelector('.mic-ux-empty-help-text')).toBeNull();
    fireEvent.click(helpBtn);
    expect(container.querySelector('.mic-ux-empty-help-text')).not.toBeNull();
    fireEvent.click(helpBtn);
    expect(container.querySelector('.mic-ux-empty-help-text')).toBeNull();
  });

  it('empty state hides all 4 rows of the full layout', () => {
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('.mic-ux-row-status')).toBeNull();
    expect(container.querySelector('.mic-ux-row-cta')).toBeNull();
    expect(container.querySelector('.mic-ux-row-roll')).toBeNull();
    expect(container.querySelector('.mic-ux-row-meter')).toBeNull();
  });
});

// ── full layout (mic listening) ──────────────────────────────────────

describe('MicPanel — row 1 (pill + instrument + slot)', () => {
  it('renders 3 instrument buttons with the new labels', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const btns = container.querySelectorAll<HTMLButtonElement>('.mic-ux-inst-btn');
    expect(btns).toHaveLength(3);
    expect(btns[0]?.getAttribute('data-instrument')).toBe('piano');
    expect(btns[1]?.getAttribute('data-instrument')).toBe('synth');
    expect(btns[2]?.getAttribute('data-instrument')).toBe('drums');
    await w.stopMic();
  });

  it('default instrument "piano" is data-active', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const active = container.querySelectorAll<HTMLButtonElement>(
      '.mic-ux-inst-btn[data-active="true"]',
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('data-instrument')).toBe('piano');
    await w.stopMic();
  });

  it('clicking the Synth button activates synth', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const synthBtn = container.querySelector<HTMLButtonElement>(
      '[data-instrument="synth"]',
    )!;
    fireEvent.click(synthBtn);
    expect(w.micInstrument()).toBe('synth');
    await w.stopMic();
  });

  it('renders a slot <select> with 3 options (Add to end / Replace all / At cursor)', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const select = container.querySelector<HTMLSelectElement>('.mic-ux-slot-select');
    expect(select).not.toBeNull();
    const opts = select?.querySelectorAll('option');
    expect(opts).toHaveLength(3);
    const labels = Array.from(opts ?? []).map((o) => o.textContent?.trim());
    expect(labels).toEqual(['Add to end', 'Replace all', 'At cursor']);
    await w.stopMic();
  });

  it('at-cursor option is disabled when editor is not focused', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const select = container.querySelector<HTMLSelectElement>('.mic-ux-slot-select');
    const atCursor = Array.from(select?.querySelectorAll('option') ?? [])
      .find((o) => o.value === 'at-cursor');
    expect(atCursor?.disabled).toBe(true);
    await w.stopMic();
  });

  it('at-cursor option becomes enabled when editor is focused', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    w.setMicEditorFocused(true);
    const { container } = render(() => <MicPanel />);
    const select = container.querySelector<HTMLSelectElement>('.mic-ux-slot-select');
    const atCursor = Array.from(select?.querySelectorAll('option') ?? [])
      .find((o) => o.value === 'at-cursor');
    expect(atCursor?.disabled).toBe(false);
    await w.stopMic();
  });

  it('preview pill renders in the empty-pill state when no notes yet', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const pill = container.querySelector<HTMLSpanElement>('.mic-ux-pill');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute('data-empty')).toBe('true');
    expect(pill?.textContent).toContain('no preview');
    await w.stopMic();
  });
});

describe('MicPanel — row 2 (CTAs)', () => {
  it('renders 4 CTA buttons: start, apply, reset, preview', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('[data-cta="start"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="apply"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="reset"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="preview"]')).not.toBeNull();
    await w.stopMic();
  });

  it('the Apply CTA has the prominent mic-ux-cta class', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const apply = container.querySelector<HTMLButtonElement>('[data-cta="apply"]');
    expect(apply?.classList.contains('mic-ux-cta')).toBe(true);
    await w.stopMic();
  });

  it('START button label flips to STOP when listening', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const startBtn = container.querySelector<HTMLButtonElement>('[data-cta="start"]');
    expect(startBtn?.textContent?.trim()).toContain('STOP');
    await w.stopMic();
  });

  it('clicking STOP calls stopMic', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const startBtn = container.querySelector<HTMLButtonElement>('[data-cta="start"]')!;
    fireEvent.click(startBtn);
    expect(w.micListening()).toBe(false);
  });

  it('Apply CTA is disabled when preview is empty (but listening)', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const apply = container.querySelector<HTMLButtonElement>('[data-cta="apply"]');
    expect(apply?.hasAttribute('disabled')).toBe(true);
    await w.stopMic();
  });

  it('Reset CTA is disabled when preview is empty (but listening)', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const reset = container.querySelector<HTMLButtonElement>('[data-cta="reset"]');
    expect(reset?.hasAttribute('disabled')).toBe(true);
    await w.stopMic();
  });

  it('Preview toggle is disabled when preview is empty (but listening)', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const prev = container.querySelector<HTMLButtonElement>('[data-cta="preview"]');
    expect(prev?.hasAttribute('disabled')).toBe(true);
    await w.stopMic();
  });

  it('Preview toggle calls evalScore (when preview is non-empty)', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { setMicTransients } = await import('../state/micStore');
    setMicTransients([{
      type: 'kick',
      startMs: 1000,
      amplitude: 0.8,
      spectralCentroidHz: 100,
      envelopeMs: 80,
    }]);
    const { container } = render(() => <MicPanel />);
    const prev = container.querySelector<HTMLButtonElement>('[data-cta="preview"]')!;
    fireEvent.click(prev);
    expect(evalScoreMock).toHaveBeenCalled();
    expect(prev.getAttribute('data-active')).toBe('true');
    fireEvent.click(prev);
    expect(stopAudioMock).toHaveBeenCalled();
    await w.stopMic();
  });
});

describe('MicPanel — row 3 (PianoRollPreview)', () => {
  it('renders the PianoRollPreview component', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('.mic-ux-piano-roll')).not.toBeNull();
    await w.stopMic();
  });

  it('renders the "Live timeline" header', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const header = container.querySelector('.mic-ux-roll-header')?.textContent ?? '';
    expect(header.toLowerCase()).toContain('live timeline');
    await w.stopMic();
  });

  it('passes notes/transients from the adapter into PianoRollPreview', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const root = container.querySelector<HTMLDivElement>('.mic-ux-piano-roll');
    expect(root?.getAttribute('data-empty')).toBe('true');
    expect(root?.getAttribute('data-note-count')).toBe('0');
    expect(root?.getAttribute('data-drum-count')).toBe('0');
    await w.stopMic();
  });
});

describe('MicPanel — row 4 (MicMeter)', () => {
  it('renders the MicMeter component with read-out', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('.mic-ux-row-meter')).not.toBeNull();
    expect(container.querySelector('.mic-ux-meter')).not.toBeNull();
    expect(container.querySelector('.mic-ux-meter-readout')).not.toBeNull();
    await w.stopMic();
  });

  it('read-out shows "— Hz" when no pitch is detected', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const hzRow = rows[1];
    expect(hzRow?.textContent).toContain('— Hz');
    await w.stopMic();
  });

  it('MicMeter bar width responds to RMS', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const bar = container.querySelector<HTMLDivElement>('.mic-ux-meter-bar');
    // Width is a CSS string like "0%" or "12.34%". We just confirm
    // it has SOME width set (not undefined) and the data-listening
    // flag is true.
    expect(bar?.style.width).toMatch(/%$/);
    expect(bar?.getAttribute('data-listening')).toBe('true');
    await w.stopMic();
  });
});

describe('MicPanel — error pill', () => {
  it('error pill does not render when no error', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('.mic-error-pill')).toBeNull();
    await w.stopMic();
  });
});

describe('MicPanel — adapter integration', () => {
  it('panel data-state mirrors micDetectionActive from the adapter', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicPanel />);
    const root = container.querySelector<HTMLDivElement>('.mic-ux-panel');
    // With the mock detector, no onsets fire and no notes come in,
    // but listening is on. Detection kind = 'idle' until something
    // is detected.
    expect(root?.getAttribute('data-state')).toBe('idle');
    await w.stopMic();
  });
});