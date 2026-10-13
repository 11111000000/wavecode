import { vi, describe, it, expect, beforeEach } from 'vitest';

// `vi.mock` is hoisted to the top of the file by vitest, so the factory
// below replaces the `idb-keyval` module BEFORE `idbBuffer.ts` (or its
// tests) load. The dynamic `await import('idb-keyval')` inside
// idbBuffer resolves to this mock at runtime.
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

import * as idb from 'idb-keyval';
import {
  loadPersistedErrors,
  savePersistedErrors,
  clearPersistedErrors,
  PERSISTED_ENTRY_LIMIT,
  PERSISTED_KEY,
} from './idbBuffer';
import type { LogEntry } from './logger';

const makeEntry = (id: number, level: LogEntry['level'], text: string): LogEntry => ({
  id,
  level,
  text,
  args: [text],
  source: 'app',
  ts: 1_700_000_000_000 + id,
});

describe('idbBuffer (with mocked idb-keyval)', () => {
  beforeEach(() => {
    vi.mocked(idb.get).mockClear();
    vi.mocked(idb.set).mockClear();
    vi.mocked(idb.del).mockClear();
  });

  it('loadPersistedErrors returns [] when the key is unset', async () => {
    vi.mocked(idb.get).mockResolvedValueOnce(undefined);
    const out = await loadPersistedErrors();
    expect(out).toEqual([]);
  });

  it('loadPersistedErrors returns the parsed array when the key is set', async () => {
    const entries = [makeEntry(1, 'error', 'oops'), makeEntry(2, 'warn', 'hm')];
    vi.mocked(idb.get).mockResolvedValueOnce(entries);
    const out = await loadPersistedErrors();
    // Non-error entries are filtered out.
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe('oops');
  });

  it('savePersistedErrors writes the last PERSISTED_ENTRY_LIMIT ERROR entries', async () => {
    const all: LogEntry[] = [];
    // 120 error entries, 5 warn entries, 5 info entries — total 130.
    for (let i = 0; i < 120; i++) all.push(makeEntry(i, 'error', `err-${i}`));
    for (let i = 0; i < 5; i++) all.push(makeEntry(120 + i, 'warn', `warn-${i}`));
    for (let i = 0; i < 5; i++) all.push(makeEntry(125 + i, 'info', `info-${i}`));

    await savePersistedErrors(all);

    expect(idb.set).toHaveBeenCalledTimes(1);
    const [key, payload] = vi.mocked(idb.set).mock.calls[0]!;
    expect(key).toBe(PERSISTED_KEY);
    expect(Array.isArray(payload)).toBe(true);
    const slice = payload as ReadonlyArray<LogEntry>;
    expect(slice.length).toBe(PERSISTED_ENTRY_LIMIT);
    expect(slice[0]?.text).toBe('err-20');
    expect(slice[slice.length - 1]?.text).toBe('err-119');
  });

  it('clearPersistedErrors removes the key', async () => {
    await clearPersistedErrors();
    expect(idb.del).toHaveBeenCalledTimes(1);
    expect(idb.del).toHaveBeenCalledWith(PERSISTED_KEY);
  });

  it('savePersistedErrors swallows IDB.set failures without throwing', async () => {
    vi.mocked(idb.set).mockRejectedValueOnce(new Error('QuotaExceededError'));
    const entries = [makeEntry(1, 'error', 'boom')];
    await expect(savePersistedErrors(entries)).resolves.toBeUndefined();
  });

  it('loadPersistedErrors returns [] when IDB.get rejects', async () => {
    vi.mocked(idb.get).mockRejectedValueOnce(new Error('IDB blocked'));
    const out = await loadPersistedErrors();
    expect(out).toEqual([]);
  });

  it('clearPersistedErrors swallows IDB.del failures without throwing', async () => {
    vi.mocked(idb.del).mockRejectedValueOnce(new Error('blocked'));
    await expect(clearPersistedErrors()).resolves.toBeUndefined();
  });

  it('loadPersistedErrors filters out non-error/non-fatal entries', async () => {
    const stored = [
      makeEntry(1, 'error', 'real'),
      makeEntry(2, 'info', 'noisy'),
      makeEntry(3, 'warn', 'less-noisy'),
      makeEntry(4, 'fatal', 'death'),
    ];
    vi.mocked(idb.get).mockResolvedValueOnce(stored);
    const out = await loadPersistedErrors();
    expect(out.map((e) => e.text)).toEqual(['real', 'death']);
  });
});

describe('idbBuffer (idb-keyval import rejection)', () => {
  it('loadPersistedErrors returns [] when the dynamic import rejects', async () => {
    // Save the working mock, force a rejection, restore after.
    const realGet = idb.get;
    Object.defineProperty(idb, 'get', {
      configurable: true,
      get: () => {
        throw new Error('module not found');
      },
    });
    try {
      const out = await loadPersistedErrors();
      expect(out).toEqual([]);
    } finally {
      Object.defineProperty(idb, 'get', { configurable: true, value: realGet });
    }
  });
});