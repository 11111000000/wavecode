/**
 * IDB-backed slice of error-level log entries.
 *
 * Why this exists
 * ---------------
 * Without persistence, a page reload wipes the in-memory console buffer
 * and the user loses the last error trace. We persist only ERROR/FATAL
 * entries (the slice that matters when debugging "what broke?") up to a
 * small ring so the IndexedDB quota never grows.
 *
 * Failure modes
 * -------------
 * `idb-keyval` is loaded via `await import(...)` so the module is
 * tree-shakeable and the SPA still boots in environments that don't
 * provide IndexedDB (test runners that mock the entire window). When
 * the dynamic import rejects, all three functions return the empty
 * result / no-op without throwing.
 *
 * On write failure (quota exceeded, IDB blocked) we swallow the error
 * and emit a single `console.warn`. The patched `console.warn` flows
 * through the same `cleanLogArgs` pipeline as any other log; we
 * intentionally do not import `logger` here to avoid a circular import
 * (logger imports this module).
 */

import type { LogEntry } from './logger';

export const PERSISTED_ENTRY_LIMIT = 100;
export const PERSISTED_KEY = 'wavecode:console:errors';

const isErrorLevel = (entry: { readonly level: LogEntry['level'] }): boolean =>
  entry.level === 'error' || entry.level === 'fatal';

const safeWarn = (msg: string): void => {
  // Falls through logger.install's patched console.warn when the host
  // has booted it; bare console.warn otherwise. Either way: no throw.
  try {
    console.warn(msg);
  } catch {
    /* ignore */
  }
};

type IdbModule = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  del: (key: string) => Promise<void>;
};

const importIdb = async (): Promise<IdbModule | null> => {
  try {
    const mod = (await import('idb-keyval')) as unknown as IdbModule;
    return mod;
  } catch {
    return null;
  }
};

/** Load the persisted error slice, or [] when unset / unavailable. */
export const loadPersistedErrors = async (): Promise<readonly LogEntry[]> => {
  const idb = await importIdb();
  if (!idb) return [];
  try {
    const stored = await idb.get(PERSISTED_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter(isErrorLevel);
  } catch {
    return [];
  }
};

/**
 * Write the last `PERSISTED_ENTRY_LIMIT` ERROR/FATAL entries to IDB.
 * Non-error entries in the input are filtered out before slicing. This
 * function never throws — quota / permission failures are logged via
 * `console.warn` and swallowed.
 */
export const savePersistedErrors = (
  entries: readonly LogEntry[],
): Promise<void> => {
  return (async () => {
    const idb = await importIdb();
    if (!idb) return;
    try {
      const errorSlice = entries
        .filter(isErrorLevel)
        .slice(-PERSISTED_ENTRY_LIMIT);
      await idb.set(PERSISTED_KEY, errorSlice);
    } catch (e: unknown) {
      safeWarn(
        `[wavecode] failed to persist console errors: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  })();
};

/** Remove the persisted error slice. No-op when IDB is unavailable. */
export const clearPersistedErrors = async (): Promise<void> => {
  const idb = await importIdb();
  if (!idb) return;
  try {
    await idb.del(PERSISTED_KEY);
  } catch (e: unknown) {
    safeWarn(
      `[wavecode] failed to clear persisted console errors: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
};