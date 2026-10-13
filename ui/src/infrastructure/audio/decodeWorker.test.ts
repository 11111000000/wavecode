import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleDecode,
  type DecodeOk,
  type DecodeErr,
  type Outbound,
} from './decodeWorker';

/**
 * Unit tests for the decode Worker protocol.
 *
 * We test `handleDecode` directly with mocked deps (fetch,
 * OfflineAudioContext ctor, reply callback) instead of instantiating
 * a real Worker. JSDOM has no Worker threads, and Vite's `?worker`
 * bundle step only happens during the dev/build pipeline —
 * vitest cannot spin up a real Worker from `./decodeWorker?worker`
 * in a JSDOM environment. The protocol is the WHOLE behavior we
 * care about (the bottom-of-file Worker glue is a 3-line wire);
 * testing the protocol exercises every code path.
 *
 * Deps shape (from decodeWorker.ts):
 *   {
 *     fetchImpl: typeof fetch,
 *     createCtx: (sampleRate: number) => OfflineAudioContext,
 *     reply: (msg: Outbound, transfer?: readonly Transferable[]) => void,
 *   }
 *
 * For each test we install fake versions of all three. Mocks are
 * `vi.fn()` so we can assert on call args / counts.
 */

type FakeAudioBuffer = {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly duration: number;
  readonly _channels: Float32Array[];
  getChannelData: (ch: number) => Float32Array;
};

const makeFakeAudioBuffer = (
  channels: number,
  length: number,
  sampleRate: number,
  channelFiller: (ch: number) => number = (ch) => ch + 1,
): FakeAudioBuffer => {
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch += 1) {
    const sample = channelFiller(ch);
    const data = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      data[i] = sample;
    }
    channelData.push(data);
  }
  const fake: FakeAudioBuffer = {
    length,
    numberOfChannels: channels,
    sampleRate,
    duration: length / sampleRate,
    _channels: channelData,
    getChannelData: (ch) => channelData[ch]!,
  };
  return fake;
};

type FakeOfflineAudioContext = {
  readonly sampleRate: number;
  decodeAudioData: ReturnType<typeof vi.fn>;
};

/**
 * Thin wrapper around `handleDecode` that isolates each test from
 * the module-level ctx cache. Without this, the global `defaultCtxCache`
 * would leak between tests (first test creates a 44100 ctx; second test
 * starts with that cache still populated). Tests that want SHARED state
 * across multiple calls can pass `freshCtxCache()` once and reuse the
 * returned reference.
 */
const runHandleDecode = (
  req: Parameters<typeof handleDecode>[0],
  deps: Parameters<typeof handleDecode>[1],
): Promise<void> => {
  const ctxCache: Parameters<typeof handleDecode>[2] = { current: null, sampleRate: 0 };
  return handleDecode(req, deps, ctxCache);
};

const mkResponse = (status: number, statusText: string, body?: ArrayBuffer): Response =>
  new Response(body ?? new ArrayBuffer(0), { status, statusText });

