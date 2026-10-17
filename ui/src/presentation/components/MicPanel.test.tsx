import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { MicPanel } from './MicPanel';

/**
 * MicPanel render tests.
 *
 * Strategy:
 *   - Reset module-level signals from `micStore` in beforeEach so
 *     the panel starts from a known state (mirrors PianoToolbar.test.tsx).
 *   - Mock `./MicCapture` via `vi.mock` so `startMic()` doesn't
 *     actually try to grab a microphone.
 *   - Render via `@solidjs/testing-library` and assert DOM structure
 *     (button counts, data-* attributes, slot cycle, error pill, etc.).
 *   - Use `data-testid` style selectors where data-* attributes are
 *     not exposed (Solid's reactive bindings don't always reflect into
 *     querySelector reliably across jsdom versions).
 */

vi.mock('~/infrastructure/audio/./MicCapture', () => ({
  startMicDetector: () => ({
    getState: () => 'idle',
    stop: async () => {},
  }),
  isMicSupported: () => true,
}));

beforeEach(async () => {
  const w = await import('../state/micStore');
  w.setMicInstrument('piano');
  w.setMicSlot('append-stack');
  w.setMicEditorFocused(false);
  w.setMicEditorApi(undefined);
  w.clearPreview();
  // Reset by reaching into micStore's onCleanup path
  await w.stopMic();
});

afterEach(() => {
  cleanup();
});

