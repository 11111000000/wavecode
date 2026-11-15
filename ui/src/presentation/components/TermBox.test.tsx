import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import type { TermHit } from '~/domain/gesture/term';

/**
 * <TermBox /> — the visual term box: the 4×8 grid, the target length, the
 * gesture→row legend and the three actions.
 *
 * The camera and the audio engine are mocked; the hits are pushed straight
 * into the store signal — the box only renders them.
 */

const mocks = vi.hoisted(() => ({
  previewSample: vi.fn(),
  setLiveParam: vi.fn(),
}));

vi.mock('~/infrastructure/gesture/GestureCapture', () => ({
  startGestureCapture: vi.fn(),
}));

vi.mock('../state/audioActions', () => ({
  previewSample: mocks.previewSample,
  scheduleGridEdit: vi.fn(),
}));

vi.mock('~/infrastructure/composition', async () => {
  const { Effect, Layer } = await import('effect');
  const { AudioEngine } = await import('~/domain/services');
  return {
    AppLayer: Layer.succeed(AudioEngine, {
      eval: () => Effect.void,
      stop: () => Effect.void,
      compileAndQuery: () => Effect.succeed([]),
      setCps: () => Effect.void,
      setLayerMix: () => Effect.void,
      setScore: () => Effect.void,
      setLiveParam: mocks.setLiveParam,
      getCycleProgress: () => Effect.succeed(0),
      getCyclePosition: () => Effect.succeed(0),
      getActiveHaps: () => Effect.succeed([]),
      recordLive: () => Effect.die('not used'),
      renderOffline: () => Effect.die('not used'),
    }),
  };
});

import { TermBox } from './TermBox';
import {
  clearGestureTermHits,
  gestureTermTarget,
  setGestureTermHits,
  setGestureTermMode,
  setGestureTermTarget,
} from '../state/gestureStore';

const hit = (sample: TermHit['sample'], col: number): TermHit => ({
  sample,
  col,
  cycleIndex: 0,
  offsetMs: col * 125,
  tsMs: 1000 + col * 125,
});

describe('TermBox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGestureTermHits();
    setGestureTermMode(true);
    setGestureTermTarget(8);
  });

  afterEach(() => {
    cleanup();
    clearGestureTermHits();
    setGestureTermMode(false);
  });

  it('renders the 4×8 grid, the gesture legend and the target lengths', () => {
    const { container } = render(() => <TermBox />);

    // 4 строки × 8 долей.
    expect(container.querySelectorAll('.gesture-term-row')).toHaveLength(4);
    expect(container.querySelectorAll('.gesture-term-cell')).toHaveLength(32);

    // Легенда «жест → строка».
    expect(container.querySelectorAll('.gesture-term-chip')).toHaveLength(4);

    // Целевая длина: 4 / 8 / 16 ударов.
    expect(container.querySelectorAll('.gesture-term-target-btn')).toHaveLength(3);
    expect(container.querySelector('[data-cta="term-target-8"]')?.getAttribute('data-active')).toBe(
      'true',
    );
  });

  it('marks the cells the recorded hits landed on', () => {
    setGestureTermHits([hit('bd', 0), hit('hh', 3)]);
    const { container } = render(() => <TermBox />);

    const active = Array.from(container.querySelectorAll('.gesture-term-cell')).filter(
      (cell) => cell.getAttribute('data-active') === 'true',
    );
    expect(active).toHaveLength(2);

    // Строка бочки (0) — первая доля, строка хай-хэта (2) — четвёртая.
    const rows = Array.from(container.querySelectorAll('.gesture-term-row'));
    expect(rows[0]?.querySelectorAll('[data-active="true"]')).toHaveLength(1);
    expect(rows[2]?.querySelectorAll('[data-active="true"]')).toHaveLength(1);
  });

  it('shows the progress against the target length', () => {
    setGestureTermHits([hit('bd', 0), hit('sd', 2)]);
    const { container } = render(() => <TermBox />);

    const progress = container.querySelector('[data-testid="term-progress"]');
    expect(progress?.textContent).toContain('2 / 8');
    expect(progress?.getAttribute('data-complete')).toBe('false');
  });

  it('marks the progress as complete when the target length is reached', () => {
    setGestureTermTarget(4);
    setGestureTermHits([hit('bd', 0), hit('sd', 1), hit('hh', 2), hit('cp', 3)]);
    const { container } = render(() => <TermBox />);

    const progress = container.querySelector('[data-testid="term-progress"]');
    expect(progress?.getAttribute('data-complete')).toBe('true');
  });

  it('switches the target length', () => {
    const { container } = render(() => <TermBox />);

    fireEvent.click(container.querySelector('[data-cta="term-target-16"]') as HTMLElement);

    expect(gestureTermTarget()).toBe(16);
  });

  it('plays the recorded rhythm back', async () => {
    setGestureTermHits([hit('bd', 0)]);
    const { container } = render(() => <TermBox />);

    fireEvent.click(container.querySelector('[data-cta="term-preview"]') as HTMLElement);

    // Прослушивание расставляет удары по таймерам — ждём их.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(mocks.previewSample).toHaveBeenCalledWith('bd');
  });

  it('disables the actions while nothing is recorded', () => {
    const { container } = render(() => <TermBox />);

    for (const cta of ['term-preview', 'term-commit', 'term-clear']) {
      const button = container.querySelector(`[data-cta="${cta}"]`) as HTMLButtonElement | null;
      expect(button?.disabled).toBe(true);
    }
  });

  it('enables the actions once something is recorded', () => {
    setGestureTermHits([hit('bd', 0)]);
    const { container } = render(() => <TermBox />);

    for (const cta of ['term-preview', 'term-commit', 'term-clear']) {
      const button = container.querySelector(`[data-cta="${cta}"]`) as HTMLButtonElement | null;
      expect(button?.disabled).toBe(false);
    }
  });
});
