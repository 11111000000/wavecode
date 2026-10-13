import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// Mock idb-keyval so the dynamic import inside idbBuffer resolves to a
// controllable spy. The mock factory is run before any test imports
// anything else, so loadPersistedErrors/savePersistedErrors pick up
// the spies on their first dynamic-import call.
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
  logger,
  MAX_LOG_ENTRIES,
  type LogEntry,
} from './logger';
import { PERSISTED_KEY } from './idbBuffer';

describe('logger', () => {
  let savedLog: typeof console.log;
  let savedInfo: typeof console.info;
  let savedWarn: typeof console.warn;
  let savedError: typeof console.error;

  beforeAll(() => {
    // Silently mock the native console methods BEFORE install captures
    // them. install() saves the current console.log/info/warn/error as
    // its "original" reference; spying first means the patch's native
    // calls land on a silent mock instead of polluting test stdout. The
    // spies stay installed for the whole suite — install is idempotent.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.install();
  });

  beforeEach(() => {
    savedLog = console.log;
    savedInfo = console.info;
    savedWarn = console.warn;
    savedError = console.error;
    logger.clear();
    logger.setSink(null);
  });

  afterEach(() => {
    console.log = savedLog;
    console.info = savedInfo;
    console.warn = savedWarn;
    console.error = savedError;
  });

  it('install() is idempotent (second call does not re-patch)', () => {
    const ref = console.log;
    logger.install();
    expect(console.log).toBe(ref);
    const refErr = console.error;
    logger.install();
    expect(console.error).toBe(refErr);
  });

  it('captures console.log into the buffer with level=info, source=app', () => {
    console.log('hello');
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0]?.level).toBe('info');
    expect(buf[0]?.text).toBe('hello');
    expect(buf[0]?.source).toBe('app');
  });

  it('captures console.error into the buffer with level=error', () => {
    console.error('boom');
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0]?.level).toBe('error');
    expect(buf[0]?.text).toBe('boom');
  });

  it('captures console.warn into the buffer with level=warn', () => {
    console.warn('careful');
    const buf = logger.getBuffer();
    expect(buf[0]?.level).toBe('warn');
    expect(buf[0]?.text).toBe('careful');
  });

  it('setSink notifies the sink for each subsequent log', () => {
    const entries: LogEntry[] = [];
    logger.setSink((entry) => entries.push(entry));
    console.log('one');
    console.warn('two');
    console.error('three');
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.level)).toEqual(['info', 'warn', 'error']);
    expect(entries.map((e) => e.text)).toEqual(['one', 'two', 'three']);
  });

  it('clear() empties the buffer', () => {
    console.log('one');
    console.log('two');
    expect(logger.getBuffer()).toHaveLength(2);
    logger.clear();
    expect(logger.getBuffer()).toHaveLength(0);
  });

  it('buffer caps at MAX_LOG_ENTRIES (push 600, expect 500, oldest dropped)', () => {
    for (let i = 0; i < 600; i++) {
      logger.push('info', [`msg-${i}`]);
    }
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(MAX_LOG_ENTRIES);
    expect(buf[0]?.text).toBe('msg-100');
    expect(buf[buf.length - 1]?.text).toBe('msg-599');
  });

  it('source detection: [wavecode] → wavecode, [sampler] → sampler, unknown → app', () => {
    console.log('[wavecode] hi');
    console.log('[sampler] load');
    console.log('plain message');
    const buf = logger.getBuffer();
    expect(buf[0]?.source).toBe('wavecode');
    expect(buf[1]?.source).toBe('sampler');
    expect(buf[2]?.source).toBe('app');
  });

  it('source detection: [strudel] detected after %c strip', () => {
    console.log('%c[strudel] hello', 'background-color: black;color:white;border-radius:15px');
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0]?.source).toBe('strudel');
    expect(buf[0]?.text).toBe('[strudel] hello');
    expect(buf[0]?.args).toEqual(['[strudel] hello']);
  });

  it('strips CSS args from the buffered entry (native call gets cleaned args too)', () => {
    const spy = vi.spyOn(console, 'log');
    console.log(
      '%c[eval] code updated',
      'background-color: black;color:white;border-radius:15px',
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0]?.args).toEqual(['[eval] code updated']);
    expect(buf[0]?.text).toBe('[eval] code updated');
    expect(buf[0]?.source).toBe('eval');
  });

  it('push() works for non-console callers with explicit source', () => {
    logger.push('warn', ['something went wrong'], 'cyclist');
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0]?.level).toBe('warn');
    expect(buf[0]?.text).toBe('something went wrong');
    expect(buf[0]?.source).toBe('cyclist');
  });

  it('getBuffer() returns a frozen array — consumers cannot mutate', () => {
    console.log('a');
    const buf = logger.getBuffer();
    expect(Object.isFrozen(buf)).toBe(true);
    expect(() => {
      (buf as unknown as unknown[]).push('x');
    }).toThrow();
  });

  it('entries carry monotonic ids and timestamps', async () => {
    console.log('first');
    await new Promise((r) => setTimeout(r, 2));
    console.log('second');
    const buf = logger.getBuffer();
    expect(buf[1]!.id).toBeGreaterThan(buf[0]!.id);
    expect(buf[1]!.ts).toBeGreaterThanOrEqual(buf[0]!.ts);
  });

  it('sink errors do not break the buffer pipeline', () => {
    logger.setSink(() => {
      throw new Error('sink boom');
    });
    expect(() => console.log('still works')).not.toThrow();
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0]?.text).toBe('still works');
  });

  describe('Phase 2 enhancements', () => {
    beforeEach(() => {
      vi.mocked(idb.get).mockClear();
      vi.mocked(idb.set).mockClear();
      vi.mocked(idb.del).mockClear();
    });

    it("'fatal' level entries land in the buffer with level='fatal'", () => {
      logger.push('fatal', ['something catastrophic']);
      const buf = logger.getBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0]?.level).toBe('fatal');
      expect(buf[0]?.text).toBe('something catastrophic');
    });

  it('6 identical warnings in 100ms → 5 originals + 1 throttle-suppression entry', () => {
    for (let i = 0; i < 6; i++) {
      logger.push('warn', ['spam'], 'noisy');
    }
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(6);
    const originals = buf.filter((e) => e.text === 'spam');
    const suppressions = buf.filter((e) => e.text.includes('similar messages suppressed'));
    expect(originals).toHaveLength(5);
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]?.source).toBe('noisy');
    expect(suppressions[0]?.level).toBe('warn');
  });

  it('different sources are throttled independently', () => {
    for (let i = 0; i < 6; i++) {
      logger.push('warn', ['a'], 'src-a');
      logger.push('warn', ['b'], 'src-b');
    }
    const buf = logger.getBuffer();
    const a = buf.filter((e) => e.source === 'src-a');
    const b = buf.filter((e) => e.source === 'src-b');
    const aOriginals = a.filter((e) => e.text === 'a');
    const bOriginals = b.filter((e) => e.text === 'b');
    const aSuppression = a.filter((e) => e.text.includes('suppressed'));
    const bSuppression = b.filter((e) => e.text.includes('suppressed'));
    expect(aOriginals).toHaveLength(5);
    expect(bOriginals).toHaveLength(5);
    expect(aSuppression).toHaveLength(1);
    expect(bSuppression).toHaveLength(1);
  });

  it("'info' and 'debug' levels are NOT throttled", () => {
    for (let i = 0; i < 20; i++) {
      logger.push('info', ['i'], 'loud');
      logger.push('debug', ['d'], 'loud');
    }
    const buf = logger.getBuffer();
    expect(buf.filter((e) => e.text === 'i')).toHaveLength(20);
    expect(buf.filter((e) => e.text === 'd')).toHaveLength(20);
    expect(buf.filter((e) => e.text.includes('suppressed'))).toHaveLength(0);
  });

  it('ERROR entries trigger savePersistedErrors (fire-and-forget)', async () => {
    logger.push('error', ['an error happened']);
    // Allow the microtask queue to flush.
    await new Promise((r) => setTimeout(r, 10));
    expect(idb.set).toHaveBeenCalled();
    const calls = vi.mocked(idb.set).mock.calls;
    const last = calls[calls.length - 1]!;
    expect(last[0]).toBe(PERSISTED_KEY);
    const payload = last[1] as ReadonlyArray<LogEntry>;
    expect(payload.some((e) => e.text === 'an error happened')).toBe(true);
  });

  it('FATAL entries also trigger savePersistedErrors', async () => {
    logger.push('fatal', ['the app is on fire']);
    await new Promise((r) => setTimeout(r, 10));
    expect(idb.set).toHaveBeenCalled();
    const calls = vi.mocked(idb.set).mock.calls;
    const last = calls[calls.length - 1]!;
    const payload = last[1] as ReadonlyArray<LogEntry>;
    expect(payload.some((e) => e.text === 'the app is on fire' && e.level === 'fatal')).toBe(true);
  });

  it('loadPersistedErrors returns [] when IDB has no entry', async () => {
    vi.mocked(idb.get).mockResolvedValueOnce(undefined);
    const out = await logger.loadPersistedErrors();
    expect(out).toEqual([]);
  });

  it('prepend([]) is a no-op (no sink notification, buffer unchanged)', () => {
    logger.push('info', ['live-1']);
    const sinkCalls: LogEntry[] = [];
    logger.setSink((e) => sinkCalls.push(e));
    logger.prepend([]);
    expect(logger.getBuffer()).toHaveLength(1);
    expect(sinkCalls).toHaveLength(0);
  });

  it('prepend(entries) inserts at the HEAD of the buffer and notifies the sink', () => {
    logger.push('info', ['live-1']);
    logger.push('info', ['live-2']);
    const persisted: LogEntry[] = [
      {
        id: 9001,
        level: 'error',
        text: 'persisted-1',
        args: ['persisted-1'],
        source: 'app',
        ts: 1_700_000_000_000,
      },
      {
        id: 9002,
        level: 'error',
        text: 'persisted-2',
        args: ['persisted-2'],
        source: 'app',
        ts: 1_700_000_000_001,
      },
    ];
    const sinkCalls: LogEntry[] = [];
    logger.setSink((e) => sinkCalls.push(e));
    logger.prepend(persisted);

    const buf = logger.getBuffer();
    expect(buf.map((e) => e.text)).toEqual([
      'persisted-1',
      'persisted-2',
      'live-1',
      'live-2',
    ]);
    expect(sinkCalls).toHaveLength(1);
    expect(sinkCalls[0]?.text).toBe('persisted-2');
  });

  it('prepend drops the oldest entries once MAX_LOG_ENTRIES is exceeded', () => {
    // Fill the live ring to near capacity with live entries.
    for (let i = 0; i < MAX_LOG_ENTRIES - 2; i++) {
      logger.push('info', [`live-${i}`]);
    }
    expect(logger.getBuffer()).toHaveLength(MAX_LOG_ENTRIES - 2);

    // Prepend 5 entries — total 503, cap is 500. The 3 oldest
    // entries in chronological order (persisted-0, persisted-1,
    // persisted-2 — they're the OLDEST since they come from before
    // the page reload) get dropped to make room.
    const persisted: LogEntry[] = Array.from({ length: 5 }, (_, i) => ({
      id: 8000 + i,
      level: 'error',
      text: `persisted-${i}`,
      args: [`persisted-${i}`],
      source: 'app',
      ts: 1_700_000_000_000 + i,
    }));
    logger.prepend(persisted);

    const buf = logger.getBuffer();
    expect(buf).toHaveLength(MAX_LOG_ENTRIES);
    // First 3 persisted entries (the oldest of the prepend) are gone.
    expect(buf[0]?.text).toBe('persisted-3');
    expect(buf[1]?.text).toBe('persisted-4');
    expect(buf[2]?.text).toBe('live-0');
    expect(buf[3]?.text).toBe('live-1');
    expect(buf[buf.length - 1]?.text).toBe(`live-${MAX_LOG_ENTRIES - 3}`);
  });

  it('throttle resets after windowMs passes', async () => {
    // Five warnings in a tight burst.
    for (let i = 0; i < 5; i++) {
      logger.push('warn', ['burst'], 'reset-source');
    }
    const buf1 = logger.getBuffer();
    expect(buf1.filter((e) => e.text === 'burst')).toHaveLength(5);

    // Clear buffer + throttle history; the next push should NOT be
    // considered a continuation of the previous burst.
    logger.clear();
    logger.push('warn', ['after-window'], 'reset-source');
    const buf2 = logger.getBuffer();
    expect(buf2.filter((e) => e.text === 'after-window')).toHaveLength(1);
    expect(buf2.filter((e) => e.text.includes('suppressed'))).toHaveLength(0);
  });
  });
});