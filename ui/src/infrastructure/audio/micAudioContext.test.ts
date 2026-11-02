import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * micAudioContext — the iOS contract.
 *
 * The whole point of this module is the ORDER of operations: the
 * context has to be created AND started inside the user gesture that
 * opened the mic. WebKit (iOS Safari and Chrome for iOS — both are
 * WebKit) refuses to run a context created outside a gesture, and
 * `resume()` is only allowed while the transient activation is
 * alive. A context created after `getUserMedia()` resolves therefore
 * stays `suspended` forever and the analyser reads zeroes — the
 * whistle was deaf on the iPhone without a single error.
 *
 * These tests pin the ordering, not the browser.
 */

type StubContext = {
  state: string;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

let created: StubContext[] = [];
let contexts: StubContext[] = [];

const makeContext = (): StubContext => ({
  state: 'suspended',
  resume: vi.fn().mockImplementation(() => {
    const ctx = contexts[contexts.length - 1];
    if (ctx !== undefined) ctx.state = 'running';
    return Promise.resolve();
  }),
  close: vi.fn().mockResolvedValue(undefined),
});

const installStub = (): void => {
  created = [];
  contexts = [];
  (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext = vi
    .fn(() => {
      const ctx = makeContext();
      created.push(ctx);
      contexts.push(ctx);
      return ctx as unknown as AudioContext;
    }) as unknown as typeof AudioContext;
};

import {
  createMicAudioContext,
  ensureAudioContextRunning,
  ensureMicAudioContext,
  isAudioContextRunning,
  primeMicAudioContext,
  takeMicAudioContext,
  __resetMicAudioContextForTests,
} from './micAudioContext';

describe('micAudioContext', () => {
  beforeEach(() => {
    installStub();
    __resetMicAudioContextForTests();
  });

  afterEach(() => {
    __resetMicAudioContextForTests();
    delete (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  });

  it('prime creates a context and starts it', () => {
    primeMicAudioContext();
    expect(created).toHaveLength(1);
    expect(created[0]!.resume).toHaveBeenCalled();
  });

  it('the primed context is the one the capture takes', () => {
    primeMicAudioContext();
    const taken = takeMicAudioContext();
    expect(taken).toBe(created[0]);
  });

  it('the primed context is taken only once', () => {
    primeMicAudioContext();
    expect(takeMicAudioContext()).not.toBeNull();
    expect(takeMicAudioContext()).toBeNull();
  });

  it('a primed-but-unused context is closed by the next prime', () => {
    primeMicAudioContext();
    const orphan = created[0]!;
    primeMicAudioContext();
    expect(orphan.close).toHaveBeenCalled();
    expect(created).toHaveLength(2);
  });

  it('a context that was taken is not closed by the next prime', () => {
    primeMicAudioContext();
    const taken = created[0]!;
    takeMicAudioContext();
    primeMicAudioContext();
    expect(taken.close).not.toHaveBeenCalled();
  });

  it('ensureMicAudioContext falls back to a fresh context', () => {
    const ctx = ensureMicAudioContext();
    expect(ctx).not.toBeNull();
    expect(created).toHaveLength(1);
  });

  it('ensureMicAudioContext prefers the primed context', () => {
    primeMicAudioContext();
    const ctx = ensureMicAudioContext();
    expect(ctx).toBe(created[0]);
    expect(created).toHaveLength(1);
  });

  it('createMicAudioContext returns null when the browser has none', () => {
    delete (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    expect(createMicAudioContext()).toBeNull();
    expect(ensureMicAudioContext()).toBeNull();
  });

  it('ensureAudioContextRunning awaits the resume and reports the state', async () => {
    // A hand-made context: the stub created by `createMicAudioContext`
    // has already been resumed once.
    const ctx = {
      state: 'suspended',
      resume: vi.fn().mockImplementation(() => {
        (ctx as { state: string }).state = 'running';
        return Promise.resolve();
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    expect(isAudioContextRunning(ctx)).toBe(false);
    await expect(ensureAudioContextRunning(ctx)).resolves.toBe(true);
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('ensureAudioContextRunning reports false when the resume is refused', async () => {
    const ctx = {
      state: 'suspended',
      resume: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    await expect(ensureAudioContextRunning(ctx)).resolves.toBe(false);
  });
});