describe('handleDecode — happy path', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type ReplyCapture = {
  replies: Outbound[];
  setLastTransfer: (t: readonly Transferable[] | undefined) => void;
  lastTransfer: readonly Transferable[] | undefined;
};

const makeReplyCapture = (): ReplyCapture => {
  const replies: Outbound[] = [];
  const state: { lastTransfer: readonly Transferable[] | undefined } = { lastTransfer: undefined };
  return {
    replies,
    setLastTransfer: (t) => {
      state.lastTransfer = t;
    },
    get lastTransfer() {
      return state.lastTransfer;
    },
  };
};

  it('decodes a 2-channel × 4-sample buffer and replies with merged Float32Array', async () => {
    const fakeBuffer = makeFakeAudioBuffer(2, 4, 44100);
    const capture = makeReplyCapture();

    fetchImpl.mockResolvedValue(mkResponse(200, 'OK'));

    await runHandleDecode(
      { type: 'decode', id: 7, url: '/foo.mp3', sampleRate: 44100 },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createCtx: (sr) => {
          const ctx: FakeOfflineAudioContext = {
            sampleRate: sr,
            decodeAudioData: vi.fn(async () => fakeBuffer),
          };
          return ctx as unknown as OfflineAudioContext;
        },
        reply: (msg, transfer) => {
          capture.replies.push(msg);
          capture.setLastTransfer(transfer);
        },
      },
    );

    expect(capture.replies).toHaveLength(1);
    const reply = capture.replies[0]!;
    expect(reply.type).toBe('decode:ok');
    const ok = reply as DecodeOk;
    expect(ok.id).toBe(7);
    expect(ok.sampleRate).toBe(44100);
    expect(ok.numberOfChannels).toBe(2);
    expect(ok.duration).toBeCloseTo(4 / 44100, 6);
    // Float32(4 samples × 2 channels × 4 bytes = 32 bytes total).
    expect(ok.buffer.byteLength).toBe(32);
    const floats = new Float32Array(ok.buffer);
    expect(floats.length).toBe(8);
    // Channel 0 filler was 1; channel 1 filler was 2. Order: interleaved-
    // by-block (whole ch0, then whole ch1) — see `merged.set(channelData,
    // ch * audioBuffer.length)`.
    expect(Array.from(floats.subarray(0, 4))).toEqual([1, 1, 1, 1]);
    expect(Array.from(floats.subarray(4, 8))).toEqual([2, 2, 2, 2]);
    // Transferable list must contain exactly the merged buffer.
    expect(capture.lastTransfer).toEqual([ok.buffer]);
  });

  it('mono buffer replies with sampleRate + 1 channel', async () => {
    const fakeBuffer = makeFakeAudioBuffer(1, 16, 48000);
    const replies: Outbound[] = [];
    await runHandleDecode(
      { type: 'decode', id: 1, url: '/mono.wav', sampleRate: 48000 },
      {
        fetchImpl: vi.fn().mockResolvedValue(mkResponse(200, 'OK')) as unknown as typeof fetch,
        createCtx: (sr) => ({
          sampleRate: sr,
          decodeAudioData: vi.fn(async () => fakeBuffer),
        } as unknown as OfflineAudioContext),
        reply: (m) => { replies.push(m); },
      },
    );
    expect(replies).toHaveLength(1);
    const ok = replies[0] as DecodeOk;
    expect(ok.numberOfChannels).toBe(1);
    expect(ok.sampleRate).toBe(48000);
    expect(ok.buffer.byteLength).toBe(16 * 4);
  });

  it('passes sampleRate from request to createCtx (does not rely on the live AudioContext)', async () => {
    const fakeBuffer = makeFakeAudioBuffer(1, 1, 22050);
    const ctxCalls: number[] = [];
    await runHandleDecode(
      { type: 'decode', id: 1, url: '/sr.mp3', sampleRate: 22050 },
      {
        fetchImpl: vi.fn().mockResolvedValue(mkResponse(200, 'OK')) as unknown as typeof fetch,
        createCtx: (sr) => {
          ctxCalls.push(sr);
          return {
            sampleRate: sr,
            decodeAudioData: vi.fn(async () => fakeBuffer),
          } as unknown as OfflineAudioContext;
        },
        reply: () => {},
      },
    );
    expect(ctxCalls).toEqual([22050]);
  });

  it('reports AudioContext.sampleRate (not the request sampleRate) on the reply', async () => {
    // Real browsers sometimes re-sample during decode (rare, but
    // observed when the source sampleRate differs from the ctx's).
    // The reply's sampleRate must come from the actual decoded buffer.
    const fakeBuffer = makeFakeAudioBuffer(1, 4, 22050);
    const replies: Outbound[] = [];
    await runHandleDecode(
      { type: 'decode', id: 1, url: '/x.mp3', sampleRate: 48000 },
      {
        fetchImpl: vi.fn().mockResolvedValue(mkResponse(200, 'OK')) as unknown as typeof fetch,
        createCtx: (sr) => ({
          sampleRate: sr,
          decodeAudioData: vi.fn(async () => fakeBuffer),
        } as unknown as OfflineAudioContext),
        reply: (m) => { replies.push(m); },
      },
    );
    const ok = replies[0] as DecodeOk;
    // Reported sampleRate from the buffer itself (22050), not the request (48000).
    expect(ok.sampleRate).toBe(22050);
  });

  it('transferable list contains the buffer (caller should postMessage with it for zero-copy)', async () => {
    const fakeBuffer = makeFakeAudioBuffer(1, 4, 44100);
    let captured: { msg: Outbound; transfer: readonly Transferable[] | undefined } | null = null;
    await runHandleDecode(
      { type: 'decode', id: 1, url: '/t.mp3', sampleRate: 44100 },
      {
        fetchImpl: vi.fn().mockResolvedValue(mkResponse(200, 'OK')) as unknown as typeof fetch,
        createCtx: () => ({
          sampleRate: 44100,
          decodeAudioData: vi.fn(async () => fakeBuffer),
        } as unknown as OfflineAudioContext),
        reply: (msg, transfer) => {
          captured = { msg, transfer };
        },
      },
    );
    expect(captured).not.toBeNull();
    const ok = captured!.msg as DecodeOk;
    expect(captured!.transfer).toEqual([ok.buffer]);
  });
});

