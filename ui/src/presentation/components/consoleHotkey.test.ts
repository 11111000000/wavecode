import { describe, it, expect } from 'vitest';
import { matchesHotkey } from './consoleHotkey';

/**
 * Construct a KeyboardEvent with arbitrary key + modifier flags.
 * jsdom in vitest does not auto-fill `key`, `metaKey`, etc. from `code`;
 * we pass them explicitly so the matcher's branches are tested
 * independent of browser quirks.
 */
const keyEvent = (
  key: string,
  opts: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {},
): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
  });

describe('consoleHotkey', () => {
  it('matches the cross-platform Cmd/Ctrl+key contract (MetaKey on Mac, CtrlKey elsewhere)', () => {
    expect(matchesHotkey(keyEvent('d', { metaKey: true }), { key: 'd' })).toBe(true);
    expect(matchesHotkey(keyEvent('d', { ctrlKey: true }), { key: 'd' })).toBe(true);
  });

  it('matches when shift is required (Cmd+Shift+D)', () => {
    expect(
      matchesHotkey(
        keyEvent('D', { metaKey: true, shiftKey: true }),
        { key: 'd', shift: true },
      ),
    ).toBe(true);
  });

  it('matches when alt is required (Ctrl+Alt+D)', () => {
    expect(
      matchesHotkey(
        keyEvent('d', { ctrlKey: true, altKey: true }),
        { key: 'd', alt: true },
      ),
    ).toBe(true);
  });

  it('does NOT match on wrong key or missing cmd/ctrl modifier', () => {
    expect(matchesHotkey(keyEvent('x', { metaKey: true }), { key: 'd' })).toBe(false);
    expect(matchesHotkey(keyEvent('d'), { key: 'd' })).toBe(false);
  });

  it('does NOT match when an extra modifier is held', () => {
    expect(
      matchesHotkey(keyEvent('d', { metaKey: true, shiftKey: true }), { key: 'd' }),
    ).toBe(false);
    expect(
      matchesHotkey(keyEvent('d', { metaKey: true, altKey: true }), { key: 'd' }),
    ).toBe(false);
  });

  it('is case-insensitive and supports special keys (backtick, slash)', () => {
    expect(matchesHotkey(keyEvent('d', { metaKey: true }), { key: 'd' })).toBe(true);
    expect(matchesHotkey(keyEvent('D', { metaKey: true }), { key: 'd' })).toBe(true);
    expect(matchesHotkey(keyEvent('`', { ctrlKey: true }), { key: '`' })).toBe(true);
    expect(matchesHotkey(keyEvent('/', { metaKey: true }), { key: '/' })).toBe(true);
  });
});
