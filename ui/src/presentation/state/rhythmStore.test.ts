import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_RHYTHM_BPM,
  MAX_RHYTHM_BPM,
  MIN_RHYTHM_BPM,
  RHYTHM_STEPS,
  __resetRhythmForTests,
  applyRhythmToScore,
  clampRhythmBpm,
  clearRhythmTake,
  rhythmCountIn,
  rhythmPatternToSnippet,
  rhythmRunning,
  rhythmSteps,
  rhythmTempoBpm,
  setRhythmStepAt,
  setRhythmTempo,
  startRhythmTake,
  stopRhythmTake,
  toggleRhythmStep,
} from './rhythmStore';
import { appStore, dispatch } from './appStore';

/**
 * rhythmStore tests — the rhythm GENERATOR and the take it produces.
 *
 * Coverage:
 *   1. A 16-step tap pattern becomes the expected Strudel fragment.
 *   2. The tempo is applied to the fragment (`setCpm(bpm / 4)`) and
 *      clamped to a sane range.
 *   3. Clearing resets the take (grid, clock, count-in).
 *   4. Applying the take writes into the score through the EXISTING
 *      path — `appendToTopStack` + `dispatch({type: 'replaceScore'})`.
 */

/** A 16-step grid with the given steps tapped. */
const pattern = (on: readonly number[]): boolean[] => {
  const cells = new Array<boolean>(RHYTHM_STEPS).fill(false);
  for (const i of on) cells[i] = true;
  return cells;
};

beforeEach(() => {
  __resetRhythmForTests();
  dispatch({ type: 'replaceScore', text: '' });
});

afterEach(() => {
  __resetRhythmForTests();
});

describe('rhythmPatternToSnippet — the generator', () => {
  it('turns a 16-step tap pattern into the expected Strudel fragment', () => {
    const snippet = rhythmPatternToSnippet(pattern([0, 4, 8, 12]), 120);
    expect(snippet).toBe(
      'setCpm(30.000).s("drums_bd ~ ~ ~ drums_sd ~ ~ ~ '
      + 'drums_bd ~ ~ ~ drums_sd ~ ~ ~")',
    );
  });

  it('keeps the taps and only the taps — untapped steps are rests', () => {
    const snippet = rhythmPatternToSnippet(pattern([2, 10]), 120);
    expect(snippet).toBe(
      'setCpm(30.000).s("~ ~ drums_hh ~ ~ ~ ~ ~ ~ ~ drums_hh ~ ~ ~ ~ ~")',
    );
  });

  it('applies the tempo: setCpm is bpm / 4 (1 cycle = 1 bar of 4 beats)', () => {
    expect(rhythmPatternToSnippet(pattern([0]), 90)).toContain('setCpm(22.500)');
    expect(rhythmPatternToSnippet(pattern([0]), 150)).toContain('setCpm(37.500)');
  });

  it('has nothing to say about an empty grid', () => {
    expect(rhythmPatternToSnippet(pattern([]), 120)).toBeNull();
  });

  it('refuses a grid that is not a full bar', () => {
    expect(rhythmPatternToSnippet([true, false, true], 120)).toBeNull();
  });
});

describe('rhythmStore — the tempo', () => {
  it('clamps the tempo to a sane range', () => {
    setRhythmTempo(10);
    expect(rhythmTempoBpm()).toBe(MIN_RHYTHM_BPM);

    setRhythmTempo(9999);
    expect(rhythmTempoBpm()).toBe(MAX_RHYTHM_BPM);

    setRhythmTempo(137);
    expect(rhythmTempoBpm()).toBe(137);
  });

  it('clamps a broken value back to the default tempo', () => {
    // Нечисловое значение — это «темпа не задана», а не «темпа за
    // пределами»: возвращаем рабочее значение по умолчанию.
    expect(clampRhythmBpm(Number.NaN)).toBe(DEFAULT_RHYTHM_BPM);
    expect(clampRhythmBpm(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RHYTHM_BPM);
  });
});

describe('rhythmStore — the take', () => {
  it('starts with an empty grid and no clock running', () => {
    expect(rhythmSteps()).toHaveLength(RHYTHM_STEPS);
    expect(rhythmSteps().every((on) => on === false)).toBe(true);
    expect(rhythmRunning()).toBe(false);
    expect(rhythmCountIn()).toBe(0);
  });

  it('counts in before the pass over the grid starts', () => {
    startRhythmTake();
    expect(rhythmRunning()).toBe(true);
    expect(rhythmCountIn()).toBeGreaterThan(0);
    stopRhythmTake();
    expect(rhythmRunning()).toBe(false);
    expect(rhythmCountIn()).toBe(0);
  });

  it('tapping a cell toggles it, and out-of-range cells are ignored', () => {
    toggleRhythmStep(3);
    expect(rhythmSteps()[3]).toBe(true);
    toggleRhythmStep(3);
    expect(rhythmSteps()[3]).toBe(false);

    setRhythmStepAt(99, true);
    expect(rhythmSteps()).toHaveLength(RHYTHM_STEPS);
    expect(rhythmSteps().every((on) => on === false)).toBe(true);
  });

  it('clearing resets the take', () => {
    setRhythmStepAt(0, true);
    setRhythmStepAt(7, true);
    startRhythmTake();
    expect(rhythmRunning()).toBe(true);

    clearRhythmTake();

    expect(rhythmSteps().every((on) => on === false)).toBe(true);
    expect(rhythmRunning()).toBe(false);
    expect(rhythmCountIn()).toBe(0);
  });
});

describe('rhythmStore — applying to the score', () => {
  it('writes the pattern into the score through the existing path', () => {
    setRhythmStepAt(0, true);
    setRhythmStepAt(8, true);

    const applied = applyRhythmToScore();

    expect(applied).toBe(true);
    expect(appStore.score).toContain('setCpm(30.000)');
    expect(appStore.score).toContain('drums_bd');
    // The grid is clean afterwards — the same take is not inserted twice.
    expect(rhythmSteps().every((on) => on === false)).toBe(true);
  });

  it('refuses an empty grid instead of writing silence into the score', () => {
    const applied = applyRhythmToScore();
    expect(applied).toBe(false);
    expect(appStore.score).toBe('');
  });
});