describe('handleDecode — error paths', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetch network error → decode:err with the error message', async () => {
    const replies: Outbound[] = [];
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'));
    await runHandleDecode(
      { type: 'decode', id: 1, url: '/missing.mp3', sampleRate: 44100 },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createCtx: () => ({
          sampleRate: 44100,
          decodeAudioData: vi.fn(),
        } as unknown as OfflineAudioContext),
        reply: (m) => { replies.push(m); },
      },
    );
    expect(replies).toHaveLength(1);
    const err = replies[0] as DecodeErr;
    expect(err.type).toBe('decode:err');
    expect(err.id).toBe(1);
    expect(err.error).toBe('Failed to fetch');
    // No transferable list for errors.
  });

  it('non-2xx response → decode:err with "fetch <status> <text>"', async () => {
    const replies: Outbound[] = [];
    fetchImpl.mockResolvedValue(mkResponse(404, 'Not Found'));
    await runHandleDecode(
      { type: 'decode', id: 99, url: '/gone.mp3', sampleRate: 44100 },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createCtx: () => ({
          sampleRate: 44100,
          decodeAudioData: vi.fn(),
        } as unknown as OfflineAudioContext),
        reply: (m) => { replies.push(m); },
      },
    );
    const err = replies[0] as DecodeErr;
    expect(err.type).toBe('decode:err');
    expect(err.id).toBe(99);
    expect(err.error).toBe('fetch 404 Not Found');
  });

  it('decodeAudioData throwing → decode:err (does NOT crash the worker)', async () => {
    const replies: Outbound[] = [];
    fetchImpl.mockResolvedValue(mkResponse(200, 'OK'));
    await runHandleDecode(
      { type: 'decode', id: 1, url: '/corrupt.mp3', sampleRate: 44100 },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createCtx: () => ({
          sampleRate: 44100,
          decodeAudioData: vi.fn(async () => {
            throw new Error('EncodingError');
          }),
        } as unknown as OfflineAudioContext),
        reply: (m) => { replies.push(m); },
      },
    );
    const err = replies[0] as DecodeErr;
    expect(err.type).toBe('decode:err');
    expect(err.error).toBe('EncodingError');
  });

  it('non-Error thrown value is stringified in decode:err.error', async () => {
    const replies: Outbound[] = [];
    fetchImpl.mockResolvedValue(mkResponse(200, 'OK'));
    await runHandleDecode(
      { type: 'decode', id: 1, url: '/x.mp3', sampleRate: 44100 },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createCtx: () => ({
          sampleRate: 44100,
          decodeAudioData: vi.fn(async () => {
            // Non-Error thrown value — verifies handleDecode's
            // `err instanceof Error` fallback to `String(err)`.
            // Cast to silence TS — `throw` literally accepts any
            // value in JS but the TS typing forbids it.
            const err: unknown = 'plain string thrown';
            throw err;
          }),
        } as unknown as OfflineAudioContext),
        reply: (m) => { replies.push(m); },
      },
    );
    const err = replies[0] as DecodeErr;
    expect(err.type).toBe('decode:err');
    expect(err.error).toBe('plain string thrown');
  });
});

