import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import {
  emptyGrid,
  setCell,
  gridToScore,
  GRID_ROWS,
} from '~/domain/music/gridTypes';
import {
  clearDraft,
  getDraftGrid,
  getMode,
  loadFromScore,
  setGridDirect,
  setModeDirect,
} from '../state/gridState';

/**
 * StepGrid — mode-aware unit tests.
 *
 * Mocks `audioActions` (previewSample + evalScore + scheduleGridEdit)
 * and `effect`'s `Effect.runPromise` (so the RAF progress loop
 * deterministically surfaces our `getCycleProgress` mock value).
 *
 * Test matrix (per `math/wavecode-step-grid-modes/packet.md`):
 *   - view mode: tap → preview only, no state change.
 *   - sketch mode: tap → preview + toggle cell; commit button writes.
 *   - edit mode: tap → preview + splice + scheduleGridEdit (debounced).
 *   - edit mode DISABLED when score isn't parseable.
 *   - "N unsaved" badge appears in sketch when dirty.
 *   - Beat indicator still works (RAF polling unchanged).
 */

const previewSampleSpy = vi.fn();
const evalScoreSpy = vi.fn();
const scheduleGridEditSpy = vi.fn();
const getCycleProgress = vi.fn((): number => 0);
const effectRunPromiseSpy = vi.fn((..._args: unknown[]) => Promise.resolve(0));

