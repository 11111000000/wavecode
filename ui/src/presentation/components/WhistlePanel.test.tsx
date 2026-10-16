import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { WhistlePanel } from './WhistlePanel';

/**
 * WhistlePanel render tests.
 *
 * Strategy:
 *   - Reset module-level signals from `whistleStore` in beforeEach so
 *     the panel starts from a known state (mirrors PianoToolbar.test.tsx).
 *   - Mock `WhistleDetector` via `vi.mock` so `startWhistle()` doesn't
 *     actually try to grab a microphone.
 *   - Render via `@solidjs/testing-library` and assert DOM structure
 *     (button counts, data-* attributes, slot cycle, error pill, etc.).
 *   - Use `data-testid` style selectors where data-* attributes are
 *     not exposed (Solid's reactive bindings don't always reflect into
 *     querySelector reliably across jsdom versions).
 */

vi.mock('~/infrastructure/audio/WhistleDetector', () => ({
  startWhistleDetector: () => ({
    getState: () => 'idle',
    stop: async () => {},
  }),
  isWhistleSupported: () => true,
}));

beforeEach(async () => {
  const w = await import('../state/whistleStore');
  w.setWhistleInstrument('piano');
  w.setWhistleSlot('append-stack');
  w.setWhistleEditorFocused(false);
  w.setWhistleEditorApi(undefined);
  w.clearPreview();
  // Reset by reaching into whistleStore's onCleanup path
  await w.stopWhistle();
  // Reset localStorage so test runs are deterministic
  try { localStorage.removeItem('wavecode-whistle-collapse-v1'); } catch {}
});

afterEach(() => {
  cleanup();
});

