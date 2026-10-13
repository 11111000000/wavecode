import { describe, it, expect, beforeEach } from 'vitest';
import { consoleStore, toastError } from './consoleStore';

/**
 * store tests run against the live module-level signal. We reset before
 * each test via consoleStore.reset() so toasts/console state don't leak.
 */

describe('consoleStore', () => {
  beforeEach(() => {
    consoleStore.reset();
  });

  it('starts empty', () => {
    expect(consoleStore.toasts()).toEqual([]);
    expect(consoleStore.consoleOpen()).toBe(false);
    expect(consoleStore.unreadErrors()).toBe(0);
  });

  it('pushToast adds a toast and returns its id', () => {
    const id = consoleStore.pushToast({
      severity: 'info',
      title: 'hello',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    const list = consoleStore.toasts();
    expect(list).toHaveLength(1);
    const t0 = list[0]!;
    expect(t0.id).toBe(id);
    expect(t0.severity).toBe('info');
    expect(t0.title).toBe('hello');
  });

  it('pushToast caps array at MAX_TOASTS (4), drops oldest non-sticky first', () => {
    consoleStore.pushToast({ severity: 'info', title: 'a' });
    consoleStore.pushToast({ severity: 'info', title: 'b' });
    consoleStore.pushToast({ severity: 'info', title: 'c' });
    consoleStore.pushToast({ severity: 'info', title: 'd' });
    // Already 4, the next push drops "a" (oldest non-sticky).
    consoleStore.pushToast({ severity: 'info', title: 'e' });
    const list = consoleStore.toasts();
    expect(list).toHaveLength(4);
    expect(list.map((t) => t.title)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('caps by dropping sticky only as last resort', () => {
    // First two are sticky (critical ttl=0), next three are info.
    consoleStore.pushToast({ severity: 'critical', title: 'sticky-1' });
    consoleStore.pushToast({ severity: 'critical', title: 'sticky-2' });
    consoleStore.pushToast({ severity: 'info', title: 'i-1' });
    consoleStore.pushToast({ severity: 'info', title: 'i-2' });
    // 4 toasts already (2 sticky + 2 info), next info should evict 'i-1'.
    consoleStore.pushToast({ severity: 'info', title: 'i-3' });
    expect(consoleStore.toasts().map((t) => t.title))
      .toEqual(['sticky-1', 'sticky-2', 'i-2', 'i-3']);
  });

  it('dismissToast removes a toast by id', () => {
    const id = consoleStore.pushToast({ severity: 'info', title: 'x' });
    expect(consoleStore.toasts()).toHaveLength(1);
    consoleStore.dismissToast(id);
    expect(consoleStore.toasts()).toEqual([]);
  });

  it('clearToasts wipes the list', () => {
    consoleStore.pushToast({ severity: 'info', title: 'x' });
    consoleStore.pushToast({ severity: 'info', title: 'y' });
    consoleStore.clearToasts();
    expect(consoleStore.toasts()).toEqual([]);
  });

  it('error severity increments unreadErrors', () => {
    consoleStore.pushToast({ severity: 'error', title: 'e1' });
    expect(consoleStore.unreadErrors()).toBe(1);
    consoleStore.pushToast({ severity: 'error', title: 'e2' });
    expect(consoleStore.unreadErrors()).toBe(2);
  });

  it('critical severity increments unreadErrors', () => {
    consoleStore.pushToast({ severity: 'critical', title: 'c1' });
    expect(consoleStore.unreadErrors()).toBe(1);
  });

  it('info / warn severity does NOT touch unreadErrors', () => {
    consoleStore.pushToast({ severity: 'info', title: 'i' });
    consoleStore.pushToast({ severity: 'warn', title: 'w' });
    expect(consoleStore.unreadErrors()).toBe(0);
  });

  it('markAllRead resets unreadErrors to 0', () => {
    consoleStore.pushToast({ severity: 'error', title: 'e1' });
    consoleStore.pushToast({ severity: 'error', title: 'e2' });
    expect(consoleStore.unreadErrors()).toBe(2);
    consoleStore.markAllRead();
    expect(consoleStore.unreadErrors()).toBe(0);
  });

  it('setConsoleOpen(true) implicitly marks all read', () => {
    consoleStore.pushToast({ severity: 'error', title: 'e1' });
    expect(consoleStore.unreadErrors()).toBe(1);
    consoleStore.setConsoleOpen(true);
    expect(consoleStore.consoleOpen()).toBe(true);
    expect(consoleStore.unreadErrors()).toBe(0);
  });

  it('setConsoleOpen(false) does NOT change unreadErrors', () => {
    consoleStore.pushToast({ severity: 'error', title: 'e1' });
    expect(consoleStore.unreadErrors()).toBe(1);
    consoleStore.setConsoleOpen(false);
    expect(consoleStore.consoleOpen()).toBe(false);
    expect(consoleStore.unreadErrors()).toBe(1);
  });

  it('toastError convenience pushes an error toast', () => {
    toastError({ title: 'boom', source: 'test' });
    const list = consoleStore.toasts();
    expect(list).toHaveLength(1);
    const t0 = list[0]!;
    expect(t0.severity).toBe('error');
    expect(t0.title).toBe('boom');
    expect(t0.source).toBe('test');
    expect(consoleStore.unreadErrors()).toBe(1);
  });

  it('default TTL by severity (info=4000, warn=6000, error=8000, critical=0)', () => {
    const info = consoleStore.pushToast({ severity: 'info', title: 'i' });
    const warn = consoleStore.pushToast({ severity: 'warn', title: 'w' });
    const err = consoleStore.pushToast({ severity: 'error', title: 'e' });
    const crit = consoleStore.pushToast({ severity: 'critical', title: 'c' });
    const get = (id: string): number => {
      const t = consoleStore.toasts().find((t) => t.id === id);
      if (!t) throw new Error(`toast ${id} not found`);
      return t.ttlMs;
    };
    expect(get(info)).toBe(4000);
    expect(get(warn)).toBe(6000);
    expect(get(err)).toBe(8000);
    expect(get(crit)).toBe(0);
  });

  it('explicit ttlMs overrides the default', () => {
    const id = consoleStore.pushToast({
      severity: 'info', title: 'i', ttlMs: 12345,
    });
    const t = consoleStore.toasts().find((t) => t.id === id);
    if (!t) throw new Error('toast not found');
    expect(t.ttlMs).toBe(12345);
  });
});
