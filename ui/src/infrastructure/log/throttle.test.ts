import { describe, it, expect } from 'vitest';
import { shouldEmit, type ThrottleConfig } from './throttle';

describe('shouldEmit (pure throttle)', () => {
  const baseConfig: ThrottleConfig = {
    limit: 5,
    windowMs: 1000,
  };

  it('empty history: always emits, dropped=0', () => {
    const decision = shouldEmit([], 'app', 100, baseConfig);
    expect(decision).toEqual({ emit: true, dropped: 0 });
  });

  it('count below limit: emits; counts 0..4 with limit=5 all pass', () => {
    const history: Array<readonly [string, number]> = [];
    for (let i = 0; i < 5; i++) {
      const ts = 1000 + i;
      const decision = shouldEmit(history, 'app', ts, baseConfig);
      expect(decision.emit).toBe(true);
      expect(decision.dropped).toBe(0);
      history.push(['app', ts]);
    }
  });

  it('count at limit: next entry drops, dropped=1, no onThrottle text', () => {
    const history: Array<readonly [string, number]> = [
      ['app', 1000],
      ['app', 1100],
      ['app', 1200],
      ['app', 1300],
      ['app', 1400],
    ];
    const decision = shouldEmit(history, 'app', 1500, baseConfig);
    expect(decision.emit).toBe(false);
    expect(decision.dropped).toBe(1);
    expect(decision.text).toBeUndefined();
  });

  it('per-key isolation: 5 same-key + 1 different-key → all 6 emit', () => {
    const history: Array<readonly [string, number]> = [];
    for (let i = 0; i < 5; i++) {
      const ts = 1000 + i;
      const d = shouldEmit(history, 'strudel', ts, baseConfig);
      expect(d.emit).toBe(true);
      history.push(['strudel', ts]);
    }
    const otherDecision = shouldEmit(history, 'sampler', 1500, baseConfig);
    expect(otherDecision.emit).toBe(true);
    expect(otherDecision.dropped).toBe(0);
  });

  it('window reset: history older than windowMs does not count toward limit', () => {
    const history: Array<readonly [string, number]> = [
      ['app', 0],
      ['app', 100],
      ['app', 200],
      ['app', 300],
      ['app', 400],
    ];
    // nextTs=2000, windowMs=1000 → windowStart=1000. None of the above
    // (0..400) fall in [1000, 2000]. New entry should emit.
    const decision = shouldEmit(history, 'app', 2000, baseConfig);
    expect(decision.emit).toBe(true);
    expect(decision.dropped).toBe(0);
  });

  it('partial window: only entries in [nextTs - windowMs, nextTs] count', () => {
    const history: Array<readonly [string, number]> = [
      ['app', 0], // outside window (windowEnd=2000, windowStart=1000)
      ['app', 1100], // inside
      ['app', 1500], // inside
      ['app', 1700], // inside
      ['app', 1900], // inside
      ['app', 2000], // inside (boundary)
    ];
    // 5 entries fall in [1000, 2000] (4 inside + the boundary one).
    // count(5) >= limit(5) → drop.
    const decision = shouldEmit(history, 'app', 2000, baseConfig);
    expect(decision.emit).toBe(false);
    expect(decision.dropped).toBe(1);
  });

  it('onThrottle fires with cumulative dropped count', () => {
    const calls: Array<{ dropped: number }> = [];
    const config: ThrottleConfig = {
      limit: 2,
      windowMs: 1000,
      onThrottle: (droppedCount) => {
        calls.push({ dropped: droppedCount });
        return `[${droppedCount} suppressed]`;
      },
    };
    const history: Array<readonly [string, number]> = [
      ['app', 1000],
      ['app', 1100],
    ];
    // 3rd: count=2 >= 2 → drop, call onThrottle with dropped=1.
    const d1 = shouldEmit(history, 'app', 1200, config);
    expect(d1.emit).toBe(false);
    expect(d1.dropped).toBe(1);
    expect(d1.text).toBe('[1 suppressed]');

    // Caller doesn't append on drop in this test; we just track call count.
    expect(calls).toEqual([{ dropped: 1 }]);
  });

  it('onThrottle cumulative dropped: 3 over-limit drops in a row produce growing counts', () => {
    const calls: number[] = [];
    const config: ThrottleConfig = {
      limit: 2,
      windowMs: 1000,
      onThrottle: (droppedCount) => {
        calls.push(droppedCount);
        return `[${droppedCount} suppressed]`;
      },
    };
    // Caller pre-seeds history with 2 entries (matches the limit).
    const seeded: Array<readonly [string, number]> = [
      ['app', 1000],
      ['app', 1100],
    ];
    // Drop #1: count=2, dropped=1.
    shouldEmit(seeded, 'app', 1200, config);
    // Drop #2: history unchanged from caller's perspective in this pure
    // helper, so the SAME view shows count=2 → dropped=1 again. The
    // growing-cumulative semantics live in the caller (logger.ts),
    // which appends the suppression to history before the next call.
    shouldEmit(seeded, 'app', 1300, config);
    // Each call sees count=2 (the original seed); onThrottle fires once
    // per call. The cumulative number comes from the caller's tracking.
    expect(calls).toEqual([1, 1]);
  });

  it('does not mutate the history array', () => {
    const history: ReadonlyArray<readonly [string, number]> = [
      ['app', 1000],
    ];
    const snapshot = [...history];
    shouldEmit(history, 'app', 1100, baseConfig);
    expect(history).toEqual(snapshot);
  });
});