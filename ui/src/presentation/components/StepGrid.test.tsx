import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import {
  emptyGrid,
  setCell,
  gridToScore,
  type Grid,
  GRID_ROWS,
} from '~/domain/music/gridTypes';

/**
 * StepGrid — unit tests.
 *
 * Mocks `audioActions` (previewSample + evalScore) and `effect`'s
 * `Effect.runPromise` (so the RAF progress loop deterministically
 * surfaces our `getCycleProgress` mock value).
 */

const previewSampleSpy = vi.fn();
const evalScoreSpy = vi.fn();
const getCycleProgress = vi.fn((): number => 0);
const effectRunPromiseSpy = vi.fn((..._args: unknown[]) => Promise.resolve(0));

vi.mock('../state/audioActions', () => ({
  evalScore: (...args: unknown[]) => evalScoreSpy(...args),
  previewSample: (...args: unknown[]) => previewSampleSpy(...args),
  stopAudio: vi.fn(),
  beep: vi.fn(),
}));

vi.mock('~/infrastructure/composition', () => ({
  AppLayer: { provide: () => (eff: unknown) => eff },
}));

// Mock effect so RAF progress becomes deterministic. We replace ONLY
// Effect.runPromise (returns the configurable `effectRunPromiseSpy`),
// while Effect.gen / Effect.provide stay as no-op identity functions
// that produce a chainable Effect-like value.
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

