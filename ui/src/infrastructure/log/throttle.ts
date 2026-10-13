/**
 * Pure per-source throttle for log spam suppression.
 *
 * Why this exists
 * ---------------
 * Strudel, AudioContext, and the MIDI layer each emit warnings on every
 * glitch (sample missing, CC underrun, retrigger denied). When several
 * fire in the same tick the console UI floods with identical lines and
 * the user can't find the relevant entry. This module lets the caller
 * cap the emission rate per key without mutating any external state.
 *
 * The contract is intentionally narrow:
 *
 *   1. `shouldEmit` is a pure function: it does not read or write any
 *      module-level state, never throws, and does not depend on wall
 *      clocks beyond the `nextTs` argument. The caller stores its own
 *      history and passes a frozen view of it.
 *
 *   2. History is a tuple of `(key, ts)` pairs in chronological order.
 *      Same-key is checked via string equality; window membership uses
 *      the half-open interval `[nextTs - windowMs, nextTs]`.
 *
 *   3. A `key` is opaque — the caller picks the granularity. For our
 *      log pipeline, `key = source` is sufficient (one source = one
 *      bucket) but `(source, text-hash)` is equally valid.
 *
 *   4. `limit` is the maximum allowed entries per window per key.
 *      When the existing count reaches `limit`, the next entry is
 *      dropped and the optional `onThrottle` callback receives the
 *      cumulative dropped count and the most recent history entry.
 *      Its return value is forwarded to the caller as the replacement
 *      text — the caller decides whether to emit a synthetic
 *      "suppression" entry using it.
 *
 * Rationale: `math/wavecode-log-pipeline/packet.md` describes the
 * earlier ring-buffer architecture; this module extends the same
 * pipeline with rate-limiting while staying decoupled from the
 * concrete buffer.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type ThrottleConfig = {
  /** Maximum entries per `windowMs` for the same key. */
  readonly limit: number;
  /** Sliding window size in ms. */
  readonly windowMs: number;
  /** Optional override: return the entry to emit when the throttle fires. */
  readonly onThrottle?: (
    droppedCount: number,
    lastEntry: { readonly level: LogLevel; readonly text: string },
  ) => string;
};

export type ThrottleResult<T> = {
  readonly emit: T;
  readonly dropped: number;
  /**
   * Replacement text forwarded from the optional `onThrottle` callback.
   * Set only when `emit === false` and a callback was provided. The
   * caller decides whether to emit a synthetic entry carrying this text.
   */
  readonly text?: string;
};

/**
 * Decide whether the next entry should be emitted.
 *
 * The caller passes the current history (a frozen tuple list), the next
 * key, the next timestamp, and a config. The function does not mutate
 * `history`; the caller appends (or skips) based on the returned
 * `emit` flag.
 */
export const shouldEmit = (
  history: ReadonlyArray<readonly [string, number]>,
  nextKey: string,
  nextTs: number,
  config: ThrottleConfig,
): ThrottleResult<boolean> => {
  const windowStart = nextTs - config.windowMs;
  const sameKeyInWindow: ReadonlyArray<readonly [string, number]> = history.filter(
    ([k, ts]) => k === nextKey && ts >= windowStart && ts <= nextTs,
  );

  if (sameKeyInWindow.length >= config.limit) {
    const dropped = sameKeyInWindow.length - config.limit + 1;
    let text: string | undefined;
    if (config.onThrottle) {
      text = config.onThrottle(dropped, { level: 'warn', text: '' });
    }
    return { emit: false, dropped, ...(text !== undefined ? { text } : {}) };
  }

  return { emit: true, dropped: 0 };
};