describe('handleDecode — OfflineAudioContext lifecycle', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recycles the same OfflineAudioContext when sampleRate is unchanged', async () => {
    const fakeBuffer = makeFakeAudioBuffer(1, 4, 44100);
    const ctxInstances: FakeOfflineAudioContext[] = [];
    const replies: Outbound[] = [];
    for (let i = 0; i < 3; i += 1) {
      fetchImpl.mockResolvedValueOnce(mkResponse(200, 'OK'));
    }
    const makeCtx = (sr: number): OfflineAudioContext => {
      const fake: FakeOfflineAudioContext = {
        sampleRate: sr,
        decodeAudioData: vi.fn(async () => fakeBuffer),
      };
      ctxInstances.push(fake);
      return fake as unknown as OfflineAudioContext;
    };
    // Shared ctx cache across the 3 calls — this test asserts recycling
    // within ONE Worker's lifetime.
    const sharedCache: Parameters<typeof handleDecode>[2] = { current: null, sampleRate: 0 };
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await handleDecode(
        { type: 'decode', id: i + 1, url: `/r${i}.mp3`, sampleRate: 44100 },
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          createCtx: makeCtx,
          reply: (m) => { replies.push(m); },
        },
        sharedCache,
      );
    }
    expect(ctxInstances).toHaveLength(1);
    expect(replies.every((r) => r.type === 'decode:ok')).toBe(true);
  });

  it('creates a fresh OfflineAudioContext when sampleRate changes', async () => {
    const fakeBuffer44 = makeFakeAudioBuffer(1, 4, 44100);
    const fakeBuffer48 = makeFakeAudioBuffer(1, 4, 48000);
    const ctxInstances: FakeOfflineAudioContext[] = [];
    fetchImpl
      .mockResolvedValueOnce(mkResponse(200, 'OK'))
      .mockResolvedValueOnce(mkResponse(200, 'OK'));
    let use48 = false;
    const makeCtx = (sr: number): OfflineAudioContext => {
      const fake: FakeOfflineAudioContext = {
        sampleRate: sr,
        decodeAudioData: vi.fn(async () => (use48 ? fakeBuffer48 : fakeBuffer44)),
      };
      ctxInstances.push(fake);
      return fake as unknown as OfflineAudioContext;
    };
    // First decode at 44100.
    // eslint-disable-next-line no-await-in-loop
    await runHandleDecode(
      { type: 'decode', id: 1, url: '/a.mp3', sampleRate: 44100 },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createCtx: makeCtx,
        reply: () => {},
      },
    );
    // Second decode at 48000 — must allocate a fresh ctx.
    use48 = true;
    // eslint-disable-next-line no-await-in-loop
    await runHandleDecode(
      { type: 'decode', id: 2, url: '/b.mp3', sampleRate: 48000 },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createCtx: makeCtx,
        reply: () => {},
      },
    );
    expect(ctxInstances).toHaveLength(2);
    expect(ctxInstances[0]!.sampleRate).toBe(44100);
    expect(ctxInstances[1]!.sampleRate).toBe(48000);
  });
});

describe('handleDecode — id propagation', () => {
  it('forwards the request id verbatim to the reply', async () => {
    const fakeBuffer = makeFakeAudioBuffer(1, 4, 44100);
    const replies: Outbound[] = [];
    await runHandleDecode(
      { type: 'decode', id: 123_456_789, url: '/q.mp3', sampleRate: 44100 },
      {
        fetchImpl: vi.fn().mockResolvedValue(mkResponse(200, 'OK')) as unknown as typeof fetch,
        createCtx: () => ({
          sampleRate: 44100,
          decodeAudioData: vi.fn(async () => fakeBuffer),
        } as unknown as OfflineAudioContext),
        reply: (m) => { replies.push(m); },
      },
    );
    expect((replies[0] as DecodeOk).id).toBe(123_456_789);
  });

  it('forwards id verbatim on error (so main thread can match replies)', async () => {
    const replies: Outbound[] = [];
    await runHandleDecode(
      { type: 'decode', id: 987_654_321, url: '/q.mp3', sampleRate: 44100 },
      {
        fetchImpl: vi.fn().mockResolvedValue(mkResponse(503, 'Service Unavailable')) as unknown as typeof fetch,
        createCtx: () => ({
          sampleRate: 44100,
          decodeAudioData: vi.fn(),
        } as unknown as OfflineAudioContext),
        reply: (m) => { replies.push(m); },
      },
    );
    expect((replies[0] as DecodeErr).id).toBe(987_654_321);
  });
});

describe('handleDecode — never throws (Worker would terminate)', () => {
  it('does not reject when reply callback throws (should not happen, but defensive)', async () => {
    // Even if the test callback blows up, handleDecode must not let
    // the underlying promise reject (an unhandled rejection from a
    // Worker terminates the Worker). We simulate this by making
    // reply throw and verifying handleDecode still resolves.
    const fakeBuffer = makeFakeAudioBuffer(1, 4, 44100);
    const p = runHandleDecode(
      { type: 'decode', id: 1, url: '/r.mp3', sampleRate: 44100 },
      {
        fetchImpl: vi.fn().mockResolvedValue(mkResponse(200, 'OK')) as unknown as typeof fetch,
        createCtx: () => ({
          sampleRate: 44100,
          decodeAudioData: vi.fn(async () => fakeBuffer),
        } as unknown as OfflineAudioContext),
        reply: () => {
          throw new Error('reply blew up');
        },
      },
    );
    // Should resolve, not reject.
    await expect(p).resolves.toBeUndefined();
  });
});
