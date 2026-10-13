import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestMidiAccess,
  getMidiPermissionState,
  isMidiAvailable,
  onNote,
  type MidiAccessLike,
  type MidiInputLike,
} from './MidiInput';

/**
 * The tests mock `navigator.requestMIDIAccess` / `navigator.permissions`
 * via `Object.defineProperty(globalThis, 'navigator', ...)` — same
 * pattern used in ConsoleSheet.test.tsx. This avoids the jsdom default
 * of `navigator.requestMIDIAccess = undefined` while still letting each
 * test install its own mock. After each test we restore the original
 * `navigator` reference so a leak in one test can't poison the next.
 */

type MidiNavigator = {
  requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MidiAccessLike>;
  permissions?: {
    query: (opts: { name: string; sysex?: boolean }) => Promise<PermissionStatus>;
  };
};

function setNavigator(next: MidiNavigator | undefined): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: next as unknown as Navigator,
  });
}

function makeAccess(inputs: ReadonlyArray<{ id: string; name: string | null }> = []): MidiAccessLike {
  const map = new Map<string, { id: string; name: string | null; onmidimessage: null }>();
  for (const inp of inputs) map.set(inp.id, { ...inp, onmidimessage: null });
  return {
    inputs: map,
    state: 'connected',
    onstatechange: null,
  };
}

describe('isMidiAvailable', () => {
  let originalNav: typeof navigator;
  beforeEach(() => {
    originalNav = globalThis.navigator;
  });
  afterEach(() => {
    setNavigator(originalNav as unknown as MidiNavigator);
  });

  it('returns true when navigator.requestMIDIAccess is a function', () => {
    setNavigator({ requestMIDIAccess: () => Promise.resolve(makeAccess()) });
    expect(isMidiAvailable()).toBe(true);
  });

  it('returns false when navigator has no requestMIDIAccess (iOS Safari path)', () => {
    setNavigator({});
    expect(isMidiAvailable()).toBe(false);
  });
});

