import { describe, it, expect } from 'vitest';
import {
  RHYTHM_ROWS,
  RHYTHM_STEPS_PER_BAR,
  ONSET_TO_ROW,
  ROW_TO_SAMPLE,
  stepMsForCps,
  quantizeHitsToGrid,
  rhythmGridToSnippet,
  estimateTapTempoBpm,
} from './rhythmGrid';
import type { Transient } from './transient';

const hit = (
  type: Transient['type'],
  startMs: number,
): Transient => ({
  type,
  startMs,
  amplitude: 0.4,
  spectralCentroidHz: 1000,
  envelopeMs: 30,
});

describe('rhythmGrid — step duration', () => {
  it('derives the step duration from the transport tempo', () => {
    // 0.5 cps = 2 s per bar = 125 ms per 16th note.
    expect(stepMsForCps(0.5)).toBe(125);
    // 1 cps = 1 s per bar = 62.5 ms per step.
    expect(stepMsForCps(1)).toBe(62.5);
  });

  it('clamps absurd tempos instead of producing a zero-length step', () => {
    expect(stepMsForCps(0)).toBe(stepMsForCps(0.5));
    expect(stepMsForCps(-3)).toBe(stepMsForCps(0.5));
    expect(stepMsForCps(Number.NaN)).toBe(stepMsForCps(0.5));
    expect(stepMsForCps(1000)).toBe(stepMsForCps(10));
  });
});

describe('rhythmGrid — quantisation', () => {
  it('returns null for an empty hit list', () => {
    expect(quantizeHitsToGrid([], { stepMs: 125 })).toBeNull();
  });

  it('puts the first hit on step 0 and the next one a step later', () => {
    const grid = quantizeHitsToGrid(
      [hit('kick', 1000), hit('snare', 1125)],
      { stepMs: 125 },
    );
    expect(grid).not.toBeNull();
    expect(grid!.originMs).toBe(1000);
    expect(grid!.steps).toBe(RHYTHM_STEPS_PER_BAR);
    expect(grid!.bars).toBe(1);
    expect(grid!.rows[0]![0]).toBe(true);
    expect(grid!.rows[1]![1]).toBe(true);
    expect(grid!.hitCount).toBe(2);
  });

  it('snaps a hit to the NEAREST step (the error is at most half a step)', () => {
    // The first hit anchors the origin; the second one is measured
    // against it. 60 ms late → step 0 (below the 62.5 ms boundary).
    const early = quantizeHitsToGrid(
      [hit('kick', 1000), hit('snare', 1060)],
      { stepMs: 125 },
    );
    expect(early!.rows[1]![0]).toBe(true);
    // 70 ms late → step 1 (past the half-step boundary).
    const late = quantizeHitsToGrid(
      [hit('kick', 1000), hit('snare', 1070)],
      { stepMs: 125 },
    );
    expect(late!.rows[1]![1]).toBe(true);
  });

  it('spans whole bars — a hit on the 17th step opens a second bar', () => {
    const grid = quantizeHitsToGrid(
      [hit('kick', 0), hit('hat', 16 * 125)],
      { stepMs: 125 },
    );
    expect(grid!.bars).toBe(2);
    expect(grid!.steps).toBe(32);
    expect(grid!.rows[0]![0]).toBe(true);
    expect(grid!.rows[2]![16]).toBe(true);
  });

  it('counts hits that collapsed onto the same voice and step', () => {
    const grid = quantizeHitsToGrid(
      [hit('kick', 0), hit('kick', 10)],
      { stepMs: 125 },
    );
    expect(grid!.hitCount).toBe(1);
    expect(grid!.mergedHits).toBe(1);
  });

  it('keeps different voices that land on the same step', () => {
    const grid = quantizeHitsToGrid(
      [hit('kick', 0), hit('click', 5)],
      { stepMs: 125 },
    );
    expect(grid!.hitCount).toBe(2);
    expect(grid!.mergedHits).toBe(0);
    expect(grid!.rows[0]![0]).toBe(true);
    expect(grid!.rows[3]![0]).toBe(true);
  });

  it('uses the EARLIEST hit as the origin, not the first in the array', () => {
    const grid = quantizeHitsToGrid(
      [hit('kick', 500), hit('snare', 0), hit('hat', 125)],
      { stepMs: 125 },
    );
    expect(grid!.originMs).toBe(0);
    expect(grid!.rows[0]![4]).toBe(true);
    expect(grid!.rows[1]![0]).toBe(true);
    expect(grid!.rows[2]![1]).toBe(true);
  });

  it('maps every onset type onto one of the four rows', () => {
    for (const row of RHYTHM_ROWS) {
      expect(Object.values(ONSET_TO_ROW)).toContain(row);
    }
    expect(ROW_TO_SAMPLE.bd).toBe('drums_bd');
    expect(ROW_TO_SAMPLE.cp).toBe('drums_cp');
  });
});

describe('rhythmGrid — snippet', () => {
  it('emits one s() layer per voice that has hits', () => {
    const grid = quantizeHitsToGrid(
      [hit('kick', 0), hit('snare', 250)],
      { stepMs: 125 },
    );
    const snippet = rhythmGridToSnippet(grid!);
    expect(snippet).not.toBeNull();
    expect(snippet!.startsWith('stack(')).toBe(true);
    expect(snippet).toContain('drums_bd');
    expect(snippet).toContain('drums_sd');
    // 16 steps per bar → 16 tokens per row.
    const row = snippet!.split('\n').find((l) => l.includes('drums_bd'))!;
    expect(row.match(/"/)![0]).toBe('"');
    expect(row.split('"')[1]!.split(' ')).toHaveLength(16);
  });

  it('emits a bare s() for a single voice', () => {
    const grid = quantizeHitsToGrid([hit('kick', 0)], { stepMs: 125 });
    const snippet = rhythmGridToSnippet(grid!);
    expect(snippet!.startsWith('s("')).toBe(true);
    expect(snippet).not.toContain('stack(');
  });

  it('omits silent voices', () => {
    const grid = quantizeHitsToGrid([hit('kick', 0)], { stepMs: 125 });
    const snippet = rhythmGridToSnippet(grid!);
    expect(snippet).not.toContain('drums_sd');
    expect(snippet).not.toContain('drums_hh');
    expect(snippet).not.toContain('drums_cp');
  });

  it('emits two bars of tokens for a two-bar pattern', () => {
    const grid = quantizeHitsToGrid(
      [hit('kick', 0), hit('hat', 16 * 125)],
      { stepMs: 125 },
    );
    const snippet = rhythmGridToSnippet(grid!);
    const row = snippet!.split('\n').find((l) => l.includes('drums_bd'))!;
    expect(row.split('"')[1]!.split(' ')).toHaveLength(32);
  });

  it('does NOT emit setCpm — the pattern plays at the transport tempo', () => {
    const grid = quantizeHitsToGrid([hit('kick', 0)], { stepMs: 125 });
    expect(rhythmGridToSnippet(grid!)).not.toContain('setCpm');
  });
});

describe('rhythmGrid — tapped tempo estimate', () => {
  it('returns null when there is not enough material', () => {
    expect(estimateTapTempoBpm([])).toBeNull();
    expect(estimateTapTempoBpm([hit('kick', 0)])).toBeNull();
  });

  it('reads a 500 ms pulse as 120 BPM', () => {
    const bpm = estimateTapTempoBpm([
      hit('kick', 0), hit('kick', 500), hit('kick', 1000), hit('kick', 1500),
    ]);
    expect(bpm).toBeCloseTo(120, 5);
  });
});
