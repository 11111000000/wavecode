import { describe, it, expect } from 'vitest';
import { quantizeToCycle } from './quantize';

const CPS = 2; // 120 bpm -> a cycle of 500 ms
const CYCLE_MS = 1000 / CPS;
const DIVISION = 4; // quarter notes
const STEP_MS = CYCLE_MS / DIVISION;

describe('quantizeToCycle', () => {
  it('never returns a time in the past', () => {
    const cases = [
      { cycleProgress: 0, cps: CPS, nowMs: 0, lookaheadMs: 120, division: DIVISION },
      { cycleProgress: 0.5, cps: CPS, nowMs: 1000, lookaheadMs: 120, division: DIVISION },
      { cycleProgress: 0.99, cps: CPS, nowMs: 250, lookaheadMs: 0, division: DIVISION },
      { cycleProgress: 0.25, cps: 0.5, nowMs: 12345, lookaheadMs: 120, division: 8 },
    ];

    for (const args of cases) {
      const result = quantizeToCycle(args);
      expect(result.timeMs).toBeGreaterThanOrEqual(args.nowMs);
      expect(result.timeMs).toBeGreaterThanOrEqual(args.nowMs + args.lookaheadMs - 1e-6);
    }
  });

  it('lands exactly on a division boundary', () => {
    const nowMs = 1000;
    const cycleProgress = 0.3;
    const cycleStart = nowMs - cycleProgress * CYCLE_MS;

    for (const lookaheadMs of [0, 40, 120, 130, 400, 1000]) {
      const result = quantizeToCycle({ cycleProgress, cps: CPS, nowMs, lookaheadMs, division: DIVISION });
      const stepsFromStart = (result.timeMs - cycleStart) / STEP_MS;
      expect(Math.abs(stepsFromStart - Math.round(stepsFromStart))).toBeLessThan(1e-6);
      // The offset is the position inside the target cycle.
      const offsetInCycle = ((result.timeMs - cycleStart) % CYCLE_MS + CYCLE_MS) % CYCLE_MS;
      expect(result.offsetMs).toBeCloseTo(offsetInCycle, 6);
      expect(result.offsetMs).toBeGreaterThanOrEqual(0);
      expect(result.offsetMs).toBeLessThan(CYCLE_MS);
    }
  });

  it('moves to the next cycle with a large lookahead', () => {
    const near = quantizeToCycle({
      cycleProgress: 0,
      cps: CPS,
      nowMs: 0,
      lookaheadMs: 120,
      division: DIVISION,
    });
    expect(near.cycleIndex).toBe(0);

    const far = quantizeToCycle({
      cycleProgress: 0,
      cps: CPS,
      nowMs: 0,
      lookaheadMs: 1200,
      division: DIVISION,
    });
    expect(far.cycleIndex).toBeGreaterThanOrEqual(1);
    expect(far.timeMs).toBeGreaterThanOrEqual(1200);
  });

  it('reports the offset inside the target cycle', () => {
    // The cycle that contains nowMs = 0 started at -250 ms, so its quarter
    // boundaries sit at -250, -125, 0, 125 and 250 ms. With a small
    // lookahead the next boundary after now + 10 ms is 125 ms.
    const result = quantizeToCycle({
      cycleProgress: 0.5,
      cps: CPS,
      nowMs: 0,
      lookaheadMs: 10,
      division: DIVISION,
    });

    expect(result.cycleIndex).toBe(0);
    expect(result.timeMs).toBeCloseTo(125, 6);
    expect(result.offsetMs).toBeCloseTo(STEP_MS * 3, 6);
  });

  it('handles a broken tempo defensively', () => {
    const result = quantizeToCycle({
      cycleProgress: 0.5,
      cps: 0,
      nowMs: 500,
      lookaheadMs: 120,
      division: DIVISION,
    });

    expect(result.cycleIndex).toBe(0);
    expect(result.offsetMs).toBe(0);
    expect(result.timeMs).toBe(500);
  });

  it('never returns a time in the past for a large cycle progress', () => {
    const result = quantizeToCycle({
      cycleProgress: 0.99,
      cps: CPS,
      nowMs: 10_000,
      lookaheadMs: 120,
      division: DIVISION,
    });

    expect(result.timeMs).toBeGreaterThanOrEqual(10_120);
  });
});
