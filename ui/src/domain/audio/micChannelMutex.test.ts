import { describe, it, expect } from 'vitest';
import {
  acquire,
  currentOwners,
  initialMicMutexState,
  release,
  type AcquireRequest,
  type MicMutexState,
} from '~/domain/audio/micChannelMutex';
import { type MicChannelOwner } from '~/domain/audio/MicChannel';

/**
 * Tests for the pure mutex state machine. We exercise:
 *   - fresh state is all-nulls
 *   - mic-direct single-ownership
 *   - speech-api-internal always succeeds (multi-owner)
 *   - midi always succeeds (multi-owner)
 *   - release by sessionId sweeps across all three kinds
 *   - release of unknown sessionId is a no-op
 *   - currentOwners flattens all three kinds
 */

const owner = (kind: MicChannelOwner['kind'], sessionId: string): MicChannelOwner => {
  switch (kind) {
    case 'voice-ai':      return { kind: 'voice-ai', sessionId };
    case 'whistle':       return { kind: 'whistle', sessionId };
    case 'loop-recorder': return { kind: 'loop-recorder', sessionId };
    case 'midi-learn':    return { kind: 'midi-learn', sessionId };
  }
};

const req = (
  kind: AcquireRequest['kind'],
  sessionId: string,
  nowMs: number,
  ownerKind: MicChannelOwner['kind'] = 'whistle',
): AcquireRequest => ({
  kind,
  owner: owner(ownerKind, sessionId),
  sessionId,
  nowMs,
});

describe('micChannelMutex.initialMicMutexState', () => {
  it('starts with micDirect = null and both arrays empty', () => {
    const s = initialMicMutexState();
    expect(s.micDirect).toBeNull();
    expect(s.speechApiInternal).toEqual([]);
    expect(s.midi).toEqual([]);
  });
});

describe('micChannelMutex.acquire', () => {
  it('grants mic-direct to the first caller and sets state.micDirect', () => {
    const s0 = initialMicMutexState();
    const r = acquire(s0, req('mic-direct', 'sess-w', 1_000));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok=true');
    expect(r.channel.sessionId).toBe('sess-w');
    expect(r.channel.kind).toBe('mic-direct');
    expect(r.next.micDirect).not.toBeNull();
    expect(r.next.micDirect?.sessionId).toBe('sess-w');
    expect(r.next.speechApiInternal).toEqual([]);
    expect(r.next.midi).toEqual([]);
  });

  it('rejects a second mic-direct with MicBusyError carrying the conflicting channel', () => {
    const s0 = initialMicMutexState();
    const r1 = acquire(s0, req('mic-direct', 'sess-w', 1_000));
    if (!r1.ok) throw new Error('expected first acquire to succeed');
    const r2 = acquire(r1.next, req('mic-direct', 'sess-v', 2_000, 'voice-ai'));
    expect(r2.ok).toBe(false);
    if (r2.ok) throw new Error('expected busy error');
    expect(r2.error._tag).toBe('MicBusy');
    expect(r2.error.conflictingChannel.sessionId).toBe('sess-w');
    expect(r2.error.requestedBy.kind).toBe('voice-ai');
    // State unchanged on conflict (no token to a phantom winner).
    expect(r2.next.micDirect?.sessionId).toBe('sess-w');
  });

  it('allows speech-api-internal always (multiple owners accumulate)', () => {
    const s0 = initialMicMutexState();
    const r1 = acquire(s0, req('speech-api-internal', 'sess-v', 1_000, 'voice-ai'));
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('expected ok');
    const r2 = acquire(r1.next, req('speech-api-internal', 'sess-s', 2_000));
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('expected ok');
    expect(r2.next.speechApiInternal.length).toBe(2);
    expect(r2.next.speechApiInternal[0]?.sessionId).toBe('sess-v');
    expect(r2.next.speechApiInternal[1]?.sessionId).toBe('sess-s');
    // Mic-direct remains free; speech-api does not contend with it.
    expect(r2.next.micDirect).toBeNull();
  });

  it('allows midi always and keeps the kind lists independent from speech-api', () => {
    const s0 = initialMicMutexState();
    const r1 = acquire(s0, req('midi', 'sess-m', 1_000, 'midi-learn'));
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('expected ok');
    const r2 = acquire(r1.next, req('midi', 'sess-l', 2_000, 'loop-recorder'));
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('expected ok');
    expect(r2.next.midi.length).toBe(2);
    expect(r2.next.speechApiInternal.length).toBe(0);
  });

  it('lets a speech-api-internal owner co-exist with a mic-direct owner', () => {
    const s0 = initialMicMutexState();
    const r1 = acquire(s0, req('mic-direct', 'sess-w', 1_000));
    if (!r1.ok) throw new Error('expected ok');
    const r2 = acquire(r1.next, req('speech-api-internal', 'sess-v', 2_000, 'voice-ai'));
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('expected ok');
    expect(r2.next.micDirect?.sessionId).toBe('sess-w');
    expect(r2.next.speechApiInternal[0]?.sessionId).toBe('sess-v');
  });
});

