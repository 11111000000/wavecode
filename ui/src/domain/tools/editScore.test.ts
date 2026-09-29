import { describe, it, expect } from 'vitest';
import { applyEdit } from './editScore';

describe('applyEdit', () => {
  it('replaces a single occurrence of oldText with newText', () => {
    const score = 'line A\nline B\nline C';
    expect(applyEdit(score, 'line B', 'LINE B')).toBe('line A\nLINE B\nline C');
  });

  it('throws when oldText is not found', () => {
    const score = 'foo bar baz';
    expect(() => applyEdit(score, 'qux', 'X')).toThrow('oldText not found');
  });

  it('throws when oldText occurs more than once (ambiguous)', () => {
    const score = 'foo\nfoo\nbar';
    expect(() => applyEdit(score, 'foo', 'baz')).toThrow('more than once');
  });

  it('handles multi-line oldText', () => {
    const score = 'a\nb\nc\nd';
    expect(applyEdit(score, 'b\nc', 'B\nC')).toBe('a\nB\nC\nd');
  });
});
