/**
 * Centralized log ring buffer.
 *
 * Purpose
 * -------
 * Intercept every `console.log` / `console.info` / `console.warn` /
 * `console.error` call so a single in-app Console UI can render them.
 * The intercepted calls still reach the native DevTools console (with
 * `%c[…]` CSS stripped), AND the cleaned args land in `buffer` for the
 * UI to read via `getBuffer()` / `setSink()`.
 *
 * Install order (caller's responsibility — main.tsx / App bootstrap)
 * ------------------------------------------------------------------
 *   1. `wrapStrudelLogger()` from `infrastructure/audio/strudelPatches`
 *      — strips `%c[ + CSS-arg` from console.log and reroutes to
 *      console.error. MUST run before any `@strudel/*` module imports.
 *   3. Any user-level console.* patches (debug toggles, etc.).
 *   4. `logger.install()` — captures ALL subsequent console.* calls.
 *
 * If installed BEFORE step 1, both patches still work — Strudel's
 * wrapStrudelLogger replaces `console.log`, then logger.install
 * captures the (already Strudel-patched) `console.log` as its
 * `originalLog`. The two cooperate rather than compete.
 *
 * Buffer semantics
 *  • FIFO with capacity `MAX_LOG_ENTRIES` (= 500); oldest dropped on overflow.
 *  • `getBuffer()` returns a frozen shallow copy (array is frozen, entries
 *    are typed `readonly`). Consumers must not mutate the returned array.
 *  • `push(level, args, source?)` is for non-console callers (try-catch
 *    blocks, Effect-layer failure logging, etc.). It does NOT call native
 *    console.* — that would recurse via the patched console.*. Callers
 *    wanting native output should call `console.error(...)` themselves;
 *    the patch will then push a second entry. (For most non-console uses,
 *    only the buffer entry is desired, so this is the right default.)
 *
 * Source detection
 *  • If `args[0]` (after CSS strip) starts with `[wavecode]`, `[strudel]`,
 *    `[sampler]`, `[cyclist]`, `[eval]`, `[webaudio]` — that source label
 *    is used. Otherwise `source = 'app'`.
 *  • Callers may override via `push(level, args, source)`.
 *
 * Log levels
 *  • `debug | info | warn | error | fatal` — see `./cleanLogArgs.ts` and
 *    `presentation/components/consoleStore.ts` for the UI contract.
 *  • `fatal` is the "this kills the app" marker: consoleStore treats it
 *    the same as `critical` for `unreadErrors` increments and sticky
 *    toast TTL. The actual mapping lives in `presentation/components/consoleStore.ts`; the
 *    level value is the public contract this module owns.
 *
 * Throttling (Phase 2 enhancement)
 *  • `push` calls `shouldEmit` for `warn` and `error` entries (and the
 *    new `fatal`). `debug` and `info` are never throttled — they have
 *    no spam value in our pipelines.
 *  • Bucket key is the entry's `source`. Limit 5 / 1000ms / source;
 *    rolling history cap 64 entries per source.
 *  • Dropped entries are NOT silently discarded — a single synthetic
 *    entry with text `[N similar messages suppressed in the last 1s]`
 *    is emitted in their slot. The suppression entry itself counts
 *    toward the throttle window (it is recorded in the history).
 *
 * IDB persistence (Phase 2 enhancement)
 *  • ERROR and FATAL entries are also appended to a separate in-memory
 *    `errorsBuffer`. After each such push, `savePersistedErrors(...)`
 *    is fired-and-forgotten with the last 100 entries of that buffer.
 *  • The IDB write is non-blocking and silent on failure (quota,
 *    permission denied, missing IndexedDB in a test environment).
 *  • `logger.loadPersistedErrors()` exposes the persisted slice so
 *    ConsoleSheet (or any future UI consumer) can restore the last
 *    error trace after a page reload. See `./idbBuffer.ts`.
 *
 * `prepend(entries)` (Phase 3 enhancement)
 *  • Inserts a batch of entries at the HEAD of the ring buffer,
 *    dropping the oldest entries if capacity (MAX_LOG_ENTRIES) is
 *    exceeded. Intended for the boot path: after
 *    `loadPersistedErrors()` resolves, ConsoleSheet calls
 *    `prepend(persisted)` so the last-100 errors from IDB appear
 *    BEFORE any live buffer activity that occurred during page
 *    load. Calls `sink(entries[entries.length - 1])` exactly once
 *    so the UI re-renders.
 *
 * @see ./cleanLogArgs.ts — CSS-strip utility used here.
 * @see ./throttle.ts — pure per-source rate-limit helper.
 * @see ./idbBuffer.ts — IndexedDB-backed error ring slice.
 */

import { cleanLogArgs } from './cleanLogArgs';
import { shouldEmit, type ThrottleConfig } from './throttle';
import {
  loadPersistedErrors as idbLoadPersistedErrors,
  savePersistedErrors,
} from './idbBuffer';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogEntry = {
  readonly id: number;
  readonly level: LogLevel;
  readonly text: string;
  readonly args: readonly unknown[];
  readonly source: string;
  readonly ts: number;
};

export type LogSink = (entry: LogEntry) => void;

export const MAX_LOG_ENTRIES = 500;

export const THROTTLE_PER_SOURCE_LIMIT = 64;
const THROTTLE_WINDOW_MS = 1000;
const THROTTLE_LIMIT = 5;

let installed = false;
let buffer: LogEntry[] = [];
let sink: LogSink | null = null;
let nextId = 0;
let errorsBuffer: LogEntry[] = [];

/** Per-source rolling history of (key, ts) for the throttle. */
const throttleHistory = new Map<string, ReadonlyArray<readonly [string, number]>>();

