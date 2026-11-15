import { describe, it, expect } from 'vitest';
import {
  TERM_GESTURE_ROWS,
  TERM_ROW_LABELS,
  TERM_TARGET_OPTIONS,
  TERM_TARGET_DEFAULT,
  buildTermGrid,
  isTermCellActive,
  isTermTarget,
  termProgress,
  termSampleForGesture,
  type TermHit,
} from './term';
import { GRID_ROWS } from '~/domain/music/gridTypes';

/**
 * Термин-бокс — доменная логика: маппинг жест→строка, прогресс записи и
 * сборка сетки. Без камеры, без аудио, без таймеров.
 */

const hit = (sample: TermHit['sample'], col: number, cycleIndex = 0): TermHit => ({
  sample,
  col,
  cycleIndex,
  offsetMs: col * 125,
  tsMs: 1000 + cycleIndex * 2000 + col * 125,
});

describe('termSampleForGesture', () => {
  it('maps every rhythmic gesture to its own grid row', () => {
    expect(termSampleForGesture('pinch')).toBe('bd');
    expect(termSampleForGesture('fist')).toBe('sd');
    expect(termSampleForGesture('openPalm')).toBe('hh');
    expect(termSampleForGesture('snap')).toBe('cp');
  });

  it('has no row for the non-rhythmic gesture', () => {
    expect(termSampleForGesture('pointUp')).toBeNull();
  });

  it('uses a distinct row per gesture', () => {
    const samples = TERM_GESTURE_ROWS.map((row) => row.sample);
    expect(new Set(samples).size).toBe(samples.length);
  });

  it('labels every row of the grid', () => {
    for (const sample of GRID_ROWS) {
      expect(TERM_ROW_LABELS[sample]).toBeTruthy();
    }
  });
});

describe('termProgress', () => {
  it('counts the hits and the remaining ones', () => {
    const progress = termProgress([hit('bd', 0), hit('hh', 3)], 4);
    expect(progress.hits).toBe(2);
    expect(progress.target).toBe(4);
    expect(progress.remaining).toBe(2);
    expect(progress.complete).toBe(false);
  });

  it('is complete once the target length is reached', () => {
    const hits = [hit('bd', 0), hit('sd', 1), hit('hh', 2), hit('cp', 3)];
    const progress = termProgress(hits, 4);
    expect(progress.complete).toBe(true);
    expect(progress.remaining).toBe(0);
  });

  it('counts the hits per row', () => {
    const progress = termProgress([hit('bd', 0), hit('bd', 4), hit('hh', 2)], 8);
    expect(progress.rows).toEqual([2, 0, 1, 0]);
  });

  it('reports how many cycles the recording touches', () => {
    const progress = termProgress([hit('bd', 0, 0), hit('sd', 4, 1)], 8);
    expect(progress.cycles).toBe(2);
  });

  it('is empty for an empty recording', () => {
    const progress = termProgress([], TERM_TARGET_DEFAULT);
    expect(progress.hits).toBe(0);
    expect(progress.cycles).toBe(0);
    expect(progress.complete).toBe(false);
  });
});

describe('buildTermGrid', () => {
  it('places every hit on its row and column', () => {
    const grid = buildTermGrid([hit('bd', 0), hit('hh', 3), hit('cp', 7)]);
    expect(isTermCellActive(grid, 0, 0)).toBe(true);
    expect(isTermCellActive(grid, 2, 3)).toBe(true);
    expect(isTermCellActive(grid, 3, 7)).toBe(true);
    expect(isTermCellActive(grid, 1, 0)).toBe(false);
  });

  it('folds the hits of different cycles onto the same cells', () => {
    const grid = buildTermGrid([hit('bd', 2, 0), hit('bd', 2, 1)]);
    expect(isTermCellActive(grid, 0, 2)).toBe(true);
  });

  it('ignores hits outside the grid', () => {
    const grid = buildTermGrid([{ ...hit('bd', 0), col: 99 }, { ...hit('bd', 0), col: -1 }]);
    expect(grid.every((row) => row.every((cell) => cell === false))).toBe(true);
  });

  it('is empty for an empty recording', () => {
    const grid = buildTermGrid([]);
    expect(grid).toHaveLength(4);
    expect(grid.every((row) => row.every((cell) => cell === false))).toBe(true);
  });
});

describe('isTermTarget', () => {
  it('accepts only the offered target lengths', () => {
    for (const target of TERM_TARGET_OPTIONS) {
      expect(isTermTarget(target)).toBe(true);
    }
    expect(isTermTarget(3)).toBe(false);
    expect(isTermTarget(0)).toBe(false);
  });
});
