import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeSnippet,
  decodeSnippet,
  parseShareUrl,
  SHARE_URL_LIMIT,
  SHARE_PARAM,
  SHARE_TS_PARAM,
} from './urlCodec';

const realLocation = window.location;

const stubLocation = (overrides: Partial<Location>): void => {
  Object.defineProperty(window, 'location', {
    value: { ...realLocation, ...overrides },
    writable: true,
    configurable: true,
  });
};

describe('urlCodec', () => {
  beforeEach(() => {
    stubLocation({ origin: 'https://wavecode.app', pathname: '/' });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: realLocation,
      writable: true,
      configurable: true,
    });
    vi.useRealTimers();
  });

  describe('encodeSnippet', () => {
    it('produces a URL with ?s= and &t= params and same-origin path', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T12:34:56.000Z'));
      const result = encodeSnippet('note("c4")');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.url).toMatch(/^https:\/\/wavecode\.app\/\?s=([^&]+)&t=\d+$/);
      const ts = new URL(result.url).searchParams.get(SHARE_TS_PARAM);
      expect(ts).toBe(String(Date.parse('2026-01-15T12:34:56.000Z')));
    });

    it('round-trips ASCII and Unicode scores', () => {
      const samples = [
        '',
        'note("c4")',
        'stack(\n  note("c3").s("sawtooth"),\n  s("bd*4")\n)',
        '// комментарий на кириллице\nnote("c4")',
        '// emoji 🎵✨\nnote("c4")',
      ];
      for (const text of samples) {
        const result = encodeSnippet(text);
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const encoded = new URL(result.url).searchParams.get(SHARE_PARAM);
        expect(encoded).toBeTypeOf('string');
        if (encoded === null) continue;
        expect(decodeSnippet(encoded)).toBe(text);
      }
    });

    it('returns too-large for scores that exceed 8KB after encoding', () => {
      // Incompressible payload (lz-string can't shrink random noise).
      // 16KB of pseudo-random ASCII guarantees the encoded form stays > 8KB.
      const huge = Array.from({ length: 16_000 }, () =>
        Math.random().toString(36).slice(2, 8),
      ).join('');
      const result = encodeSnippet(huge);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('too-large');
      expect(result.size).toBeGreaterThan(SHARE_URL_LIMIT);
      expect(result.limit).toBe(SHARE_URL_LIMIT);
    });

    it('treats non-string input as empty (size 0, no URL produced)', () => {
      // @ts-expect-error — explicit negative test
      const result = encodeSnippet(undefined);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const encoded = new URL(result.url).searchParams.get(SHARE_PARAM);
      expect(decodeSnippet(encoded ?? '')).toBe('');
    });
  });

  describe('decodeSnippet', () => {
    it('returns empty string for empty input', () => {
      expect(decodeSnippet('')).toBe('');
    });

    it('returns empty string for malformed input instead of throwing', () => {
      expect(decodeSnippet('!@#$%not-base64-lz-string!!!')).toBe('');
    });

    it('returns empty string on decompress failure (e.g. valid alphabet, broken payload)', () => {
      // Any string that survives URI-alphabet but is not a valid lz-string
      // payload should yield '' rather than throw.
      expect(decodeSnippet('N4IgLglmA2CmIC4QFsD2DkB2YBO')).toBe('');
    });
  });

  describe('parseShareUrl', () => {
    it('returns null for empty search', () => {
      expect(parseShareUrl('')).toBeNull();
    });

    it('returns null when ?s= is missing', () => {
      expect(parseShareUrl('?t=123')).toBeNull();
    });

    it('extracts ?s= value alone', () => {
      expect(parseShareUrl('?s=abc123')).toBe('abc123');
    });

    it('extracts ?s= value alongside other params', () => {
      expect(parseShareUrl('?s=abc&t=123')).toBe('abc');
      expect(parseShareUrl('?t=123&s=abc')).toBe('abc');
      expect(parseShareUrl('?foo=bar&s=abc&baz=qux')).toBe('abc');
    });

    it('accepts raw search without leading ?', () => {
      expect(parseShareUrl('s=abc')).toBe('abc');
    });

    it('returns null for ?s= with empty value', () => {
      expect(parseShareUrl('?s=')).toBeNull();
    });
  });
});
