import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  logger,
  MAX_LOG_ENTRIES,
  type LogEntry,
} from './logger';

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
});