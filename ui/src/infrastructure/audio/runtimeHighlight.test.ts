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
  PALETTE_SIZE,
  parseLayerRanges,
  setActive,
  subscribe,
  type ActiveState,
  type ColoredRange,
  type QueryablePattern,
} from './runtimeHighlight';

type FakeHap = {
  whole?: { begin?: number | { valueOf?: () => number } };
  context?: { locations?: Array<{ from?: number; to?: number; start?: number; end?: number }> };
};

const makePattern = (haps: ReadonlyArray<FakeHap>): QueryablePattern => ({
  queryArc: (_a: number, _b: number): ReadonlyArray<unknown> => [...haps],
});

const makeCtx = (currentTime: number): ActiveState['ctx'] => ({ currentTime });

const NO_LAYERS: ActiveState['layerRanges'] = Object.freeze([]);

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

const toRanges = (arr: ReadonlyArray<ColoredRange>): Array<{ from: number; to: number; color: number; beat: string }> =>
  arr.map((r) => ({ from: r.from, to: r.to, color: r.color, beat: r.beat }));

describe('parseLayerRanges — top-level comma split', () => {
  it('flat comma-separated snippet splits on top-level commas', () => {
    // "note("a").s("p"), note("b").s("p")" — the two `,`-separated
    // top-level expressions are layer 0 and layer 1.
    const snippet = 'note("a").s("p"), note("b").s("p")';
    const layers = parseLayerRanges(snippet);
    expect(layers.length).toBe(2);
    expect(layers[0]![0]).toBe(0);
    expect(layers[0]![1]).toBeLessThan(layers[1]![0]);
    expect(layers[1]![0]).toBeGreaterThan(layers[0]![1]);
  });

  it('stack(...) wrapper splits inside the parens', () => {
    const snippet = 'stack(note("a"), note("b"), note("c"))';
    const layers = parseLayerRanges(snippet);
    expect(layers.length).toBe(3);
    // All three layers should be inside the stack() parens —
    // i.e. the first layer starts at or after the position of the
    // opening `(` of `stack(`, and the last layer ends before the
    // closing `)` of `stack(`. (Range end is half-open, so a layer
    // may legitimately end at the position of the stack close paren.)
    expect(layers[0]![0]).toBeGreaterThanOrEqual(6); // "stack(" length
    expect(layers[2]![1]).toBeLessThanOrEqual(snippet.length - 1);
  });

  it('does not split on commas inside parens', () => {
    const snippet = 'note("a,b,c").s("p"), s("bd")';
    const layers = parseLayerRanges(snippet);
    // Comma inside note("a,b,c") is at depth=1 — ignored.
    // Only the top-level `,` after `.s("p")` splits.
    expect(layers.length).toBe(2);
  });

  it('does not split on commas inside [] or {}', () => {
    const snippet = 'note("[a,b,c]").s("p"), s("bd")';
    const layers = parseLayerRanges(snippet);
    expect(layers.length).toBe(2);
  });

  it('returns single layer for snippet without commas', () => {
    const snippet = 's("bd sd hh")';
    const layers = parseLayerRanges(snippet);
    expect(layers.length).toBe(1);
    expect(layers[0]![0]).toBe(0);
    expect(layers[0]![1]).toBe(snippet.length);
  });

  it('trims whitespace at layer boundaries', () => {
    const snippet = 's("a"),   s("b")';
    const layers = parseLayerRanges(snippet);
    expect(layers.length).toBe(2);
    expect(snippet.slice(layers[0]![0], layers[0]![1])).toBe('s("a")');
    expect(snippet.slice(layers[1]![0], layers[1]![1])).toBe('s("b")');
  });

  it('handles `$: ...` label', () => {
    const snippet = '$: s("a"), s("b")';
    const layers = parseLayerRanges(snippet);
    expect(layers.length).toBe(2);
    expect(snippet.slice(layers[0]![0], layers[0]![1])).toBe('s("a")');
  });

  it('handles Creep-style 6-layer snippet', () => {
    const snippet = [
      'note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
      'note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("triangle").gain(0.2).lpf(1500),',
      'n("<55 67 59 67 62 67 59 67>*2").s("sawtooth").gain(0.12).lpf(1500),',
      's("bd ~ sbd ~").gain(0.5),',
      's("~ white ~ white").decay(.05).sustain(0).gain(0.22),',
      's("white*8").decay(.04).sustain(0).gain(0.15)',
    ].join('\n');
    const layers = parseLayerRanges(snippet);
    expect(layers.length).toBeGreaterThanOrEqual(5);
    expect(layers.length).toBeLessThanOrEqual(6);
  });
});