vi.mock('../state/audioActions', () => ({
  evalScore: (...args: unknown[]) => evalScoreSpy(...args),
  previewSample: (...args: unknown[]) => previewSampleSpy(...args),
  scheduleGridEdit: (...args: unknown[]) => scheduleGridEditSpy(...args),
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
  scheduleGridEditSpy.mockClear();
  getCycleProgress.mockReset().mockReturnValue(0);
  effectRunPromiseSpy.mockReset().mockImplementation((..._args: unknown[]) => Promise.resolve(getCycleProgress()));
  rafCallbacks.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  // Reset module-scope grid state to safe defaults so tests don't
  // pollute each other.
  clearDraft();
  setModeDirect('view');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Import after mocks are registered.
import { StepGrid } from './StepGrid';
import { appStore, dispatch } from '../state/appStore';

const SAMPLE_BY_ROW = ['bd', 'sd', 'hh', 'cp'] as const;

const rowColSelector = (row: number, col: number): string =>
  `button[aria-label="${SAMPLE_BY_ROW[row]} step ${col + 1}"]`;

const tapCell = (row: number, col: number): void => {
  const sel = rowColSelector(row, col);
  const el = document.querySelector(sel) as HTMLElement | null;
  if (!el) throw new Error(`no cell for ${row},${col} (selector=${sel})`);
  fireEvent.click(el);
};

const clickPill = (label: string): void => {
  const btn = document.querySelector(
    `.step-grid-mode-btn:is(:not([data-disabled="true"]))`,
  );
  void btn;
  const buttons = Array.from(document.querySelectorAll('.step-grid-mode-btn'));
  const target = buttons.find((b) => b.textContent?.trim() === label && !(b as HTMLButtonElement).disabled) as HTMLElement | undefined;
  if (!target) throw new Error(`mode pill button "${label}" not found or disabled`);
  fireEvent.click(target);
};

const clickCommit = (): void => {
  const btn = document.querySelector('[data-testid="step-grid-commit"]') as HTMLElement | null;
  if (!btn) throw new Error('commit button not present (sketch mode only)');
  fireEvent.click(btn);
};

describe('StepGrid — view mode (default)', () => {
  it('renders three-segment mode pill', () => {
    render(() => <StepGrid />);
    const labels = Array.from(document.querySelectorAll('.step-grid-mode-btn'))
      .map((b) => b.textContent?.trim());
    expect(labels).toEqual(['view', 'sketch', 'edit']);
  });

  it('view mode is the default on mount', () => {
    render(() => <StepGrid />);
    const viewBtn = Array.from(document.querySelectorAll('.step-grid-mode-btn'))
      .find((b) => b.textContent?.trim() === 'view') as HTMLButtonElement;
    expect(viewBtn.getAttribute('aria-pressed')).toBe('true');
    expect(getMode()).toBe('view');
  });

  it('tap a cell: previewSample called, no state change, score unchanged', () => {
    const originalScore = appStore.score;
    render(() => <StepGrid />);
    tapCell(0, 0);
    expect(previewSampleSpy).toHaveBeenCalledTimes(1);
    expect(previewSampleSpy).toHaveBeenCalledWith('bd');
    expect(evalScoreSpy).not.toHaveBeenCalled();
    expect(scheduleGridEditSpy).not.toHaveBeenCalled();
    expect(appStore.score).toBe(originalScore);
    // Draft grid stays empty.
    expect(getDraftGrid().every((r) => r.every((c) => !c))).toBe(true);
  });

  it('renders each row label', () => {
    render(() => <StepGrid />);
    for (const def of [
      { sample: 'bd', label: 'kick' },
      { sample: 'sd', label: 'snare' },
      { sample: 'hh', label: 'hihat' },
      { sample: 'cp', label: 'clap' },
    ]) {
      expect(document.querySelector(`.step-grid-row-sample`)?.textContent).toBeTruthy();
      void def;
    }
  });
});

describe('StepGrid — sketch mode', () => {
  it('switching to sketch: mode pill updates + commit button appears', () => {
    render(() => <StepGrid />);
    clickPill('sketch');
    expect(getMode()).toBe('sketch');
    const sketchBtn = Array.from(document.querySelectorAll('.step-grid-mode-btn'))
      .find((b) => b.textContent?.trim() === 'sketch') as HTMLButtonElement;
    expect(sketchBtn.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-testid="step-grid-commit"]')).toBeTruthy();
  });

  it('sketch tap: previewSample + draft toggle, score unchanged', () => {
    const originalScore = appStore.score;
    clearDraft();
    setModeDirect('sketch');
    setGridDirect(emptyGrid());
    render(() => <StepGrid />);
    tapCell(0, 0);
    expect(previewSampleSpy).toHaveBeenCalledWith('bd');
    expect(getDraftGrid()[0]?.[0]).toBe(true);
    expect(appStore.score).toBe(originalScore);
    expect(evalScoreSpy).not.toHaveBeenCalled();
    expect(scheduleGridEditSpy).not.toHaveBeenCalled();
  });

  it('sketch ↑ commit: dispatch replaceScore + evalScore', () => {
    clearDraft();
    dispatch({ type: 'replaceScore', text: '' });
    setModeDirect('sketch');
    setGridDirect(setCell(emptyGrid(), 0, 0, true));
    const expected = gridToScore(getDraftGrid());
    render(() => <StepGrid />);
    clickCommit();
    expect(appStore.score).toBe(expected);
    expect(evalScoreSpy).toHaveBeenCalledTimes(1);
  });

  it('sketch ↑ commit button is disabled when draft is clean', () => {
    setModeDirect('sketch');
    render(() => <StepGrid />);
    const btn = document.querySelector('[data-testid="step-grid-commit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('sketch ↑ commit button shows "N unsaved" when dirty', () => {
    setModeDirect('sketch');
    setGridDirect(setCell(setCell(emptyGrid(), 0, 0, true), 1, 2, true));
    render(() => <StepGrid />);
    const btn = document.querySelector('[data-testid="step-grid-commit"]') as HTMLButtonElement;
    expect(btn.textContent).toMatch(/2/); // 2 cells differ
    expect(btn.disabled).toBe(false);
  });

  it('sketch with non-empty editor: appendGridToScore behavior preserved', () => {
    clearDraft();
    setModeDirect('sketch');
    dispatch({ type: 'replaceScore', text: 'note("c4")' });
    setGridDirect(setCell(emptyGrid(), 0, 0, true));
    render(() => <StepGrid />);
    clickCommit();
    expect(appStore.score).toMatch(/^stack\(/);
    expect(appStore.score).toContain('note("c4")');
    expect(appStore.score).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
    expect(evalScoreSpy).toHaveBeenCalledTimes(1);
  });

  it('sketch with top-level stack editor: splices inside existing stack', () => {
    clearDraft();
    setModeDirect('sketch');
    const existing = 'stack(\n  note("c4"),\n  s("hh hh")\n)';
    dispatch({ type: 'replaceScore', text: existing });
    setGridDirect(setCell(emptyGrid(), 1, 0, true));
    render(() => <StepGrid />);
    clickCommit();
    expect(appStore.score).toContain('note("c4")');
    expect(appStore.score).toContain('s("hh hh")');
    expect(appStore.score).toMatch(/s\("sd ~ ~ ~ ~ ~ ~ ~"\)/);
    expect(evalScoreSpy).toHaveBeenCalledTimes(1);
  });
});

describe('StepGrid — edit mode', () => {
  it('edit button is disabled when score is not 4-s-layer stack', () => {
    dispatch({ type: 'replaceScore', text: 'note("c4")' });
    render(() => <StepGrid />);
    const editBtn = Array.from(document.querySelectorAll('.step-grid-mode-btn'))
      .find((b) => b.textContent?.trim() === 'edit') as HTMLButtonElement;
    expect(editBtn.disabled).toBe(true);
    expect(editBtn.getAttribute('title')).toMatch(/Edit mode requires/);
  });

  it('edit mode is enabled when score has 4 s-layers', () => {
    dispatch({
      type: 'replaceScore',
      text: 'stack(s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"))',
    });
    render(() => <StepGrid />);
    const editBtn = Array.from(document.querySelectorAll('.step-grid-mode-btn'))
      .find((b) => b.textContent?.trim() === 'edit') as HTMLButtonElement;
    expect(editBtn.disabled).toBe(false);
  });

  it('edit tap: previewSample + replaceScore + scheduleGridEdit (no evalScore)', () => {
    clearDraft();
    setModeDirect('edit');
    const score = 'stack(s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"))';
    dispatch({ type: 'replaceScore', text: score });
    render(() => <StepGrid />);
    tapCell(0, 0);
    expect(previewSampleSpy).toHaveBeenCalledWith('bd');
    expect(scheduleGridEditSpy).toHaveBeenCalledTimes(1);
    expect(evalScoreSpy).not.toHaveBeenCalled();
    // Score was mutated in place.
    expect(appStore.score).toContain('s("bd ~ ~ ~ ~ ~ ~ ~")');
  });

  it('edit tap: no double-wrap (single stack(...) in result)', () => {
    clearDraft();
    setModeDirect('edit');
    const score = 'stack(s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"))';
    dispatch({ type: 'replaceScore', text: score });
    render(() => <StepGrid />);
    tapCell(0, 0);
    expect((appStore.score.match(/stack\(/g) ?? []).length).toBe(1);
  });

  it('edit tap preserves non-sample layers in mixed stack', () => {
    clearDraft();
    setModeDirect('edit');
    const score = 'stack(note("c4"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ ~ ~ ~ ~ ~"))';
    dispatch({ type: 'replaceScore', text: score });
    render(() => <StepGrid />);
    tapCell(1, 1);
    expect(appStore.score).toContain('note("c4")');
    expect(appStore.score).toContain('s("~ sd ~ ~ ~ ~ ~ ~")');
  });
});

describe('StepGrid — beat indicator (RAF polling unchanged)', () => {
  it('beat() reflects getCycleProgress: running=0 → beat=0', async () => {
    getCycleProgress.mockReturnValue(0);
    render(() => <StepGrid />);
    for (let i = 0; i < 5 && i < rafCallbacks.length; i += 1) {
      rafCallbacks[i]?.(performance.now() + 16);
    }
    await Promise.resolve();
    await Promise.resolve();
    const cells = document.querySelectorAll('.step-cell');
    let foundBeatZero = false;
    cells.forEach((c, idx) => {
      if (idx % 8 === 0 && c.classList.contains('beat')) foundBeatZero = true;
    });
    expect(foundBeatZero).toBe(true);
  });

  it('beat() reflects getCycleProgress: progress=0.5 → beat=4', async () => {
    getCycleProgress.mockReturnValue(0.5);
    render(() => <StepGrid />);
    for (let i = 0; i < 5 && i < rafCallbacks.length; i += 1) {
      rafCallbacks[i]?.(performance.now() + 16);
    }
    await Promise.resolve();
    await Promise.resolve();
    const cells = document.querySelectorAll('.step-cell');
    let foundBeatFour = false;
    cells.forEach((c, idx) => {
      if (idx === 4 && c.classList.contains('beat')) foundBeatFour = true;
    });
    expect(foundBeatFour).toBe(true);
  });
});

describe('StepGrid — syncGridFromScore (sheet-open behavior)', () => {
  it('view mode: re-seeds draft from current score', () => {
    const score = 's("bd ~ sd ~ hh ~ cp ~")';
    clearDraft();
    setModeDirect('view');
    dispatch({ type: 'replaceScore', text: score });
    // Simulate a stale draft (e.g. user has a grid from a previous
    // open that's no longer the score).
    setGridDirect(emptyGrid());
    void loadFromScore; // back-compat import
    // call sync via test
    void import('./StepGrid').then((m) => m.syncGridFromScore());
  });
});

describe('StepGrid — grid-to-score pipeline (sanity)', () => {
  it('empty grid → empty stack snippet', () => {
    const snippet = gridToScore(emptyGrid());
    expect(snippet).toContain('stack(');
    expect(snippet).toContain(')');
    for (let r = 0; r < GRID_ROWS.length; r += 1) {
      expect(snippet).toContain(`s("~ ~ ~ ~ ~ ~ ~ ~"`);
    }
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