describe('micChannelMutex.release', () => {
  it('removes the channel from micDirect when the sessionId matches', () => {
    const s0 = initialMicMutexState();
    const r1 = acquire(s0, req('mic-direct', 'sess-w', 1_000));
    if (!r1.ok) throw new Error('expected ok');
    const r2 = acquire(r1.next, req('speech-api-internal', 'sess-v', 2_000, 'voice-ai'));
    if (!r2.ok) throw new Error('expected ok');
    const after = release(r2.next, 'sess-w');
    expect(after.micDirect).toBeNull();
    // Speech-api entry for sess-v remains — release is session-scoped.
    expect(after.speechApiInternal[0]?.sessionId).toBe('sess-v');
  });

  it('removes speech-api and midi channels for the same sessionId in one call', () => {
    const s0 = initialMicMutexState();
    const r1 = acquire(s0, req('speech-api-internal', 'sess-m', 1_000));
    if (!r1.ok) throw new Error('expected ok');
    const r2 = acquire(r1.next, req('midi', 'sess-m', 2_000));
    if (!r2.ok) throw new Error('expected ok');
    const r3 = acquire(r2.next, req('speech-api-internal', 'sess-other', 3_000));
    if (!r3.ok) throw new Error('expected ok');
    const after = release(r3.next, 'sess-m');
    expect(after.speechApiInternal.length).toBe(1);
    expect(after.speechApiInternal[0]?.sessionId).toBe('sess-other');
    expect(after.midi.length).toBe(0);
  });

  it('is a no-op for an unknown sessionId (returns identical state object)', () => {
    const s0 = initialMicMutexState();
    const r1 = acquire(s0, req('mic-direct', 'sess-w', 1_000));
    if (!r1.ok) throw new Error('expected ok');
    const after = release(r1.next, 'never-acquired');
    expect(after).toBe(r1.next);
  });
});

describe('micChannelMutex.currentOwners', () => {
  it('flattens micDirect + speechApiInternal + midi into a single ordered list', () => {
    let s: MicMutexState = initialMicMutexState();
    const r1 = acquire(s, req('mic-direct', 'mic-1', 1));
    if (!r1.ok) throw new Error('expected ok');
    s = r1.next;
    const r2 = acquire(s, req('speech-api-internal', 'sp-1', 2, 'voice-ai'));
    if (!r2.ok) throw new Error('expected ok');
    s = r2.next;
    const r3 = acquire(s, req('midi', 'm-1', 3, 'midi-learn'));
    if (!r3.ok) throw new Error('expected ok');
    s = r3.next;
    const owners = currentOwners(s);
    expect(owners.map((c) => c.sessionId)).toEqual(['mic-1', 'sp-1', 'm-1']);
  });

  it('returns an empty array when no owner has acquired', () => {
    expect(currentOwners(initialMicMutexState())).toEqual([]);
  });
});