describe('computeRanges — pure projection', () => {
  it('returns empty when no active state', () => {
    expect(computeRanges(null)).toEqual([]);
  });

  it('returns empty when cps is non-positive', () => {
    const state: ActiveState = { pattern: makePattern([]), ctx: makeCtx(5), anchor: 1, cps: 0, layerRanges: NO_LAYERS };
    expect(computeRanges(state)).toEqual([]);
  });

  it('returns empty when anchor is not finite', () => {
    const state: ActiveState = { pattern: makePattern([]), ctx: makeCtx(5), anchor: Number.NaN, cps: 1, layerRanges: NO_LAYERS };
    expect(computeRanges(state)).toEqual([]);
  });

  it('returns empty when audio ctx.currentTime is before anchor', () => {
    const state: ActiveState = { pattern: makePattern([{ context: { locations: [{ from: 1, to: 5 }] } }]), ctx: makeCtx(0.5), anchor: 1, cps: 1, layerRanges: NO_LAYERS };
    expect(computeRanges(state)).toEqual([]);
  });

  it('extracts locations from Hap context (default color 0, beat from begin)', () => {
    const haps: FakeHap[] = [{ whole: { begin: 0.0 }, context: { locations: [{ from: 10, to: 20 }] } }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(toRanges(computeRanges(state))).toEqual([{ from: 10, to: 20, color: 0, beat: 'down' }]);
  });

  it('selects beat from hap.whole.begin — begin in second half → off', () => {
    const haps: FakeHap[] = [{ whole: { begin: 0.6 }, context: { locations: [{ from: 5, to: 9 }] } }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(toRanges(computeRanges(state))).toEqual([{ from: 5, to: 9, color: 0, beat: 'off' }]);
  });

  it('assigns color per layer — first layer c0, second layer c1, etc', () => {
    const layers: ActiveState['layerRanges'] = [
      [0, 50] as const,
      [55, 100] as const,
    ];
    // Hap locations in each layer.
    const haps: FakeHap[] = [
      { whole: { begin: 0 }, context: { locations: [{ from: 10, to: 20 }] } },
      { whole: { begin: 0.25 }, context: { locations: [{ from: 60, to: 80 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: layers };
    expect(toRanges(computeRanges(state))).toEqual([
      { from: 10, to: 20, color: 0, beat: 'down' },
      { from: 60, to: 80, color: 1, beat: 'down' },
    ]);
  });

  it('wraps color around PALETTE_SIZE for >4 layers', () => {
    const layers: ActiveState['layerRanges'] = [
      [0, 10] as const,
      [10, 20] as const,
      [20, 30] as const,
      [30, 40] as const,
      [40, 50] as const,  // wraps to color 0
    ];
    const haps: FakeHap[] = [
      { whole: { begin: 0 }, context: { locations: [{ from: 1, to: 5 }] } },   // layer 0
      { whole: { begin: 0 }, context: { locations: [{ from: 45, to: 48 }] } }, // layer 4 → c0
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: layers };
    expect(PALETTE_SIZE).toBe(4);
    const out = toRanges(computeRanges(state));
    expect(out[0]?.color).toBe(0);
    expect(out[1]?.color).toBe(0);
  });

  it('falls back to color 0 when no layer matches the location', () => {
    // layerRanges covers [100,200]; hap location is at 50 — outside any layer.
    const layers: ActiveState['layerRanges'] = [[100, 200] as const];
    const haps: FakeHap[] = [
      { whole: { begin: 0 }, context: { locations: [{ from: 50, to: 60 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: layers };
    expect(toRanges(computeRanges(state))).toEqual([{ from: 50, to: 60, color: 0, beat: 'down' }]);
  });

  it('deduplicates identical (from,to,color,beat) across haps', () => {
    const haps: FakeHap[] = [
      { whole: { begin: 0 }, context: { locations: [{ from: 10, to: 20 }] } },
      { whole: { begin: 0 }, context: { locations: [{ from: 10, to: 20 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(computeRanges(state)).toHaveLength(1);
  });

  it('sorts ranges by `from` ascending', () => {
    const haps: FakeHap[] = [
      { whole: { begin: 0 }, context: { locations: [{ from: 30, to: 40 }] } },
      { whole: { begin: 0 }, context: { locations: [{ from: 10, to: 20 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(computeRanges(state).map((r) => r.from)).toEqual([10, 30]);
  });

  it('drops malformed location entries (NaN, non-finite, to<=from)', () => {
    const haps: FakeHap[] = [
      { whole: { begin: 0 }, context: { locations: [{ from: Number.NaN, to: 10 }, { from: 5, to: 5 }, { from: 1, to: -1 }, { from: 0, to: 4 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(toRanges(computeRanges(state))).toEqual([{ from: 0, to: 4, color: 0, beat: 'down' }]);
  });

  it('swallows queryArc exceptions, returns empty', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pattern: QueryablePattern = { queryArc: () => { throw new Error('boom'); } };
    const state: ActiveState = { pattern, ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(computeRanges(state)).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles hap without context.locations gracefully', () => {
    const haps: FakeHap[] = [{}, { context: {} }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(computeRanges(state)).toEqual([]);
  });

  it('flattens multiple locations per hap', () => {
    const haps: FakeHap[] = [{ whole: { begin: 0 }, context: { locations: [{ from: 5, to: 7 }, { from: 15, to: 18 }] } }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(computeRanges(state).map((r) => r.from)).toEqual([5, 15]);
  });

  it('accepts anchor = 0 as a valid starting time (elapsed = ctx.currentTime)', () => {
    const haps: FakeHap[] = [{ whole: { begin: 0 }, context: { locations: [{ from: 4, to: 9 }] } }];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 0.0, cps: 1, layerRanges: NO_LAYERS };
    expect(computeRanges(state).map((r) => r.from)).toEqual([4]);
  });

  it('accepts `start`/`end` location format (Strudel core/pattern.mjs:558)', () => {
    const haps: FakeHap[] = [
      { whole: { begin: 0 }, context: { locations: [{ start: 30, end: 35 }] } },
      { whole: { begin: 0.5 }, context: { locations: [{ start: 40, end: 50 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(toRanges(computeRanges(state))).toEqual([
      { from: 30, to: 35, color: 0, beat: 'down' },
      { from: 40, to: 50, color: 0, beat: 'off' },
    ]);
  });

  it('handles whole.begin as Fraction-like with valueOf()', () => {
    const haps: FakeHap[] = [
      { whole: { begin: { valueOf: () => 0.7 } }, context: { locations: [{ from: 5, to: 7 }] } },
    ];
    const state: ActiveState = { pattern: makePattern(haps), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS };
    expect(toRanges(computeRanges(state))).toEqual([{ from: 5, to: 7, color: 0, beat: 'off' }]);
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
    setActive({ pattern: makePattern([]), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS });

    nowValue = 1100;
    tickOnce();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toEqual<ColoredRange[]>([]);
  });

  it('throttles: no notification within 33ms window', () => {
    const cb = vi.fn();
    const pat = makeMutablePattern([{ whole: { begin: 0 }, context: { locations: [{ from: 1, to: 5 }] } }]);
    subscribe(cb);
    setActive({ pattern: pat, ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS });

    nowValue = 1050;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);

    pat.setHaps([{ whole: { begin: 0.6 }, context: { locations: [{ from: 2, to: 6 }] } }]);
    nowValue = 1060;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);

    pat.setHaps([{ whole: { begin: 0.6 }, context: { locations: [{ from: 3, to: 7 }] } }]);
    nowValue = 1300;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]![0]).toEqual([{ from: 3, to: 7, color: 0, beat: 'off' }]);
  });

  it('emits again when color changes (different layer → different palette index)', () => {
    const cb = vi.fn();
    const pat = makeMutablePattern([{ whole: { begin: 0 }, context: { locations: [{ from: 10, to: 12 }] } }]);
    subscribe(cb);
    // Two layers, same hap position. Hap falls into the first layer.
    setActive({ pattern: pat, ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: [[0, 50] as const, [55, 100] as const] });

    nowValue = 1050;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toEqual([{ from: 10, to: 12, color: 0, beat: 'down' }]);

    // Move the hap's location to the second layer (color 1) → emit.
    pat.setHaps([{ whole: { begin: 0 }, context: { locations: [{ from: 60, to: 80 }] } }]);
    nowValue = 1200;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]![0]).toEqual([{ from: 60, to: 80, color: 1, beat: 'down' }]);
  });

  it('emits again when beat changes (downbeat vs offbeat)', () => {
    const cb = vi.fn();
    const pat = makeMutablePattern([{ whole: { begin: 0.0 }, context: { locations: [{ from: 5, to: 9 }] } }]);
    subscribe(cb);
    setActive({ pattern: pat, ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS });

    nowValue = 1050;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toEqual([{ from: 5, to: 9, color: 0, beat: 'down' }]);

    pat.setHaps([{ whole: { begin: 0.6 }, context: { locations: [{ from: 5, to: 9 }] } }]);
    nowValue = 1200;
    tickOnce();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]![0]).toEqual([{ from: 5, to: 9, color: 0, beat: 'off' }]);
  });

  it('stops emitting after clearActive', () => {
    const cb = vi.fn();
    subscribe(cb);
    setActive({ pattern: makePattern([]), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS });
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
    setActive({ pattern: makePattern([]), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS });
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
    setActive({ pattern: makePattern([]), ctx: makeCtx(2.0), anchor: 1.0, cps: 1, layerRanges: NO_LAYERS });
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
    expect(rafQueue.length).toBe(1);
  });
});
