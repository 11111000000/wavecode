import { describe, it, expect } from 'vitest';
import { evalWithTransport } from './evalWithTransport';
import type { Score, TransportState } from '~/domain/types';

const SCORE: Score = 'note("<a b c d>").s("sawtooth").gain(0.4)';

const transport = (overrides: Partial<TransportState> = {}): TransportState => ({
  cps: 0.5,
  swingAmount: 0,
  swingDivisor: '1/8',
  ...overrides,
});

describe('evalWithTransport', () => {
  it('returns the score unchanged when swingAmount=0 (off)', () => {
    const result = evalWithTransport(SCORE, transport({ swingAmount: 0 }));
    expect(result).toBe(SCORE);
  });

  it('wraps the score in `.swing(0.5, 1/8)` when swingAmount=0.5', () => {
    const result = evalWithTransport(SCORE, transport({ swingAmount: 0.5 }));
    expect(result).toBe(`(${SCORE}).swing(0.5, 1/8)`);
  });

  it('respects custom divisor', () => {
    const result = evalWithTransport(
      SCORE,
      transport({ swingAmount: 0.3, swingDivisor: '1/16' }),
    );
    expect(result).toBe(`(${SCORE}).swing(0.3, 1/16)`);
  });

  it('does not mutate the input score (pure)', () => {
    const before = SCORE;
    evalWithTransport(SCORE, transport({ swingAmount: 0.7 }));
    expect(SCORE).toBe(before);
  });

  it('produces a string that is a single Strudel expression', () => {
    const result = evalWithTransport(SCORE, transport({ swingAmount: 0.5 }));
    expect(result.startsWith('(')).toBe(true);
    expect(result.endsWith(')')).toBe(true);
  });
});