describe('requestMidiAccess', () => {
  let originalNav: typeof navigator;
  beforeEach(() => {
    originalNav = globalThis.navigator;
  });
  afterEach(() => {
    vi.useRealTimers();
    setNavigator(originalNav as unknown as MidiNavigator);
  });

  it('returns null synchronously (wrapped in Promise.resolve) on iOS Safari', async () => {
    setNavigator({});
    const result = await requestMidiAccess();
    expect(result).toBeNull();
  });

  it('returns the MIDIAccess object when navigator resolves quickly', async () => {
    const access = makeAccess([{ id: 'a', name: 'Keyboard A' }]);
    setNavigator({
      requestMIDIAccess: () => Promise.resolve(access),
    });
    const result = await requestMidiAccess();
    expect(result).toBe(access);
    expect(result?.inputs.size).toBe(1);
  });

  it('returns null when navigator.requestMIDIAccess hangs longer than timeoutMs', async () => {
    vi.useFakeTimers();
    // Mock that resolves after 5 seconds — well past the 1s default
    // timeout. We must keep the mock itself as a real Promise so
    // vi.advanceTimersByTimeAsync can race the timeout against it.
    const neverResolvingAccess: Promise<MidiAccessLike> = new Promise((resolve) => {
      setTimeout(() => resolve(makeAccess([{ id: 'late', name: 'Late' }])), 5000);
    });
    setNavigator({
      requestMIDIAccess: () => neverResolvingAccess,
    });
    const promise = requestMidiAccess(1000);
    // Advance past the 1s timeout. The 5s underlying promise must
    // remain pending so the race resolves to the timeout branch.
    await vi.advanceTimersByTimeAsync(1100);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('passes {sysex: false} to navigator.requestMIDIAccess', async () => {
    const access = makeAccess();
    const spy = vi.fn(() => Promise.resolve(access));
    setNavigator({ requestMIDIAccess: spy });
    await requestMidiAccess();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ sysex: false });
  });

  it('returns null (does not throw) when navigator.requestMIDIAccess rejects', async () => {
    setNavigator({
      requestMIDIAccess: () => Promise.reject(new Error('not-allowed')),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await requestMidiAccess();
    expect(result).toBeNull();
    // non-timeout errors get logged via console.warn for diagnostics
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('getMidiPermissionState', () => {
  let originalNav: typeof navigator;
  beforeEach(() => {
    originalNav = globalThis.navigator;
  });
  afterEach(() => {
    setNavigator(originalNav as unknown as MidiNavigator);
  });

  it("returns 'granted' when navigator.permissions.query reports granted", async () => {
    setNavigator({
      permissions: { query: () => Promise.resolve({ state: 'granted' } as PermissionStatus) },
    });
    await expect(getMidiPermissionState()).resolves.toBe('granted');
  });

  it("returns 'denied' when navigator.permissions.query reports denied", async () => {
    setNavigator({
      permissions: { query: () => Promise.resolve({ state: 'denied' } as PermissionStatus) },
    });
    await expect(getMidiPermissionState()).resolves.toBe('denied');
  });

  it("returns 'prompt' when navigator.permissions.query reports prompt", async () => {
    setNavigator({
      permissions: { query: () => Promise.resolve({ state: 'prompt' } as PermissionStatus) },
    });
    await expect(getMidiPermissionState()).resolves.toBe('prompt');
  });

  it("returns 'unknown' when navigator.permissions is unavailable", async () => {
    setNavigator({});
    await expect(getMidiPermissionState()).resolves.toBe('unknown');
  });

  it("returns 'unknown' when navigator.permissions.query rejects", async () => {
    setNavigator({
      permissions: { query: () => Promise.reject(new Error('not supported')) },
    });
    await expect(getMidiPermissionState()).resolves.toBe('unknown');
  });

  it("returns 'unknown' when the permissions API reports an unrecognised state", async () => {
    setNavigator({
      permissions: { query: () => Promise.resolve({ state: 'leftover' } as unknown as PermissionStatus) },
    });
    await expect(getMidiPermissionState()).resolves.toBe('unknown');
  });

  it('queries midi with sysex: false', async () => {
    const spy = vi.fn(() => Promise.resolve({ state: 'granted' } as PermissionStatus));
    setNavigator({ permissions: { query: spy } });
    await getMidiPermissionState();
    expect(spy).toHaveBeenCalledWith({ name: 'midi', sysex: false });
  });
});

/**
 * Phase 3 extension: each `NoteEvent` now carries `source` (the
 * WebMIDI input name, e.g. "AKAI MPK Mini") and `sourceId` (the
 * stable input.id UUID). The component layer uses these to label
 * which device is sending notes. These tests pin the contract on
 * the `onNote` subscriber side without standing up a real WebMIDI
 * device — we mock the MIDIAccess shape, fire midimessage by
 * hand, and inspect what reaches the callback.
 */
describe('onNote (source / sourceId attribution)', () => {
  it('noteOn callback receives the input.name as `source` and input.id as `sourceId`', () => {
    const input: MidiInputLike = {
      id: 'dev-uuid-1',
      name: 'AKAI MPK Mini',
      onmidimessage: null,
    };
    const access: MidiAccessLike = {
      inputs: new Map([[input.id, input]]),
      state: 'connected',
      onstatechange: null,
    };
    const seen: unknown[] = [];
    onNote(access, (e) => seen.push(e));
    expect(input.onmidimessage).toBeTypeOf('function');
    // Channel 0, note 60 (C4), velocity 100 → noteOn
    (input.onmidimessage as (ev: { data: Uint8Array; timeStamp: number }) => void)({
      data: new Uint8Array([0x90, 60, 100]),
      timeStamp: 0,
    });
    expect(seen).toHaveLength(1);
    const ev = seen[0] as {
      type: string;
      note: number;
      velocity: number;
      source: string;
      sourceId: string;
    };
    expect(ev.type).toBe('noteOn');
    expect(ev.note).toBe(60);
    expect(ev.velocity).toBe(100);
    expect(ev.source).toBe('AKAI MPK Mini');
    expect(ev.sourceId).toBe('dev-uuid-1');
  });

  it('falls back to `source: "unknown"` when the input name is null', () => {
    const input: MidiInputLike = {
      id: 'dev-uuid-2',
      name: null,
      onmidimessage: null,
    };
    const access: MidiAccessLike = {
      inputs: new Map([[input.id, input]]),
      state: 'connected',
      onstatechange: null,
    };
    const seen: unknown[] = [];
    onNote(access, (e) => seen.push(e));
    (input.onmidimessage as (ev: { data: Uint8Array; timeStamp: number }) => void)({
      data: new Uint8Array([0x80, 60, 64]), // noteOff
      timeStamp: 0,
    });
    expect(seen).toHaveLength(1);
    const ev = seen[0] as {
      type: string;
      note: number;
      source: string;
      sourceId: string;
    };
    expect(ev.type).toBe('noteOff');
    expect(ev.note).toBe(60);
    expect(ev.source).toBe('unknown');
    expect(ev.sourceId).toBe('dev-uuid-2');
  });
});