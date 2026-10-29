import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireMic,
  releaseMic,
  isMicBusy,
  micMutexState,
  resetMicMutexForTests,
} from './micMutexStore';
import type { MicChannelOwner } from '~/domain/audio/MicChannel';

/**
 * micMutexStore tests — synchronous wrap of the pure
 * `micChannelMutex` reducer.
 *
 * Coverage:
 *   1. Initial state is empty.
 *   2. Acquire + release of `mic-direct` round-trips.
 *   3. Two concurrent `mic-direct` owners contend — second gets a
 *      typed `MicBusyError` whose `conflictingChannel` references the
 *      first owner.
 *   4. `speech-api-internal` always succeeds and coexists with
 *      `mic-direct` (Chrome shares the pipeline).
 */

const owner1: MicChannelOwner = { kind: 'whistle', sessionId: 'sess-1' };
const owner2: MicChannelOwner = { kind: 'voice-ai', sessionId: 'sess-2' };

beforeEach(() => {
  resetMicMutexForTests();
});

describe('micMutexStore — initial state', () => {
  it('starts with mic-direct empty and the speech/midi arrays empty', () => {
    const s = micMutexState();
    expect(s.micDirect).toBeNull();
    expect(s.speechApiInternal).toEqual([]);
    expect(s.midi).toEqual([]);
  });

  it('isMicBusy is false on a fresh store', () => {
    expect(isMicBusy()).toBe(false);
  });
});

describe('micMutexStore — acquire + release', () => {
  it('acquires mic-direct when empty and reflects in state', () => {
    const r = acquireMic({
      kind: 'mic-direct',
      owner: owner1,
      sessionId: 'sess-1',
    });
    expect(r.ok).toBe(true);
    expect(micMutexState().micDirect).not.toBeNull();
    expect(micMutexState().micDirect?.owner).toEqual(owner1);
    expect(isMicBusy()).toBe(true);
  });

  it('releases mic-direct and resets to empty', () => {
    acquireMic({ kind: 'mic-direct', owner: owner1, sessionId: 'sess-1' });
    releaseMic('sess-1');
    expect(micMutexState().micDirect).toBeNull();
    expect(isMicBusy()).toBe(false);
  });

  it('release is idempotent — calling twice is a no-op', () => {
    acquireMic({ kind: 'mic-direct', owner: owner1, sessionId: 'sess-1' });
    releaseMic('sess-1');
    // Second call should NOT throw and should not change state.
    releaseMic('sess-1');
    expect(micMutexState().micDirect).toBeNull();
  });
});

describe('micMutexStore — contention', () => {
  it('second mic-direct owner fails with MicBusy carrying the first owner', () => {
    const a = acquireMic({
      kind: 'mic-direct',
      owner: owner1,
      sessionId: 'sess-1',
    });
    expect(a.ok).toBe(true);
    const b = acquireMic({
      kind: 'mic-direct',
      owner: owner2,
      sessionId: 'sess-2',
    });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.error._tag).toBe('MicBusy');
      expect(b.error.conflictingChannel.owner).toEqual(owner1);
      expect(b.error.requestedBy).toEqual(owner2);
    }
    // State remained intact (first owner still holds micDirect).
    expect(micMutexState().micDirect?.owner).toEqual(owner1);
  });

  it('speech-api-internal always succeeds and coexists with mic-direct', () => {
    const a = acquireMic({
      kind: 'mic-direct',
      owner: owner1,
      sessionId: 'sess-1',
    });
    expect(a.ok).toBe(true);
    const b = acquireMic({
      kind: 'speech-api-internal',
      owner: owner2,
      sessionId: 'voice-ai-1',
    });
    expect(b.ok).toBe(true);
    expect(micMutexState().micDirect?.owner).toEqual(owner1);
    expect(micMutexState().speechApiInternal).toHaveLength(1);
    // isMicBusy reflects both kinds.
    expect(isMicBusy()).toBe(true);
    // Releasing the mic-direct owner leaves speech-api-internal intact.
    releaseMic('sess-1');
    expect(micMutexState().micDirect).toBeNull();
    expect(micMutexState().speechApiInternal).toHaveLength(1);
  });

  it('releasing one session leaves others intact', () => {
    acquireMic({ kind: 'mic-direct', owner: owner1, sessionId: 'sess-1' });
    acquireMic({
      kind: 'speech-api-internal',
      owner: owner2,
      sessionId: 'voice-ai-1',
    });
    releaseMic('sess-1');
    expect(micMutexState().micDirect).toBeNull();
    expect(micMutexState().speechApiInternal).toHaveLength(1);
  });
});
