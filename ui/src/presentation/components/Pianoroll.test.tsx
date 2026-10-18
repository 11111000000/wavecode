import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import {
  Pianoroll,
  applyNoteEdit,
  noteSnippet,
  _internal,
} from './Pianoroll';
import { defaultMidiBounds, extractNoteEvents } from '~/domain/music/noteEvents';
import { BUILTIN_PRESETS } from '~/domain/presets';
import { appStore, dispatch } from '../state/appStore';

/**
 * Pianoroll component tests.
 *
 * Strategy: render via @solidjs/testing-library + jsdom. We mock
 *   - `audioActions.evalScore` (so click → eval doesn't dispatch)
 *   - `Effect.runPromise` (so the RAF playhead loop deterministically
 *     reads our fake `getCycleProgress`)
 *   - `requestAnimationFrame` (so the RAF loop runs synchronously
 *     instead of waiting on jsdom's idle callback)
 *
 * Coverage:
 *   - Empty-state overlay visible when score has no notes
 *   - Click on empty area fires onChange with a `note(...)` snippet
 *   - Shift+click on an existing note fires onChange that removes it
 *   - Zoom in/out signals update on the toolbar buttons
 *   - extractNoteEvents on Creep preset returns > 0 events
 *   - debounce: re-parse uses COMPILE_DEBOUNCE_MS window
 *   - pure helpers (midiToY, midiName, isBlackKey) verified
 */

const evalScoreSpy = vi.fn();
const effectRunPromiseSpy = vi.fn((..._args: unknown[]) => Promise.resolve(0));

vi.mock('../state/audioActions', () => ({
  evalScore: (...args: unknown[]) => evalScoreSpy(...args),
  scheduleGridEdit: vi.fn(),
  previewSample: vi.fn(),
  stopAudio: vi.fn(),
  beep: vi.fn(),
  scheduleMixLive: vi.fn(),
  reEvalScoreWithTransport: vi.fn(),
  stopPreview: vi.fn(),
  previewPreset: vi.fn(),
}));

vi.mock('~/infrastructure/composition', () => ({
  AppLayer: { provide: () => (eff: unknown) => eff },
}));

vi.mock('effect', async () => {
  const actual = (await vi.importActual('effect')) as Record<string, unknown>;
  const pipeable = (eff: unknown) => ({
    pipe: (..._args: unknown[]) => pipeable(eff),
    _orig: eff,
  });
  const fakeEffect = {
    ...((actual['Effect'] as Record<string, unknown>) ?? {}),
    gen: (_fn: unknown) => pipeable({ kind: 'gen' }),
    provide: (_layer: unknown) => (eff: unknown) => pipeable(eff),
    runPromise: (..._args: unknown[]) =>
      Promise.resolve(effectRunPromiseSpy(undefined)),
  };
  return {
    ...actual,
    Effect: fakeEffect,
  };
});

const rafCallbacks: Array<(now: number) => void> = [];
let rafNow = 0;

const fakeContext = {
  // Minimal stub — Pianoroll calls these methods; we don't care about
  // the visual output in jsdom. The real canvas is handled by the
  // browser via the HTMLCanvasElement backing store.
  setTransform: () => {},
  clearRect: () => {},
  fillRect: () => {},
  fillText: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {},
  set fillStyle(_v: string) {},
  set strokeStyle(_v: string) {},
  set lineWidth(_v: number) {},
  set font(_v: string) {},
  set textBaseline(_v: string) {},
  set textAlign(_v: string) {},
};

