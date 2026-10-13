/**
 * Runtime mini-notation highlight — bridge.
 *
 * Holds the live Pattern produced by the most recent `repl.evaluate`,
 * drives a single `requestAnimationFrame` loop, and emits the set of
 * active char-ranges to subscribed CodeMirror views.
 *
 * Design contract (see `math/wavecode-runtime-mini-highlight/packet.md`):
 *   - LiveAudioEngine calls `setActive({ pattern, ctx, anchor, cps })`
 *     after every successful evaluate / setLayerMix.
 *   - LiveAudioEngine calls `clearActive()` on stop / fatal eval error.
 *   - CodeMirror ViewPlugin subscribes via `subscribe(cb)`; the returned
 *     unsubscribe tears down the subscription on view destroy.
 *   - The internal rAF loop is LAZY: it spins up on the first
 *     `subscribe` (or `setActive`), and stops when the last
 *     subscription drops, while also auto-stopping when `active===null`.
 *   - Throttle: at most one emit per `THROTTLE_MS`. Two consecutive
 *     ticks producing the same range set are deduplicated.
 *
 * Why module-scope (not Effect-TS): this is a presentation-layer concern
 * (driving CodeMirror decorations) that must outlive the granular
 * AudioEngine Layer compose graph. A shared module signal is the
 * simplest contract and matches the precedent set by `miniNotationHighlight`
 * in `presentation/editor/`. LiveAudioEngine and the editor extension
 * both depend on this file; presentation layer is the only consumer of
 * the callback side, so no upward dependency is created.
 */

export type CharRange = readonly [from: number, to: number];

export type ActiveState = {
  readonly pattern: QueryablePattern;
  readonly ctx: AudioContextLike;
  readonly anchor: number;
  readonly cps: number;
};

/**
 * Structural type for `Pattern.queryArc`. We avoid importing the
 * `@strudel/core` Pattern class so this module stays light and the
 * audio engine doesn't have a transitive dep through presentation.
 */
export type QueryablePattern = {
  queryArc(begin: number, end: number): ReadonlyArray<unknown>;
};

/**
 * Structural AudioContext — only `currentTime` is read by the loop.
 * Avoids a hard dep on the Web Audio lib.dom type and lets tests pass a
 * minimal stub.
 */
export type AudioContextLike = {
  readonly currentTime: number;
};

const THROTTLE_MS = 33;
/** queryArc window: half a cycle in either direction. */
const QUERY_HALF_WINDOW_CYCLES = 0.5;

let active: ActiveState | null = null;
const subscribers = new Set<(ranges: ReadonlyArray<CharRange>) => void>();
let rafHandle: number | null = null;
let lastEmitAt = 0;
let lastRangesKey = '';

/* ------------------------------------------------------------------ */
/* Injectable time/raf — overridden by tests; defaults to globals.   */
/* ------------------------------------------------------------------ */

const defaultNow: () => number = (() => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return () => performance.now();
  }
  return () => Date.now();
})();

const defaultRaf: (cb: () => void) => number = (() => {
  if (typeof requestAnimationFrame !== 'undefined') {
    return (cb) => requestAnimationFrame(cb);
  }
  return (cb) => setTimeout(cb, 16) as unknown as number;
})();

