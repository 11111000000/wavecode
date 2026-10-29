import { describe, it, expect } from 'vitest';
import {
  isMicBusyError,
  MIC_DIRECT_SINGLE_OWNER,
  SPEECH_API_CAN_COEXIST_WITH_MIC_DIRECT,
  type MicChannel,
  type MicChannelOwner,
  type MicBusyError,
} from '~/domain/audio/MicChannel';

/**
 * Tests for the pure value types in `MicChannel.ts`:
 *   - Owners carry a `sessionId` so the same UI surface can be reused
 *     across multiple user sessions (e.g. two browser tabs).
 *   - `MicBusyError` is a tagged error (lowercased `_tag` mirrors
 *     Effect-style tagged unions and `isMicBusyError` is its type
 *     guard).
 *   - Doc constants exist for humans; they must be `true` literal.
 */

const makeOwner = (kind: MicChannelOwner['kind'], sessionId: string): MicChannelOwner => {
  switch (kind) {
    case 'voice-ai':      return { kind: 'voice-ai', sessionId };
    case 'whistle':       return { kind: 'whistle', sessionId };
    case 'loop-recorder': return { kind: 'loop-recorder', sessionId };
    case 'midi-learn':    return { kind: 'midi-learn', sessionId };
  }
};

describe('MicChannel value', () => {
  it('builds a MicChannel value with all four owner kinds discriminated by `kind`', () => {
    const owner = makeOwner('whistle', 'sess-42');
    const channel: MicChannel = {
      kind: 'mic-direct',
      owner,
      sessionId: 'sess-42',
      acquiredAtMs: 1_700_000_000_000,
    };
    expect(channel.kind).toBe('mic-direct');
    expect(channel.owner.kind).toBe('whistle');
    if (channel.owner.kind !== 'whistle') throw new Error('discriminator mismatch');
    expect(channel.owner.sessionId).toBe('sess-42');
    expect(channel.acquiredAtMs).toBe(1_700_000_000_000);
  });

  it('isMicBusyError guards a tagged MicBusy and rejects other shapes', () => {
    const err: MicBusyError = {
      _tag: 'MicBusy',
      conflictingChannel: {
        kind: 'mic-direct',
        owner: makeOwner('voice-ai', 'sess-1'),
        sessionId: 'sess-1',
        acquiredAtMs: 0,
      },
      requestedBy: makeOwner('whistle', 'sess-2'),
    };
    expect(isMicBusyError(err)).toBe(true);
    expect(isMicBusyError(null)).toBe(false);
    expect(isMicBusyError(new Error('boom'))).toBe(false);
    expect(isMicBusyError({ _tag: 'Other' })).toBe(false);
    expect(isMicBusyError(undefined)).toBe(false);
    expect(isMicBusyError('string')).toBe(false);
  });

  it('owner discriminated union narrows correctly across all four kinds', () => {
    const owners: ReadonlyArray<MicChannelOwner> = [
      { kind: 'voice-ai',      sessionId: 'a' },
      { kind: 'whistle',       sessionId: 'b' },
      { kind: 'loop-recorder', sessionId: 'c' },
      { kind: 'midi-learn',    sessionId: 'd' },
    ];
    const kinds = owners.map((o) => o.kind);
    expect(kinds).toEqual(['voice-ai', 'whistle', 'loop-recorder', 'midi-learn']);
    // Each owner carries sessionId — sanity-check the invariant.
    for (const o of owners) {
      expect(o.sessionId.length).toBeGreaterThan(0);
    }
  });

  it('doc constants assert the design contract', () => {
    // These are compile-time-truth constants. The reducer in
    // `micChannelMutex.ts` enforces them at runtime; the constants
    // exist so the same invariant is visible at the type layer.
    expect(MIC_DIRECT_SINGLE_OWNER).toBe(true);
    expect(SPEECH_API_CAN_COEXIST_WITH_MIC_DIRECT).toBe(true);
  });
});
