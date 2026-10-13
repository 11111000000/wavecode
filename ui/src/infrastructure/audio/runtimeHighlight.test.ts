/**
 * Pure-logic + bridge-level tests for the runtime mini-notation
 * highlight bridge. The rAF / queueMicrotask plumbing is injected via
 * `__test__.setRaf` / `setNow` so we can drive the loop synchronously.
 *
 * No DOM, no AudioContext, no real patterns — just stub Hap-like
 * objects carrying `context.locations[]`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __test__,
  clearActive,
  computeRanges,
  isActive,
  setActive,
  subscribe,
  type ActiveState,
  type CharRange,
  type QueryablePattern,
} from './runtimeHighlight';

type FakeHap = { context?: { locations?: Array<{ from?: number; to?: number; start?: number; end?: number }> } };

const makePattern = (haps: ReadonlyArray<FakeHap>): QueryablePattern => ({
  queryArc: (_a: number, _b: number): ReadonlyArray<unknown> => [...haps],
});

const makeCtx = (currentTime: number): ActiveState['ctx'] => ({ currentTime });

let nowValue = 1000;
let rafQueue: Array<() => void> = [];
let rafIndex = 0;

beforeEach(() => {
  nowValue = 1000;
  rafQueue = [];
  rafIndex = 0;
  __test__.setNow(() => nowValue);
  __test__.setRaf((cb) => {
    rafQueue.push(cb);
    return ++rafIndex;
  });
  __test__.setCancelRaf(() => undefined);
  __test__.reset();
});

afterEach(() => {
  __test__.reset();
});

const tickOnce = (): void => {
  const next = rafQueue.shift();
  if (!next) throw new Error('no rAF callback queued');
  next();
};

describe('computeRanges — pure projection', () => {
  it('returns empty when no active state', () => {
    expect(computeRanges(null)).toEqual([]);
  });

  it('returns empty when cps is non-positive', () => {
    const state: ActiveState = { pattern: makePattern([]), ctx: makeCtx(5), anchor: 1, cps: 0 };
    expect(computeRanges(state)).toEqual([]);
  });

  it('returns empty when anchor is not finite', () => {
    const state: ActiveState = { pattern: makePattern([]), ctx: makeCtx(5), anchor: Number.NaN, cps: 1 };
    expect(computeRanges(state)).toEqual([]);
  });

  it('returns empty when audio ctx.currentTime is before anchor', () => {
    const state: ActiveState = { pattern: makePattern([{ context: { locations: [{ from: 1, to: 5 }] } }]), ctx: makeCtx(0.5), anchor: 1, cps: 1 };
    expect(computeRanges(state)).toEqual([]);
  });

  it('extracts locations from Hap context', () => {
    const haps: FakeHap[] = [{ context: { locations: [{ from: 10, to: 20 }] } }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    const ranges = computeRanges(state);
    expect(ranges).toEqual([[10, 20]]);
  });

  it('deduplicates overlapping identical ranges across haps', () => {
    const haps: FakeHap[] = [
      { context: { locations: [{ from: 10, to: 20 }] } },
      { context: { locations: [{ from: 10, to: 20 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    expect(computeRanges(state)).toEqual([[10, 20]]);
  });

  it('sorts ranges by `from` ascending', () => {
    const haps: FakeHap[] = [
      { context: { locations: [{ from: 30, to: 40 }] } },
      { context: { locations: [{ from: 10, to: 20 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    expect(computeRanges(state)).toEqual([[10, 20], [30, 40]]);
  });

  it('drops malformed location entries (NaN, non-finite, to<=from)', () => {
    const haps: FakeHap[] = [
      { context: { locations: [{ from: Number.NaN, to: 10 }, { from: 5, to: 5 }, { from: 1, to: -1 }, { from: 0, to: 4 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    expect(computeRanges(state)).toEqual([[0, 4]]);
  });

  it('swallows queryArc exceptions, returns empty', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pattern: QueryablePattern = { queryArc: () => { throw new Error('boom'); } };
    const state: ActiveState = { pattern, ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    expect(computeRanges(state)).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles hap without context.locations gracefully', () => {
    const haps: FakeHap[] = [{}, { context: {} }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    expect(computeRanges(state)).toEqual([]);
  });

  it('flattens multiple locations per hap', () => {
    const haps: FakeHap[] = [{ context: { locations: [{ from: 5, to: 7 }, { from: 15, to: 18 }] } }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    expect(computeRanges(state)).toEqual([[5, 7], [15, 18]]);
  });

  it('accepts anchor = 0 as a valid starting time (elapsed = ctx.currentTime)', () => {
    const haps: FakeHap[] = [{ context: { locations: [{ from: 4, to: 9 }] } }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 0.0, cps: 1 };
    // nowCycle = (2.0 - 0.0) * 1 = 2.0; queryArc(1.5, 2.5) returns haps. Expect [[4, 9]].
    expect(computeRanges(state)).toEqual([[4, 9]]);
  });

  it('accepts `start`/`end` location format (Strudel core/pattern.mjs:558)', () => {
    // `Pattern.withLoc(start, end)` stores the location as `{ start, end }`,
    // not `{ from, to }` — this is the format the runtime produces. The
    // bridge must accept both for forward-compat with older Strudel.
    const haps: FakeHap[] = [
      { context: { locations: [{ start: 30, end: 35 }] } },
      { context: { locations: [{ start: 40, end: 50 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    expect(computeRanges(state)).toEqual([[30, 35], [40, 50]]);
  });

  it('mixed `start`/`end` and `from`/`to` formats within the same result set', () => {
    // Some Haps may carry legacy `from`/`to`, others the modern `start`/`end`.
    // Both should project to CharRanges.
    const haps: FakeHap[] = [
      { context: { locations: [{ from: 5, to: 7 }] } },
      { context: { locations: [{ start: 20, end: 30 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 };
    expect(computeRanges(state)).toEqual([[5, 7], [20, 30]]);
  });
});

describe('subscribe + setActive — throttled notification', () => {
  type Mutable = QueryablePattern & { setHaps: (h: FakeHap[]) => void };

  const makeMutablePattern = (initial: FakeHap[]): Mutable => {
    let haps: FakeHap[] = [...initial];
    return {
      queryArc: () => [...haps],
      setHaps: (h) => {
        haps = [...h];
      },
    };
  };

  it('notifies when active state changes', () => {
    const cb = vi.fn();
    subscribe(cb);
    setActive({ pattern: makePattern([]), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 });

    nowValue = 1100;
    tickOnce();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toEqual<CharRange[]>([]);
  });

  it('throttles: no notification within 33ms window', () => {
    const cb = vi.fn();
    const pat = makeMutablePattern([{ context: { locations: [{ from: 1, to: 5 }] } }]);
    subscribe(cb);
    setActive({ pattern: pat, ctx: makeCtx(2.0), anchor: 1.0, cps: 1 });

    nowValue = 1050;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);

    // 10ms later — within throttle window. Even if ranges change,
    // no notification fires.
    pat.setHaps([{ context: { locations: [{ from: 2, to: 6 }] } }]);
    nowValue = 1060;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);

    // Far past throttle window (50ms+50ms gap) — if ranges still changed,
    // a second notification fires.
    pat.setHaps([{ context: { locations: [{ from: 3, to: 7 }] } }]);
    nowValue = 1300;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]![0]).toEqual([[3, 7]]);
  });

  it('deduplicates: same ranges twice in a row → one notification', () => {
    const cb = vi.fn();
    const pat = makeMutablePattern([{ context: { locations: [{ from: 1, to: 5 }] } }]);
    subscribe(cb);
    setActive({ pattern: pat, ctx: makeCtx(2.0), anchor: 1.0, cps: 1 });

    nowValue = 1050; tickOnce();
    nowValue = 1100; tickOnce();
    nowValue = 1150; tickOnce();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toEqual([[1, 5]]);
  });

  it('emits again when ranges change across throttle window', () => {
    const cb = vi.fn();
    const pat = makeMutablePattern([{ context: { locations: [{ from: 1, to: 5 }] } }]);
    subscribe(cb);
    setActive({ pattern: pat, ctx: makeCtx(2.0), anchor: 1.0, cps: 1 });

    nowValue = 1050;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toEqual([[1, 5]]);

    // Change ranges and tick past throttle.
    pat.setHaps([
      { context: { locations: [{ from: 10, to: 12 }] } },
      { context: { locations: [{ from: 20, to: 25 }] } },
    ]);
    nowValue = 1200;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]![0]).toEqual([[10, 12], [20, 25]]);
  });

  it('stops emitting after clearActive', () => {
    const cb = vi.fn();
    subscribe(cb);
    setActive({ pattern: makePattern([]), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 });
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);

    clearActive();
    nowValue = 2000;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(isActive()).toBe(false);
  });

  it('unsubscribe stops further notifications', () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    setActive({ pattern: makePattern([]), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 });
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    nowValue = 5000;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not throw if a subscriber callback throws', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = vi.fn(() => { throw new Error('subscriber crash'); });
    const good = vi.fn();
    subscribe(bad);
    subscribe(good);
    setActive({ pattern: makePattern([]), ctx: makeCtx(2.0), anchor: 1.0, cps: 1 });
    tickOnce();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('lazy loop: starts on first subscribe, stops on last unsubscribe', () => {
    expect(rafQueue.length).toBe(0);
    const unsub = subscribe(() => undefined);
    expect(rafQueue.length).toBe(1);
    unsub();
    // rafHandle is still set; no further callback queued, but the loop
    // is self-terminated because subscribers.size === 0.
    expect(rafQueue.length).toBe(1);
  });
});