beforeEach(() => {
  previewSampleSpy.mockClear();
  evalScoreSpy.mockClear();
  getCycleProgress.mockReset().mockReturnValue(0);
  effectRunPromiseSpy.mockReset().mockImplementation((..._args: unknown[]) => Promise.resolve(getCycleProgress()));
  rafCallbacks.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Import after mocks are registered.
import { StepGrid } from './StepGrid';
import { appStore, dispatch } from '../state/appStore';
import { clearGridState, setGridDirect, getGrid } from '../state/gridState';

const SAMPLE_BY_ROW = ['bd', 'sd', 'hh', 'cp'] as const;

const rowColSelector = (row: number, col: number): string =>
  `button[aria-label="${SAMPLE_BY_ROW[row]} step ${col + 1}"]`;

const tapCell = (row: number, col: number): void => {
  const sel = rowColSelector(row, col);
  const el = document.querySelector(sel) as HTMLElement | null;
  if (!el) throw new Error(`no cell for ${row},${col} (selector=${sel})`);
  fireEvent.click(el);
};

describe('StepGrid — wavecode-step-append-sync behaviour', () => {
  it('tap a cell: previewSample called once, evalScore NOT called, score unchanged', () => {
    const originalScore = appStore.score;
    render(() => <StepGrid />);
    tapCell(0, 0);
    expect(previewSampleSpy).toHaveBeenCalledTimes(1);
    expect(previewSampleSpy).toHaveBeenCalledWith('bd');
    expect(evalScoreSpy).not.toHaveBeenCalled();
    expect(appStore.score).toBe(originalScore);
  });

  it('tap a snare cell previews "sd" (per-row routing)', () => {
    render(() => <StepGrid />);
    tapCell(1, 0);
    expect(previewSampleSpy).toHaveBeenCalledWith('sd');
  });

  it('tap a hihat cell previews "hh"', () => {
    render(() => <StepGrid />);
    tapCell(2, 0);
    expect(previewSampleSpy).toHaveBeenCalledWith('hh');
  });

  it('tap a clap cell previews "cp"', () => {
    render(() => <StepGrid />);
    tapCell(3, 0);
    expect(previewSampleSpy).toHaveBeenCalledWith('cp');
  });

  it('↑ load & play with empty editor: replaces score with grid snippet and evals', () => {
    clearGridState();
    dispatch({ type: 'replaceScore', text: '' });
    const expected = gridToScore(getGrid());
    render(() => <StepGrid />);
    const button = Array.from(document.querySelectorAll('.step-grid-btn-primary')).find(
      (b) => b.textContent?.includes('load'),
    ) as HTMLElement;
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(appStore.score).toBe(expected);
    expect(evalScoreSpy).toHaveBeenCalledTimes(1);
  });

  it('↑ load & play with non-empty editor: wraps existing score + grid in a stack(...)', () => {
    clearGridState();
    dispatch({ type: 'replaceScore', text: 'note("c4")' });
    // Place a cell into the grid so the grid snippet is non-empty.
    const g: Grid = setCell(emptyGrid(), 0, 0, true);
    setGridDirect(g);
    render(() => <StepGrid />);
    const button = Array.from(document.querySelectorAll('.step-grid-btn-primary')).find(
      (b) => b.textContent?.includes('load'),
    ) as HTMLElement;
    fireEvent.click(button);
    expect(appStore.score).toMatch(/^stack\(/);
    expect(appStore.score).toContain('note("c4")');
    expect(appStore.score).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
    expect(evalScoreSpy).toHaveBeenCalledTimes(1);
  });

  it('↑ load & play with top-level stack editor: splices grid layer inside (no double-wrap)', () => {
    clearGridState();
    const existing = 'stack(\n  note("c4"),\n  s("hh hh")\n)';
    dispatch({ type: 'replaceScore', text: existing });
    const g = setCell(emptyGrid(), 1, 0, true); // sd at col 0
    setGridDirect(g);
    render(() => <StepGrid />);
    const button = Array.from(document.querySelectorAll('.step-grid-btn-primary')).find(
      (b) => b.textContent?.includes('load'),
    ) as HTMLElement;
    fireEvent.click(button);
    // Should contain both original layers AND grid layers, not duplicate stack.
    expect(appStore.score).toContain('note("c4")');
    expect(appStore.score).toContain('s("hh hh")');
    // row 1 col 0 = sd step 0 → s("sd ~ ~ ~ ~ ~ ~ ~")
    expect(appStore.score).toMatch(/s\("sd ~ ~ ~ ~ ~ ~ ~"\)/);
    expect(evalScoreSpy).toHaveBeenCalledTimes(1);
  });

  it('beat() reflects AudioEngine.getCycleProgress: running=0 → beat=0', async () => {
    getCycleProgress.mockReturnValue(0);
    render(() => <StepGrid />);
    // Drive RAF synchronously and await pending Promise resolutions.
    for (let i = 0; i < 5 && i < rafCallbacks.length; i += 1) {
      rafCallbacks[i]?.(performance.now() + 16);
    }
    await Promise.resolve();
    await Promise.resolve();
    // After RAF ticks, beat() should be 0 (since progress=0).
    const cells = document.querySelectorAll('.step-cell');
    let foundBeatZero = false;
    cells.forEach((c, idx) => {
      if (idx % 8 === 0 && c.classList.contains('beat')) foundBeatZero = true;
    });
    expect(foundBeatZero).toBe(true);
  });

  it('beat() reflects AudioEngine.getCycleProgress: progress=0.5 → beat=4', async () => {
    getCycleProgress.mockReturnValue(0.5);
    render(() => <StepGrid />);
    for (let i = 0; i < 5 && i < rafCallbacks.length; i += 1) {
      rafCallbacks[i]?.(performance.now() + 16);
    }
    await Promise.resolve();
    await Promise.resolve();
    // 0.5 * 8 = 4.0 → beat()=4 → column 4 gets the .beat class.
    const cells = document.querySelectorAll('.step-cell');
    let foundBeatFour = false;
    cells.forEach((c, idx) => {
      if (idx === 4 && c.classList.contains('beat')) foundBeatFour = true;
    });
    expect(foundBeatFour).toBe(true);
  });

  it('score NOT modified by tap (only flashKey visual changes)', () => {
    clearGridState();
    dispatch({ type: 'replaceScore', text: 'note("c4")' });
    const before = appStore.score;
    render(() => <StepGrid />);
    tapCell(0, 1);
    tapCell(2, 3);
    expect(appStore.score).toBe(before);
  });

  it('renders the toolbar buttons (load, clear, read)', () => {
    render(() => <StepGrid />);
    expect(document.querySelector('.step-grid')).toBeTruthy();
    expect(Array.from(document.querySelectorAll('.step-grid-btn')).length).toBe(3);
  });
});

describe('StepGrid integration — grid-to-score pipeline', () => {
  it('empty grid → empty stack snippet', () => {
    const snippet = gridToScore(emptyGrid());
    expect(snippet).toContain('stack(');
    expect(snippet).toContain(')');
    for (let r = 0; r < GRID_ROWS.length; r += 1) {
      expect(snippet).toContain(`s("~ ~ ~ ~ ~ ~ ~ ~"`);
    }
  });

  it('single kick at step 0 → only first column of bd row has note', () => {
    let g = emptyGrid();
    g = setCell(g, 0, 0, true);
    const snippet = gridToScore(g);
    expect(snippet).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
    expect(snippet).toMatch(/s\("~ ~ ~ ~ ~ ~ ~ ~"\),/);
  });

  it('classic rock beat (kick-snare-kick-snare + hihat every step)', () => {
    let g = emptyGrid();
    g = setCell(g, 0, 0, true);
    g = setCell(g, 0, 2, true);
    g = setCell(g, 1, 1, true);
    g = setCell(g, 1, 3, true);
    for (let c = 0; c < 8; c += 1) g = setCell(g, 2, c, true);
    const snippet = gridToScore(g);
    expect(snippet).toMatch(/s\("bd ~ bd ~ ~ ~ ~ ~"\),/);
    expect(snippet).toMatch(/s\("~ sd ~ sd ~ ~ ~ ~"\),/);
    expect(snippet).toMatch(/s\("hh hh hh hh hh hh hh hh"\),/);
  });
});