const defaultCancelRaf: (h: number) => void = (() => {
  if (typeof cancelAnimationFrame !== 'undefined') {
    return (h) => cancelAnimationFrame(h);
  }
  return (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
})();

let rafFn: (cb: () => void) => number = defaultRaf;
let cancelRafFn: (h: number) => void = defaultCancelRaf;
let nowFn: () => number = defaultNow;

/* ------------------------------------------------------------------ */
/* Pure helpers — exported for unit tests.                            */
/* ------------------------------------------------------------------ */

type HapLike = {
  context?: {
    locations?: ReadonlyArray<
      | { start?: unknown; end?: unknown; from?: unknown; to?: unknown }
      | null
      | undefined
    >;
  };
};

const extractFromHaps = (haps: ReadonlyArray<unknown>): ReadonlyArray<CharRange> => {
  const seen = new Set<string>();
  const out: CharRange[] = [];
  for (const raw of haps) {
    if (!raw || typeof raw !== 'object') continue;
    const h = raw as HapLike;
    const locs = h.context?.locations;
    if (!Array.isArray(locs)) continue;
    for (const loc of locs) {
      if (!loc) continue;
      // `Pattern.withLoc(start, end)` (core/pattern.mjs:558) stores the
      // location as `{ start, end }`. Earlier Strudel versions used
      // `{ from, to }`; we accept both for forward-compat.
      const rawStart = (loc as { start?: unknown; from?: unknown }).start
        ?? (loc as { start?: unknown; from?: unknown }).from;
      const rawEnd = (loc as { end?: unknown; to?: unknown }).end
        ?? (loc as { end?: unknown; to?: unknown }).to;
      const f = Number(rawStart);
      const t = Number(rawEnd);
      if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f) continue;
      const key = `${f}|${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([f, t] as CharRange);
    }
  }
  out.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  return out;
};

const safeQueryArc = (
  pattern: QueryablePattern,
  a: number,
  b: number,
): ReadonlyArray<unknown> => {
  try {
    const haps = pattern.queryArc(a, b);
    return Array.isArray(haps) ? haps : [];
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[wavecode/runtimeHighlight] queryArc failed:', err);
    }
    return [];
  }
};

/**
 * Pure projection of the active state → list of currently-sounding
 * char ranges. Exposed for tests; the internal rAF loop wraps this
 * with throttling and dedup.
 */
export const computeRanges = (state: ActiveState | null): ReadonlyArray<CharRange> => {
  if (!state) return [];
  const { pattern, ctx, anchor, cps } = state;
  if (!Number.isFinite(cps) || cps <= 0) return [];
  if (!Number.isFinite(anchor)) return [];
  const elapsed = ctx.currentTime - anchor;
  if (!Number.isFinite(elapsed) || elapsed < 0) return [];
  const nowCycle = elapsed * cps;
  const haps = safeQueryArc(pattern, nowCycle - QUERY_HALF_WINDOW_CYCLES, nowCycle + QUERY_HALF_WINDOW_CYCLES);
  return extractFromHaps(haps);
};

const rangesKey = (ranges: ReadonlyArray<CharRange>): string =>
  ranges.map((r) => `${r[0]}|${r[1]}`).join(',');

/* ------------------------------------------------------------------ */
/* Internal loop — throttled, deduplicated.                           */
/* ------------------------------------------------------------------ */

const loop = (): void => {
  rafHandle = rafFn(loop);
  if (!active || subscribers.size === 0) return;
  const now = nowFn();
  if (now - lastEmitAt < THROTTLE_MS) return;

  const ranges = computeRanges(active);
  const key = rangesKey(ranges);
  // Skip duplicates only after we've emitted at least once (lastEmitAt > 0)
  // — otherwise the initial empty-ranges snapshot would dedup against the
  // uninitialized '' key and never notify subscribers.
  if (lastEmitAt > 0 && key === lastRangesKey) return;
  lastRangesKey = key;
  lastEmitAt = now;

  for (const cb of subscribers) {
    try {
      cb(ranges);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[wavecode/runtimeHighlight] subscriber threw:', err);
      }
    }
  }
};

const ensureLoop = (): void => {
  if (rafHandle !== null) return;
  rafHandle = rafFn(loop);
};

const stopLoop = (): void => {
  if (rafHandle === null) return;
  cancelRafFn(rafHandle);
  rafHandle = null;
  lastEmitAt = 0;
  lastRangesKey = '';
};

/* ------------------------------------------------------------------ */
/* Diagnostic state — exposed on window for inspection from devtools. */
/* Module-level init ensures the surface is published eagerly, so we  */
/* can distinguish "module loaded but setActive never called" from    */
/* "module not loaded at all".                                         */
/* ------------------------------------------------------------------ */

const __diag: { initialized: boolean; setActiveCalls: number; clearActiveCalls: number } = {
  initialized: false,
  setActiveCalls: 0,
  clearActiveCalls: 0,
};

const publishDiag = (): void => {
  if (typeof window === 'undefined') return;
  (window as unknown as { __wavecodeRuntimeHighlight?: unknown }).__wavecodeRuntimeHighlight = {
    __diag: () => ({ ...__diag, hasActive: active !== null, subscribers: subscribers.size, loopRunning: rafHandle !== null }),
    getActive: () => active,
    getSubscribersCount: () => subscribers.size,
    isLoopRunning: () => rafHandle !== null,
    getLastEmitAt: () => lastEmitAt,
    getLastRangesKey: () => lastRangesKey,
    computeRangesFor: computeRanges,
  };
  __diag.initialized = true;
};

if (typeof window !== 'undefined') publishDiag();

/* ------------------------------------------------------------------ */
/* Public API used by LiveAudioEngine.                                */
/* ------------------------------------------------------------------ */

export const setActive = (state: ActiveState): void => {
  active = state;
  __diag.setActiveCalls += 1;
  lastEmitAt = 0;
  lastRangesKey = '';
  if (subscribers.size > 0) ensureLoop();
  // Always (re-)publish the diagnostic surface — even after clearActive
  // happened earlier. Cheap; reads stay valid across full lifetime.
  publishDiag();
};

export const clearActive = (): void => {
  active = null;
  __diag.clearActiveCalls += 1;
  lastEmitAt = 0;
  lastRangesKey = '';
  publishDiag();
};

/* ------------------------------------------------------------------ */
/* Public API used by CodeMirror editor.                              */
/* ------------------------------------------------------------------ */

export const subscribe = (cb: (ranges: ReadonlyArray<CharRange>) => void): (() => void) => {
  subscribers.add(cb);
  ensureLoop();
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0) stopLoop();
  };
};

/** Snapshot getter — only for diagnostics (StepGrid etc.). */
export const isActive = (): boolean => active !== null;

/* ------------------------------------------------------------------ */
/* Test-only injection handle. NOT exported from index.ts.            */
/* ------------------------------------------------------------------ */

export const __test__ = {
  setNow: (fn: () => number): void => {
    nowFn = fn;
  },
  setRaf: (fn: (cb: () => void) => number): void => {
    rafFn = fn;
  },
  setCancelRaf: (fn: (h: number) => void): void => {
    cancelRafFn = fn;
  },
  /** Reset internal mutable state between tests. */
  reset: (): void => {
    active = null;
    subscribers.clear();
    stopLoop();
  },
};