const SOURCE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\[wavecode\]/, 'wavecode'],
  [/^\[strudel\]/, 'strudel'],
  [/^\[sampler\]/, 'sampler'],
  [/^\[cyclist\]/, 'cyclist'],
  [/^\[eval\]/, 'eval'],
  [/^\[webaudio\]/, 'webaudio'],
];

const detectSource = (first: string | null): string => {
  if (first === null) return 'app';
  for (const [pattern, name] of SOURCE_PATTERNS) {
    if (pattern.test(first)) return name;
  }
  return 'app';
};

const joinArgs = (args: readonly unknown[]): string =>
  args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return String(a);
      } catch {
        return '[unstringifiable]';
      }
    })
    .join(' ');

const isThrottleable = (level: LogLevel): boolean =>
  level === 'warn' || level === 'error' || level === 'fatal';

const pushEntry = (entry: LogEntry): void => {
  buffer.push(entry);
  if (buffer.length > MAX_LOG_ENTRIES) buffer.shift();

  if (sink) {
    try {
      sink(entry);
    } catch {
      /* sink errors must not break the buffer pipeline */
    }
  }

  if (entry.level === 'error' || entry.level === 'fatal') {
    errorsBuffer.push(entry);
    if (errorsBuffer.length > 100) errorsBuffer.shift();
    void savePersistedErrors(errorsBuffer);
  }
};

const recordThrottleHistory = (key: string, ts: number): void => {
  const prev = throttleHistory.get(key) ?? [];
  const next: ReadonlyArray<readonly [string, number]> = [
    ...prev,
    [key, ts] as const,
  ];
  if (next.length > THROTTLE_PER_SOURCE_LIMIT) {
    // Drop oldest entries past the cap.
    throttleHistory.set(key, next.slice(next.length - THROTTLE_PER_SOURCE_LIMIT));
  } else {
    throttleHistory.set(key, next);
  }
};

const THROTTLE_CONFIG: ThrottleConfig = {
  limit: THROTTLE_LIMIT,
  windowMs: THROTTLE_WINDOW_MS,
  onThrottle: (droppedCount) =>
    `[${droppedCount} similar messages suppressed in the last 1s]`,
};

const push = (
  level: LogLevel,
  args: readonly unknown[],
  source?: string,
): void => {
  const cleaned = cleanLogArgs(args);
  const first = typeof cleaned[0] === 'string' ? cleaned[0] : null;
  const resolvedSource = source ?? detectSource(first);
  const ts = Date.now();

  if (isThrottleable(level)) {
    const history = throttleHistory.get(resolvedSource) ?? [];
    const decision = shouldEmit(history, resolvedSource, ts, THROTTLE_CONFIG);
    if (!decision.emit) {
      const replacementText = decision.text ?? `[${decision.dropped} similar messages suppressed in the last 1s]`;
      const suppressed: LogEntry = {
        id: ++nextId,
        level: 'warn',
        text: replacementText,
        args: [replacementText],
        source: resolvedSource,
        ts,
      };
      pushEntry(suppressed);
      recordThrottleHistory(resolvedSource, ts);
      return;
    }
    recordThrottleHistory(resolvedSource, ts);
  }

  const entry: LogEntry = {
    id: ++nextId,
    level,
    text: joinArgs(cleaned),
    args: cleaned.slice(),
    source: resolvedSource,
    ts,
  };
  pushEntry(entry);
};

const installPatch = <K extends 'log' | 'info' | 'warn' | 'error'>(
  key: K,
  level: LogLevel,
): void => {
  const original = console[key];
  const patched = function patched(
    this: Console,
    ...args: unknown[]
  ): void {
    const cleaned = cleanLogArgs(args);
    original.apply(this, cleaned);
    push(level, cleaned);
  };
  console[key] = patched as typeof original;
};

export const logger = {
  install(): void {
    if (installed) return;
    installed = true;
    installPatch('log', 'info');
    installPatch('info', 'info');
    installPatch('warn', 'warn');
    installPatch('error', 'error');
  },

  setSink(s: LogSink | null): void {
    sink = s;
  },

  getBuffer(): readonly LogEntry[] {
    return Object.freeze(buffer.slice());
  },

  clear(): void {
    buffer = [];
    errorsBuffer = [];
    throttleHistory.clear();
  },

  push,

  /**
   * Read the persisted error slice (last 100 ERROR/FATAL entries) from
   * IndexedDB. Returns [] when no entries are stored, when IndexedDB
   * is unavailable, or when the stored payload is malformed.
   *
   * Intended for ConsoleSheet to restore the last error trace on app
   * boot. Call this from a Solid resource / effect — the IDB read is
   * asynchronous and may take one tick to resolve.
   */
  loadPersistedErrors(): Promise<readonly LogEntry[]> {
    return idbLoadPersistedErrors();
  },

  /**
   * Insert a batch of entries at the HEAD of the ring buffer, oldest
   * dropped if capacity (MAX_LOG_ENTRIES) is exceeded. Used by the
   * boot path to surface the last-100 errors from IDB BEFORE live
   * buffer activity that occurred during boot.
   *
   * No-op when `entries` is empty. Calls `sink` exactly once with
   * the last prepended entry so any active subscriber re-renders
   * once. Sink errors are swallowed (same contract as `push`).
   */
  prepend(entries: readonly LogEntry[]): void {
    if (entries.length === 0) return;
    const newBuffer = [...entries, ...buffer];
    if (newBuffer.length > MAX_LOG_ENTRIES) {
      newBuffer.splice(0, newBuffer.length - MAX_LOG_ENTRIES);
    }
    buffer = newBuffer;
    if (sink) {
      try {
        sink(entries[entries.length - 1]!);
      } catch {
        /* sink errors must not break the buffer pipeline */
      }
    }
  },
};