describe('MicPanel — structure', () => {
  it('renders exactly 1 mic button, 3 slot buttons, 8 instrument buttons, 3 action buttons', () => {
    const { container } = render(() => <MicPanel />);
    const mic = container.querySelectorAll<HTMLButtonElement>('.mic-mic-btn');
    const slot = container.querySelectorAll<HTMLButtonElement>('.mic-slot-btn');
    const inst = container.querySelectorAll<HTMLButtonElement>('.mic-inst-btn');
    const act = container.querySelectorAll<HTMLButtonElement>('.mic-action-btn');
    expect(mic).toHaveLength(1);
    expect(slot).toHaveLength(3);
    expect(inst).toHaveLength(8);
    expect(act).toHaveLength(3);
  });

  it('mic button starts with aria-pressed=false and "Начать прослушивание" label', () => {
    const { container } = render(() => <MicPanel />);
    const btn = container.querySelector<HTMLButtonElement>('.mic-mic-btn');
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    expect(btn?.getAttribute('aria-label')).toBe('Начать прослушивание микрофона');
  });

  it('mic button is in the "idle" state by default', () => {
    const { container } = render(() => <MicPanel />);
    const panel = container.querySelector<HTMLDivElement>('.mic-panel');
    expect(panel?.getAttribute('data-state')).toBe('idle');
  });

  it('renders 3 slot buttons with the expected ids', () => {
    const { container } = render(() => <MicPanel />);
    const slots = container.querySelectorAll<HTMLButtonElement>('.mic-slot-btn');
    const ids = Array.from(slots).map((b) => b.getAttribute('data-slot'));
    expect(ids).toEqual(['append-stack', 'replace-score', 'at-cursor']);
  });

  it('at-cursor slot is disabled when editor is not focused', () => {
    const { container } = render(() => <MicPanel />);
    const atCursor = container.querySelector<HTMLButtonElement>('[data-slot="at-cursor"]');
    expect(atCursor?.hasAttribute('disabled')).toBe(true);
  });

  it('at-cursor slot becomes enabled when editor is focused', async () => {
    const w = await import('../state/micStore');
    w.setMicEditorFocused(true);
    const { container } = render(() => <MicPanel />);
    const atCursor = container.querySelector<HTMLButtonElement>('[data-slot="at-cursor"]');
    expect(atCursor?.hasAttribute('disabled')).toBe(false);
  });

  it('default slot is append-stack (data-active on the right button)', () => {
    const { container } = render(() => <MicPanel />);
    const active = container.querySelectorAll<HTMLButtonElement>('.mic-slot-btn[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('data-slot')).toBe('append-stack');
  });

  it('renders 8 instrument buttons (4 sample + 4 oscillator)', () => {
    const { container } = render(() => <MicPanel />);
    const inst = container.querySelectorAll<HTMLButtonElement>('.mic-inst-btn');
    const labels = Array.from(inst).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Piano', 'Casio', 'Guitar', 'Synth', '△', '∿', '⊿', '⊓']);
  });

  it('default instrument "piano" is marked data-active', () => {
    const { container } = render(() => <MicPanel />);
    const active = container.querySelectorAll<HTMLButtonElement>('.mic-inst-btn[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent?.trim()).toBe('Piano');
  });

  it('instrument button click changes active selection', async () => {
    const w = await import('../state/micStore');
    const { container } = render(() => <MicPanel />);
    const triangleBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.mic-inst-btn'))
      .find((b) => b.textContent?.trim() === '△')!;
    fireEvent.click(triangleBtn);
    expect(w.micInstrument()).toBe('triangle');
    expect(triangleBtn.getAttribute('data-active')).toBe('true');
  });

  it('clear and apply buttons start disabled (no preview notes)', () => {
    const { container } = render(() => <MicPanel />);
    const clear = container.querySelector<HTMLButtonElement>('[data-action="clear"]');
    const apply = container.querySelector<HTMLButtonElement>('[data-action="apply"]');
    expect(clear?.hasAttribute('disabled')).toBe(true);
    expect(apply?.hasAttribute('disabled')).toBe(true);
  });

  it('freeze button is disabled when not listening', () => {
    const { container } = render(() => <MicPanel />);
    const freeze = container.querySelector<HTMLButtonElement>('[data-action="freeze"]');
    expect(freeze?.hasAttribute('disabled')).toBe(true);
  });
});

describe('MicPanel — slot cycle', () => {
  it('clicking a slot button cycles to the next slot in order', async () => {
    const w = await import('../state/micStore');
    const { container } = render(() => <MicPanel />);
    expect(w.micSlot()).toBe('append-stack');
    // Click any slot button — toggleMicSlot() advances to the next.
    const firstSlot = container.querySelector<HTMLButtonElement>('.mic-slot-btn')!;
    fireEvent.click(firstSlot);
    expect(w.micSlot()).toBe('replace-score');
    fireEvent.click(firstSlot);
    expect(w.micSlot()).toBe('at-cursor');
    fireEvent.click(firstSlot);
    expect(w.micSlot()).toBe('append-stack');
  });
});

describe('MicPanel — meter + read-out', () => {
  it('renders SVG meter with 2 rows (RMS top, Hz bottom)', () => {
    const { container } = render(() => <MicPanel />);
    const svg = container.querySelector<SVGSVGElement>('.mic-meter');
    expect(svg).not.toBeNull();
    const rects = svg?.querySelectorAll('rect') ?? [];
    // 2 background + 2 foreground = 4 rects
    expect(rects).toHaveLength(4);
  });

  it('read-out shows "— Hz" when no pitch is detected', () => {
    const { container } = render(() => <MicPanel />);
    const read = container.querySelector<HTMLSpanElement>('.mic-hz-readout');
    expect(read?.textContent).toBe('— Hz');
  });
});

describe('MicPanel — slot tooltips', () => {
  it('append-stack slot has a full-sentence title', () => {
    const { container } = render(() => <MicPanel />);
    const slot = container.querySelector<HTMLButtonElement>('[data-slot="append-stack"]');
    expect(slot?.getAttribute('title')).toContain('stack(...)');
  });

  it('replace-score slot title mentions undo', () => {
    const { container } = render(() => <MicPanel />);
    const slot = container.querySelector<HTMLButtonElement>('[data-slot="replace-score"]');
    expect(slot?.getAttribute('title')).toContain('Ctrl+Z');
  });

  it('at-cursor slot title (when editor not focused) tells user to focus the editor', () => {
    const { container } = render(() => <MicPanel />);
    const slot = container.querySelector<HTMLButtonElement>('[data-slot="at-cursor"]');
    expect(slot?.getAttribute('title')).toContain('кликните в редактор');
  });
});

describe('MicPanel — error pill', () => {
  it('error pill does not render when no error', () => {
    const { container } = render(() => <MicPanel />);
    expect(container.querySelector('.mic-error-pill')).toBeNull();
  });
});

describe('MicPanel — mode selector (Phase 3)', () => {
  it('renders 3 mode buttons: sustain, transient, auto', () => {
    const { container } = render(() => <MicPanel />);
    const btns = container.querySelectorAll<HTMLButtonElement>('.mic-mode-btn');
    expect(btns).toHaveLength(3);
    const ids = Array.from(btns).map((b) => b.getAttribute('data-mode'));
    expect(ids).toEqual(['sustain', 'transient', 'auto']);
  });

  it('default mode is "sustain" — that button is data-active', () => {
    const { container } = render(() => <MicPanel />);
    const active = container.querySelectorAll<HTMLButtonElement>('.mic-mode-btn[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('data-mode')).toBe('sustain');
  });

  it('clicking the auto mode button activates auto mode', async () => {
    const w = await import('../state/micStore');
    // Reset to default so the click has a deterministic prior state.
    w.setMicMode('sustain');
    expect(w.micMode()).toBe('sustain');
    const { container } = render(() => <MicPanel />);
    const autoBtn = container.querySelector<HTMLButtonElement>('[data-mode="auto"]')!;
    expect(autoBtn).not.toBeNull();
    fireEvent.click(autoBtn);
    expect(w.micMode()).toBe('auto');
    // And the button itself flips to data-active.
    expect(autoBtn.getAttribute('data-active')).toBe('true');
  });

  it('the auto mode button has a title describing both pipelines', () => {
    const { container } = render(() => <MicPanel />);
    const autoBtn = container.querySelector<HTMLButtonElement>('[data-mode="auto"]')!;
    const title = autoBtn.getAttribute('title') ?? '';
    expect(title.toLowerCase()).toContain('parallel');
    expect(title.toLowerCase()).toContain('sustain');
    expect(title.toLowerCase()).toContain('drum');
  });
});