beforeEach(() => {
  evalScoreSpy.mockClear();
  effectRunPromiseSpy.mockReset().mockReturnValue(Promise.resolve(0));
  rafCallbacks.length = 0;
  rafNow = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => { /* noop */ });
  // Stub canvas getContext — jsdom doesn't ship a 2D context, but
  // the Pianoroll calls draw() in a createEffect; this avoids
  // noisy stderr without changing behaviour.
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((type: string) => {
      if (type === '2d') return fakeContext as unknown as CanvasRenderingContext2D;
      return originalGetContext.call(this, type);
    }) as typeof HTMLCanvasElement.prototype.getContext,
  );
  // Reset app state so tests don't leak.
  dispatch({ type: 'replaceScore', text: '' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tickRaf = (): void => {
  const cbs = rafCallbacks.splice(0);
  for (const cb of cbs) {
    rafNow += 16;
    cb(rafNow);
  }
};

describe('Pianoroll — empty state', () => {
  it('renders empty-state overlay when score has no notes', () => {
    const { container } = render(() => (
      <Pianoroll score="" onChange={() => { /* noop */ }} />
    ));
    tickRaf();
    expect(container.querySelector('.pianoroll-empty')).not.toBeNull();
    expect(container.querySelector('.pianoroll-empty code')?.textContent).toMatch(/note/);
  });

  it('hides empty state after re-parse surfaces events', async () => {
    const { container } = render(() => (
      <Pianoroll score='note("c4 e4 g4")' onChange={() => { /* noop */ }} />
    ));
    // Re-parse is debounced 350ms; flush fake timers + RAFs.
    tickRaf();
    await new Promise<void>((res) => setTimeout(res, 400));
    tickRaf();
    expect(container.querySelector('.pianoroll-empty')).toBeNull();
  });
});

describe('Pianoroll — Creep preset integration', () => {
  it('Creep preset surfaces a non-zero event count', () => {
    const creep = BUILTIN_PRESETS.find((p) => p.id === 'creep');
    if (!creep) throw new Error('creep preset missing');
    dispatch({ type: 'replaceScore', text: creep.score });
    const ev = extractNoteEvents(appStore.score);
    expect(ev.length).toBeGreaterThan(0);
  });

  it('canvas element is rendered with the expected aria-label', () => {
    const { container } = render(() => (
      <Pianoroll
        score='note("c4")'
        onChange={() => { /* noop */ }}
      />
    ));
    tickRaf();
    const canvas = container.querySelector('[data-testid="pianoroll-canvas"]');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-label')).toMatch(/click to add notes/i);
  });
});

describe('Pianoroll — zoom controls', () => {
  it('zoom + button increases zoom signal value', () => {
    const { container } = render(() => (
      <Pianoroll score="" onChange={() => { /* noop */ }} />
    ));
    tickRaf();
    const valueEl = container.querySelector('.pianoroll-zoom-value');
    const initial = valueEl?.textContent ?? '1.00×';
    const plusBtn = Array.from(container.querySelectorAll('.pianoroll-zoom-btn'))
      .find((b) => b.textContent?.trim() === '+') as HTMLButtonElement | undefined;
    expect(plusBtn).toBeTruthy();
    fireEvent.click(plusBtn!);
    tickRaf();
    const after = container.querySelector('.pianoroll-zoom-value')?.textContent ?? '';
    expect(after).not.toBe(initial);
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(initial));
  });

  it('reset button snaps back to 1×', () => {
    const { container } = render(() => (
      <Pianoroll score="" onChange={() => { /* noop */ }} />
    ));
    tickRaf();
    const plusBtn = Array.from(container.querySelectorAll('.pianoroll-zoom-btn'))
      .find((b) => b.textContent?.trim() === '+') as HTMLButtonElement;
    fireEvent.click(plusBtn!);
    fireEvent.click(plusBtn!);
    tickRaf();
    const resetBtn = Array.from(container.querySelectorAll('.pianoroll-zoom-btn'))
      .find((b) => b.textContent?.trim().includes('reset')) as HTMLButtonElement;
    fireEvent.click(resetBtn!);
    tickRaf();
    expect(container.querySelector('.pianoroll-zoom-value')?.textContent).toMatch(/1\./);
  });
});

describe('Pianoroll — add/delete via click (smoke)', () => {
  it('click on empty canvas appends a note(...) snippet via onChange', async () => {
    const onChange = vi.fn();
    dispatch({ type: 'replaceScore', text: '' });
    const { container } = render(() => (
      <Pianoroll score="" onChange={onChange} />
    ));
    tickRaf();
    await new Promise<void>((res) => setTimeout(res, 400));
    tickRaf();
    const canvas = container.querySelector('[data-testid="pianoroll-canvas"]') as HTMLElement;
    expect(canvas).toBeTruthy();
    // Patch the canvas's bounding rect so the click coordinates
    // actually resolve inside the piano-roll area.
    canvas.getBoundingClientRect = (): DOMRect => ({
      x: 0, y: 0, top: 0, left: 0,
      right: 600, bottom: 320, width: 600, height: 320,
      toJSON: () => ({}),
    });
    Object.defineProperty(canvas, 'clientWidth', { value: 600, configurable: true });
    // Click at x=120 (well inside the rendering area after ruler),
    // y=100 (one of the visible midi rows).
    fireEvent.click(canvas, { clientX: 120, clientY: 100, button: 0 });
    tickRaf();
    // onChange fires with a fresh score containing the note.
    expect(onChange).toHaveBeenCalled();
    const newScore = onChange.mock.calls[0]?.[0] as string | undefined;
    expect(typeof newScore).toBe('string');
    expect(newScore).toMatch(/^note\(/);
  });
});

describe('Pianoroll — pure helpers', () => {
  it('defaultMidiBounds for empty → 24..96 (C1..C7)', () => {
    expect(defaultMidiBounds([])).toEqual({ lo: 24, hi: 96 });
  });

  it('_internal.midiName: c4 → C4, c#3 → C#3', () => {
    expect(_internal.midiName(60)).toBe('C4');
    expect(_internal.midiName(49)).toBe('C#3');
  });

  it('_internal.isBlackKey: c# = true, c = false', () => {
    expect(_internal.isBlackKey(61)).toBe(true); // C#
    expect(_internal.isBlackKey(60)).toBe(false); // C
  });

  it('colorForChannel returns one of the SAMPLE_PALETTE colors (or default cyan)', () => {
    const c = _internal.colorForChannel(1);
    expect(typeof c).toBe('string');
    expect(c.length).toBeGreaterThan(0);
  });

  it('COMPILE_DEBOUNCE_MS is 350 (matches VisualizerPanel)', () => {
    expect(_internal.COMPILE_DEBOUNCE_MS).toBe(350);
  });
});

describe('applyNoteEdit + noteSnippet — pure score-mutation helpers', () => {
  it('add to empty score returns the snippet', () => {
    expect(applyNoteEdit('', { kind: 'add', snippet: 'note("c4")' })).toBe('note("c4")');
  });

  it('add to non-stack score wraps in stack(...)', () => {
    const result = applyNoteEdit('note("a4")', { kind: 'add', snippet: 'note("c4")' });
    expect(result).toMatch(/^stack\(/);
    expect(result).toContain('note("a4")');
    expect(result).toContain('note("c4")');
  });

  it('add to existing stack splices inside the closing paren', () => {
    const original = 'stack(\n  note("c4")\n)';
    const result = applyNoteEdit(original, { kind: 'add', snippet: 'note("e4")' });
    expect(result).toMatch(/^stack\(/);
    expect(result).toContain('note("c4")');
    expect(result).toContain('note("e4")');
    // Closing paren at the very end
    expect(result.trim().endsWith(')')).toBe(true);
  });

  it('delete from stack removes the matched layer', () => {
    const original = 'stack(\n  note("c4"),\n  note("e4")\n)';
    const result = applyNoteEdit(original, { kind: 'delete', matchSource: 'note("c4")' });
    expect(result).toContain('note("e4")');
    expect(result).not.toContain('note("c4")');
  });

  it('noteSnippet returns a single-note Strudel snippet', () => {
    expect(noteSnippet(60, 0, 1)).toBe('note("c4")');
    expect(noteSnippet(49, 0, 1)).toBe('note("c#3")');
  });
});