describe('WhistlePanel — structure', () => {
  it('renders exactly 1 mic button, 3 slot buttons, 8 instrument buttons, 3 action buttons', () => {
    const { container } = render(() => <WhistlePanel />);
    const mic = container.querySelectorAll<HTMLButtonElement>('.whistle-mic-btn');
    const slot = container.querySelectorAll<HTMLButtonElement>('.whistle-slot-btn');
    const inst = container.querySelectorAll<HTMLButtonElement>('.whistle-inst-btn');
    const act = container.querySelectorAll<HTMLButtonElement>('.whistle-action-btn');
    expect(mic).toHaveLength(1);
    expect(slot).toHaveLength(3);
    expect(inst).toHaveLength(8);
    expect(act).toHaveLength(3);
  });

  it('mic button starts with aria-pressed=false and "Начать прослушивание" label', () => {
    const { container } = render(() => <WhistlePanel />);
    const btn = container.querySelector<HTMLButtonElement>('.whistle-mic-btn');
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    expect(btn?.getAttribute('aria-label')).toBe('Начать прослушивание микрофона');
  });

  it('mic button is in the "idle" state by default', () => {
    const { container } = render(() => <WhistlePanel />);
    const panel = container.querySelector<HTMLDivElement>('.whistle-panel');
    expect(panel?.getAttribute('data-state')).toBe('idle');
  });

  it('renders 3 slot buttons with the expected ids', () => {
    const { container } = render(() => <WhistlePanel />);
    const slots = container.querySelectorAll<HTMLButtonElement>('.whistle-slot-btn');
    const ids = Array.from(slots).map((b) => b.getAttribute('data-slot'));
    expect(ids).toEqual(['append-stack', 'replace-score', 'at-cursor']);
  });

  it('at-cursor slot is disabled when editor is not focused', () => {
    const { container } = render(() => <WhistlePanel />);
    const atCursor = container.querySelector<HTMLButtonElement>('[data-slot="at-cursor"]');
    expect(atCursor?.hasAttribute('disabled')).toBe(true);
  });

  it('at-cursor slot becomes enabled when editor is focused', async () => {
    const w = await import('../state/whistleStore');
    w.setWhistleEditorFocused(true);
    const { container } = render(() => <WhistlePanel />);
    const atCursor = container.querySelector<HTMLButtonElement>('[data-slot="at-cursor"]');
    expect(atCursor?.hasAttribute('disabled')).toBe(false);
  });

  it('default slot is append-stack (data-active on the right button)', () => {
    const { container } = render(() => <WhistlePanel />);
    const active = container.querySelectorAll<HTMLButtonElement>('.whistle-slot-btn[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('data-slot')).toBe('append-stack');
  });

  it('renders 8 instrument buttons (4 sample + 4 oscillator)', () => {
    const { container } = render(() => <WhistlePanel />);
    const inst = container.querySelectorAll<HTMLButtonElement>('.whistle-inst-btn');
    const labels = Array.from(inst).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Piano', 'Casio', 'Guitar', 'Synth', '△', '∿', '⊿', '⊓']);
  });

  it('default instrument "piano" is marked data-active', () => {
    const { container } = render(() => <WhistlePanel />);
    const active = container.querySelectorAll<HTMLButtonElement>('.whistle-inst-btn[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent?.trim()).toBe('Piano');
  });

  it('instrument button click changes active selection', async () => {
    const w = await import('../state/whistleStore');
    const { container } = render(() => <WhistlePanel />);
    const triangleBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.whistle-inst-btn'))
      .find((b) => b.textContent?.trim() === '△')!;
    fireEvent.click(triangleBtn);
    expect(w.whistleInstrument()).toBe('triangle');
    expect(triangleBtn.getAttribute('data-active')).toBe('true');
  });

  it('clear and apply buttons start disabled (no preview notes)', () => {
    const { container } = render(() => <WhistlePanel />);
    const clear = container.querySelector<HTMLButtonElement>('[data-action="clear"]');
    const apply = container.querySelector<HTMLButtonElement>('[data-action="apply"]');
    expect(clear?.hasAttribute('disabled')).toBe(true);
    expect(apply?.hasAttribute('disabled')).toBe(true);
  });

  it('freeze button is disabled when not listening', () => {
    const { container } = render(() => <WhistlePanel />);
    const freeze = container.querySelector<HTMLButtonElement>('[data-action="freeze"]');
    expect(freeze?.hasAttribute('disabled')).toBe(true);
  });
});

describe('WhistlePanel — slot cycle', () => {
  it('clicking a slot button cycles to the next slot in order', async () => {
    const w = await import('../state/whistleStore');
    const { container } = render(() => <WhistlePanel />);
    expect(w.whistleSlot()).toBe('append-stack');
    // Click any slot button — toggleWhistleSlot() advances to the next.
    const firstSlot = container.querySelector<HTMLButtonElement>('.whistle-slot-btn')!;
    fireEvent.click(firstSlot);
    expect(w.whistleSlot()).toBe('replace-score');
    fireEvent.click(firstSlot);
    expect(w.whistleSlot()).toBe('at-cursor');
    fireEvent.click(firstSlot);
    expect(w.whistleSlot()).toBe('append-stack');
  });
});

describe('WhistlePanel — meter + read-out', () => {
  it('renders SVG meter with 2 rows (RMS top, Hz bottom)', () => {
    const { container } = render(() => <WhistlePanel />);
    const svg = container.querySelector<SVGSVGElement>('.whistle-meter');
    expect(svg).not.toBeNull();
    const rects = svg?.querySelectorAll('rect') ?? [];
    // 2 background + 2 foreground = 4 rects
    expect(rects).toHaveLength(4);
  });

  it('read-out shows "— Hz" when no pitch is detected', () => {
    const { container } = render(() => <WhistlePanel />);
    const read = container.querySelector<HTMLSpanElement>('.whistle-hz-readout');
    expect(read?.textContent).toBe('— Hz');
  });
});

describe('WhistlePanel — slot tooltips', () => {
  it('append-stack slot has a full-sentence title', () => {
    const { container } = render(() => <WhistlePanel />);
    const slot = container.querySelector<HTMLButtonElement>('[data-slot="append-stack"]');
    expect(slot?.getAttribute('title')).toContain('stack(...)');
  });

  it('replace-score slot title mentions undo', () => {
    const { container } = render(() => <WhistlePanel />);
    const slot = container.querySelector<HTMLButtonElement>('[data-slot="replace-score"]');
    expect(slot?.getAttribute('title')).toContain('Ctrl+Z');
  });

  it('at-cursor slot title (when editor not focused) tells user to focus the editor', () => {
    const { container } = render(() => <WhistlePanel />);
    const slot = container.querySelector<HTMLButtonElement>('[data-slot="at-cursor"]');
    expect(slot?.getAttribute('title')).toContain('кликните в редактор');
  });
});

describe('WhistlePanel — error pill', () => {
  it('error pill does not render when no error', () => {
    const { container } = render(() => <WhistlePanel />);
    expect(container.querySelector('.whistle-error-pill')).toBeNull();
  });
});
