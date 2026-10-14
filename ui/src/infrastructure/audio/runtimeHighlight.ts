/**
 * Runtime mini-notation highlight — bridge.
 *
 * Holds the live Pattern produced by the most recent `repl.evaluate`,
 * drives a single `requestAnimationFrame` loop, and emits the set of
 * active char-ranges to subscribed CodeMirror views.
 *
 * Design contract (see `math/wavecode-runtime-mini-highlight/packet.md`):
 *   - LiveAudioEngine calls `setActive({ pattern, ctx, anchor, cps,
 *     layerRanges })` after every successful evaluate / setLayerMix.
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

/* ------------------------------------------------------------------ */
/* Public types                                                       */
/* ------------------------------------------------------------------ */

export type CharRange = readonly [from: number, to: number];

/** [from, to) char range in the original snippet source. */
export type LayerRange = readonly [from: number, to: number];

/**
 * Per-cycle highlight. `color` is a palette index (0..PALETTE_SIZE-1).
 * `beat` distinguishes the first half of a cycle (`down`, brighter,
 * with glow) from the second half (`off`, dimmer, no glow). The actual
 * color and intensity are owned by CSS
 * (`.cm-mini-active c${color} ${beat}`).
 *
 * 4 colors × 2 beats = 8 distinct visual lanes, enough to read a
 * typical `<a b c d>` stack at a glance: every step pulses through
 * one of 4 colors on a bright downbeat, then a slightly dimmer
 * offbeat — the eye immediately tracks which parallel part is in
 * motion.
 */
export type Beat = 'down' | 'off';
export type ColoredRange = {
  readonly from: number;
  readonly to: number;
  readonly color: number;
  readonly beat: Beat;
};

/**
 * Number of distinct highlight colors in the palette. Each
 * `stack(...),-separated` top-level layer in the snippet maps to
 * `layerIndex mod PALETTE_SIZE` → distinct visual lane, so users can
 * see parallel parts of the pattern at a glance.
 */
export const PALETTE_SIZE = 4;

export type ActiveState = {
  readonly pattern: QueryablePattern;
  readonly ctx: AudioContextLike;
  readonly anchor: number;
  readonly cps: number;
  /**
   * Top-level `,`-separated layers, as char ranges in the source snippet.
   * Used to project each currently-sounding Hap onto a per-layer color.
   * Empty array → all Hap'ы fall back to color 0.
   */
  readonly layerRanges: ReadonlyArray<LayerRange>;
};

/* ------------------------------------------------------------------ */
/* Layer parsing — pure, exported for tests.                          */
/* ------------------------------------------------------------------ */

/**
 * Find the index of the closing parenthesis that matches the
 * opening paren at `openIndex`. Returns -1 if unbalanced.
 */
const findMatchingParen = (text: string, openIndex: number): number => {
  if (text[openIndex] !== '(') return -1;
  let depth = 0;
  for (let j = openIndex; j < text.length; j++) {
    const c = text[j];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
};

const isWhitespace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/**
 * Split `text` on top-level commas (depth=0, ignoring brackets/braces
 * and string-literal contents). Each layer is trimmed of leading and
 * trailing whitespace.
 */
const splitTopLevelCommas = (text: string, baseOffset: number): LayerRange[] => {
  const layers: LayerRange[] = [];
  let depth = 0;
  let i = 0;
  while (i < text.length && isWhitespace(text[i])) i++;
  let start = baseOffset + i;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      let end = baseOffset + i;
      while (end > start && isWhitespace(text[end - baseOffset - 1])) end--;
      if (end > start) layers.push([start, end] as LayerRange);
      i++;
      while (i < text.length && isWhitespace(text[i])) i++;
      start = baseOffset + i;
      i--;
    }
  }
  if (start < baseOffset + text.length) {
    let end = baseOffset + text.length;
    while (end > start && isWhitespace(text[end - baseOffset - 1])) end--;
    if (end > start) layers.push([start, end] as LayerRange);
  }
  return layers;
};

/**
 * Decompose a Strudel snippet into top-level `,`-separated layers as
 * [from, to) char ranges in the source.
 *
 * Recognised shapes (in order of detection):
 *   1. `stack(..., ...)` — split inside the parens.
 *   2. `$: ..., ...`    — split after the `$:` label.
 *   3. `note(...), note(...)` — flat split.
 *   4. `note(...)`        — single layer.
 *
 * This is intentionally a *simple* parser: it tracks paren/bracket
 * depth (so commas inside `()` and `[]` are ignored) and the
 * `stack(…)` / `$:` wrappers. It does NOT understand string-literal
 * contents — wavecode snippets don't have commas inside their quoted
 * sample names, so this is sufficient.
 *
 * Exported for unit tests; LiveAudioEngine is the only production
 * caller.
 */
