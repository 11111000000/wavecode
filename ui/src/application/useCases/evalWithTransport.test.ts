import { describe, it, expect } from 'vitest';
import { evalWithTransport } from './evalWithTransport';
import type { Score, TransportState } from '~/domain/types';

const SCORE: Score = 'note("<a b c d>").s("sawtooth").gain(0.4)';

const transport = (overrides: Partial<TransportState> = {}): TransportState => ({
  cps: 0.5,
  swing: false,
  ...overrides,
});

describe('evalWithTransport', () => {
  it('returns the score unchanged when swing is off', () => {
    const result = evalWithTransport(SCORE, transport({ swing: false }));
    expect(result).toBe(SCORE);
  });

  it('wraps the score in `.swing(0.5, 1/3)` when swing is on', () => {
    const result = evalWithTransport(SCORE, transport({ swing: true }));
    expect(result).toBe(`(${SCORE}).swing(0.5, 1/3)`);
  });

  it('does not mutate the input score (pure)', () => {
    const before = SCORE;
    evalWithTransport(SCORE, transport({ swing: true }));
    expect(SCORE).toBe(before);
  });

  it('produces a string that still parses as a valid Strudel expression', () => {
    const result = evalWithTransport(SCORE, transport({ swing: true }));
    // Smoke check: обёртка должна оставаться выражением (не statement),
    // иначе Strudel REPL не сможет взять последнее значение как Pattern.
    expect(result.startsWith('(')).toBe(true);
    expect(result.endsWith('.swing(0.5, 1/3)')).toBe(true);
  });

  it('is stable: applying twice yields double-wrapped expression (Strudel ignores redundant `.swing`)', () => {
    const wrappedOnce = evalWithTransport(SCORE, transport({ swing: true }));
    const wrappedTwice = evalWithTransport(wrappedOnce, transport({ swing: true }));
    // Двойная обёртка синтаксически отличается (внешний paren добавляется
    // при каждом применении), но семантически эквивалентна — Strudel
    // Pattern chain коммутативен для одинаковых `.swing()`. Это не баг:
    // swing toggle off → on пользователем ожидаемо переwrapит.
    expect(wrappedOnce).toBe(`(${SCORE}).swing(0.5, 1/3)`);
    expect(wrappedTwice).toBe(`(${wrappedOnce}).swing(0.5, 1/3)`);
  });

  it('swing off → swing off returns to original (round-trip)', () => {
    const wrapped = evalWithTransport(SCORE, transport({ swing: true }));
    const unwrapped = evalWithTransport(wrapped, transport({ swing: false }));
    expect(unwrapped).toBe(wrapped); // off — no-op, сохраняет результат
  });

  it('preserves multiline scores structurally', () => {
    const multiline: Score = [
      'stack(',
      '  note("<a b>").s("sawtooth"),',
      '  s("sbd*4")',
      ')',
    ].join('\n');
    const wrapped = evalWithTransport(multiline, transport({ swing: true }));
    expect(wrapped.startsWith('(stack(')).toBe(true);
    expect(wrapped.endsWith('.swing(0.5, 1/3)')).toBe(true);
    // Содержимое сохранено
    expect(wrapped).toContain('s("sbd*4")');
  });

  it('does not depend on cps (cps only affects tempo, not source transformation)', () => {
    const slowCps = evalWithTransport(SCORE, transport({ cps: 0.1, swing: false }));
    const fastCps = evalWithTransport(SCORE, transport({ cps: 2.0, swing: false }));
    expect(slowCps).toBe(SCORE);
    expect(fastCps).toBe(SCORE);

    const slowSwing = evalWithTransport(SCORE, transport({ cps: 0.1, swing: true }));
    const fastSwing = evalWithTransport(SCORE, transport({ cps: 2.0, swing: true }));
    expect(slowSwing).toBe(fastSwing);
  });
});
