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
 * @see ./cleanLogArgs.ts — CSS-strip utility used here.
 */

import { cleanLogArgs } from './cleanLogArgs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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

let installed = false;
let buffer: LogEntry[] = [];
let sink: LogSink | null = null;
let nextId = 0;

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

const push = (
  level: LogLevel,
  args: readonly unknown[],
  source?: string,
): void => {
  const cleaned = cleanLogArgs(args);
  const first = typeof cleaned[0] === 'string' ? cleaned[0] : null;
  const entry: LogEntry = {
    id: ++nextId,
    level,
    text: joinArgs(cleaned),
    args: cleaned.slice(),
    source: source ?? detectSource(first),
    ts: Date.now(),
  };

  buffer.push(entry);
  if (buffer.length > MAX_LOG_ENTRIES) buffer.shift();

  if (sink) {
    try {
      sink(entry);
    } catch {
      /* sink errors must not break the buffer pipeline */
    }
  }
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
  },

  push,
};