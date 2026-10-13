import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { triggerHaptic, triggerSnapPulse, cancelHaptic } from './haptics';

/**
 * Haptics unit tests — verify the safe-capability gate, the
 * non-throwing behaviour on missing API, and the call contract
 * with the underlying `navigator.vibrate`. We mock navigator.vibrate
 * per-test since jsdom doesn't ship it.
 */

const setVibrate = (impl: ((ms: number) => boolean) | null): void => {
  if (impl === null) {
    Object.defineProperty(navigator, 'vibrate', {
      value: undefined, writable: true, configurable: true,
    });
  } else {
    Object.defineProperty(navigator, 'vibrate', {
      value: impl, writable: true, configurable: true,
    });
  }
};

const setVibrateThrowing = (): void => {
  Object.defineProperty(navigator, 'vibrate', {
    value: (): boolean => { throw new Error('vibrate rejected'); },
    writable: true, configurable: true,
  });
};

describe('haptics — capability gate', () => {
  beforeEach(() => {
    setVibrate(null);
  });

  it('triggerHaptic returns false when navigator.vibrate is undefined', () => {
    expect(triggerHaptic(5)).toBe(false);
  });

  it('triggerSnapPulse returns false when API missing', () => {
    expect(triggerSnapPulse()).toBe(false);
  });

  it('cancelHaptic returns false when API missing', () => {
    expect(cancelHaptic()).toBe(false);
  });

  it('triggerHaptic returns false for ms <= 0 (no-op call)', () => {
    setVibrate(() => true);
    expect(triggerHaptic(0)).toBe(false);
    expect(triggerHaptic(-5)).toBe(false);
  });
});

describe('haptics — call contract', () => {
  let calls: Array<number>;
  let spy: (ms: number) => boolean;

  beforeEach(() => {
    calls = [];
    spy = (ms: number): boolean => {
      calls.push(ms);
      return true;
    };
    setVibrate(spy);
  });

  afterEach(() => {
    setVibrate(null);
  });

  it('triggerHaptic(5) forwards 5 to navigator.vibrate', () => {
    expect(triggerHaptic(5)).toBe(true);
    expect(calls).toEqual([5]);
  });

  it('triggerSnapPulse forwards 10', () => {
    expect(triggerSnapPulse()).toBe(true);
    expect(calls).toEqual([10]);
  });

  it('cancelHaptic forwards 0', () => {
    expect(cancelHaptic()).toBe(true);
    expect(calls).toEqual([0]);
  });

  it('triggerHaptic catches throws and returns false (no propagation)', () => {
    setVibrateThrowing();
    expect(triggerHaptic(5)).toBe(false);
  });
});

describe('haptics — iOS Safari reality (no API, no error)', () => {
  it('does not throw on iOS Safari (no navigator.vibrate)', () => {
    setVibrate(null);
    expect(() => triggerHaptic(5)).not.toThrow();
    expect(() => triggerSnapPulse()).not.toThrow();
    expect(() => cancelHaptic()).not.toThrow();
  });
});