export const parseLayerRanges = (snippet: string): LayerRange[] => {
  let i = 0;
  while (i < snippet.length && isWhitespace(snippet[i])) i++;

  // 1) `stack(...)` wrapper — split inside the parens.
  const stackMatch = snippet.slice(i).match(/^stack\s*\(/);
  if (stackMatch) {
    const openParen = i + stackMatch[0].length - 1;
    const closeParen = findMatchingParen(snippet, openParen);
    if (closeParen > 0) {
      const inner = snippet.slice(openParen + 1, closeParen);
      return splitTopLevelCommas(inner, openParen + 1);
    }
  }

  // 2) `$: ...` label — split after the label.
  if (snippet[i] === '$' && snippet[i + 1] === ':') {
    return splitTopLevelCommas(snippet.slice(i + 2), i + 2);
  }

  // 3/4) Flat / single expression.
  return splitTopLevelCommas(snippet, 0);
};

/* ------------------------------------------------------------------ */
/* Structural types for Pattern / Hap / AudioContext.                */
/* ------------------------------------------------------------------ */

export type QueryablePattern = {
  queryArc(begin: number, end: number): ReadonlyArray<unknown>;
};

export type AudioContextLike = {
  readonly currentTime: number;
};

type HapLike = {
  whole?: { begin?: { valueOf?: () => number } | number };
  context?: {
    locations?: ReadonlyArray<
      | { start?: unknown; end?: unknown; from?: unknown; to?: unknown }
      | null
      | undefined
    >;
  };
};

/**
 * Map a hap's cycle-fraction to a `Beat` discriminator. The first half
 * of a cycle (`begin % 1` in [0, 0.5)) is the downbeat — bright with
 * outer glow. The second half is the offbeat — dimmer, no glow. The
 * visual contrast between the two is what gives the eye a sense of
 * "where in the cycle we are" beyond just "what color is this layer".
 *
 * For an `<a b c d>` pattern: a (0) and b (0.25) → down; c (0.5) and
 * d (0.75) → off. This produces a clear 4-on-the-floor alternating
 * stripe within each layer.
 */
const beatFor = (begin: number): Beat => {
  if (!Number.isFinite(begin)) return 'down';
  const phase = begin - Math.floor(begin); // 0..1, equivalent to % 1 but robust to negative begin
  return phase < 0.5 ? 'down' : 'off';
};

const layerColorFor = (pos: number, layerRanges: ReadonlyArray<LayerRange>): number => {
  for (let i = 0; i < layerRanges.length; i++) {
    const range = layerRanges[i]!;
    if (pos >= range[0] && pos < range[1]) return i % PALETTE_SIZE;
  }
  return 0;
};

const extractFromHaps = (
  haps: ReadonlyArray<unknown>,
  layerRanges: ReadonlyArray<LayerRange>,
): ColoredRange[] => {
  const seen = new Set<string>();
  const out: ColoredRange[] = [];
  for (const raw of haps) {
    if (!raw || typeof raw !== 'object') continue;
    const h = raw as HapLike;
    const locs = h.context?.locations;
    if (!Array.isArray(locs)) continue;

    // Beat: read hap.whole.begin (Fraction → number).
    const wholeBegin = h.whole?.begin;
    const beginNum =
      typeof wholeBegin === 'number'
        ? wholeBegin
        : typeof (wholeBegin as { valueOf?: () => number } | undefined)?.valueOf === 'function'
          ? (wholeBegin as { valueOf: () => number }).valueOf()
          : 0;
    const beat = beatFor(beginNum);

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
      const color = layerColorFor(f, layerRanges);
      const key = `${f}|${t}|${color}|${beat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: f, to: t, color, beat });
    }
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
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
 * ColoredRange. Exposed for tests; the internal rAF loop wraps this
 * with throttling and dedup.
 */
export const computeRanges = (state: ActiveState | null): ReadonlyArray<ColoredRange> => {
  if (!state) return [];
  const { pattern, ctx, anchor, cps } = state;
  if (!Number.isFinite(cps) || cps <= 0) return [];
  if (!Number.isFinite(anchor)) return [];
  const elapsed = ctx.currentTime - anchor;
  if (!Number.isFinite(elapsed) || elapsed < 0) return [];
  const nowCycle = elapsed * cps;
  const haps = safeQueryArc(pattern, nowCycle - QUERY_HALF_WINDOW_CYCLES, nowCycle + QUERY_HALF_WINDOW_CYCLES);
  return extractFromHaps(haps, state.layerRanges);
};

/* ------------------------------------------------------------------ */
/* Internal mutable state                                              */
/* ------------------------------------------------------------------ */

let active: ActiveState | null = null;
const subscribers = new Set<(ranges: ReadonlyArray<ColoredRange>) => void>();
let rafHandle: number | null = null;
let lastEmitAt = 0;
let lastRangesKey = '';

const THROTTLE_MS = 33;
const QUERY_HALF_WINDOW_CYCLES = 0.5;

/* ------------------------------------------------------------------ */
/* Injectable time/raf — overridden by tests; defaults to globals.    */
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
    parseLayerRanges,
    PALETTE_SIZE,
  };
  __diag.initialized = true;
};

if (typeof window !== 'undefined') publishDiag();

/* ------------------------------------------------------------------ */
/* Internal loop — throttled, deduplicated.                           */
/* ------------------------------------------------------------------ */

const rangesKey = (ranges: ReadonlyArray<ColoredRange>): string =>
  ranges.map((r) => `${r.from}|${r.to}|${r.color}|${r.beat}`).join(',');

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

export const subscribe = (cb: (ranges: ReadonlyArray<ColoredRange>) => void): (() => void) => {
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
