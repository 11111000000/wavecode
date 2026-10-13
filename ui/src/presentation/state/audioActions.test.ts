import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * previewSample tests.
 *
 * `previewSample` calls `unlockAudioContext()` which reads `__wavecodeAudioCtx`
 * from `window` (or creates one). jsdom does not ship an `AudioContext`, so
 * before each test we install a fully-scripted mock on the global. The mock
 * tracks every `createOscillator` / `createGain` call so the tests can assert
 * exact frequencies / waveforms / envelopes without booting real Web Audio.
 *
 * Each test gets a fresh mock (beforeEach clears spy counts) but the
 * `__wavecodeAudioCtx` global is restored after each so leaking audio state
 * across tests can't poison neighbours.
 */

type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom';

type RampEvent = { value: number; time: number };
type AudioParamMock = {
  value: number;
  events: RampEvent[];
  setValueAtTime: (v: number, t: number) => void;
  linearRampToValueAtTime: (v: number, t: number) => void;
  exponentialRampToValueAtTime: (v: number, t: number) => void;
};

type GainNodeMock = {
  gain: AudioParamMock;
  connect: (next: unknown) => unknown;
  disconnect: () => void;
};

type OscillatorMock = {
  type: OscillatorType;
  frequency: AudioParamMock;
  start: (when?: number) => void;
  stop: (when?: number) => void;
  onended: (() => void) | null;
  connect: (next: unknown) => unknown;
  disconnect: () => void;
};

type AudioContextMock = {
  currentTime: number;
  state: 'running' | 'suspended' | 'closed';
  destination: { id: 'destination' };
  createOscillator: () => OscillatorMock;
  createGain: () => GainNodeMock;
  resume: () => Promise<void>;
};

const makeAudioContext = (): AudioContextMock => {
  const ctx: AudioContextMock = {
    currentTime: 0,
    state: 'running',
    destination: { id: 'destination' },
    createOscillator: vi.fn(),
    createGain: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
  };
  ctx.createOscillator = vi.fn((): OscillatorMock => {
    const osc: OscillatorMock = {
      type: 'sine',
      frequency: {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      } as unknown as AudioParamMock,
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
      connect: vi.fn(function (this: unknown, next: unknown) { return next; }),
      disconnect: vi.fn(),
    };
    osc.frequency.setValueAtTime = vi.fn((v: number, _t: number) => {
      osc.frequency.value = v;
    }) as unknown as { (v: number, t: number): void };
    return osc;
  });
  ctx.createGain = vi.fn((): GainNodeMock => {
    const events: RampEvent[] = [];
    const inner = { value: 0.0001 };
    const param = {
      get value() { return inner.value; },
      set value(v: number) { inner.value = v; events.push({ value: v, time: ctx.currentTime }); },
      events,
      setValueAtTime: vi.fn((v: number, t: number) => {
        inner.value = v;
        events.push({ value: v, time: t });
      }),
      linearRampToValueAtTime: vi.fn((v: number, t: number) => {
        inner.value = v;
        events.push({ value: v, time: t });
      }),
      exponentialRampToValueAtTime: vi.fn((v: number, t: number) => {
        inner.value = v;
        events.push({ value: v, time: t });
      }),
    };
    return {
      gain: param as unknown as AudioParamMock,
      connect: vi.fn(function (this: unknown, next: unknown) { return next; }),
      disconnect: vi.fn(),
    };
  });
  return ctx;
};

const setAudioCtx = (ctx: AudioContextMock | null): void => {
  const g = globalThis as unknown as { __wavecodeAudioCtx?: AudioContextMock };
  if (ctx === null) delete g.__wavecodeAudioCtx;
  else g.__wavecodeAudioCtx = ctx;
};

let originalCtx: AudioContextMock | undefined;
let installedStub = false;
beforeEach(() => {
  originalCtx = (globalThis as unknown as { __wavecodeAudioCtx?: AudioContextMock }).__wavecodeAudioCtx;
  // LiveAudioEngine.unlockAudioContext() reads `AudioContext.prototype.createPeriodicWave`,
  // and the superdough dependency reads `BaseAudioContext.prototype.*` at module load.
  // jsdom ships neither, so we install minimal stub classes.
  const g = globalThis as unknown as {
    AudioContext?: unknown;
    BaseAudioContext?: unknown;
  };
  if (!g.AudioContext || !g.BaseAudioContext) {
    class BaseAudioContextStub { /* prototype-only */ }
    class AudioContextStub extends BaseAudioContextStub {
      currentTime = 0;
      state: 'running' | 'suspended' | 'closed' = 'suspended';
      destination = {};
      createOscillator(): unknown { return null; }
      createGain(): unknown { return null; }
      resume(): Promise<void> { return Promise.resolve(); }
    }
    g.BaseAudioContext = BaseAudioContextStub;
    g.AudioContext = AudioContextStub;
    installedStub = true;
  }
  setAudioCtx(makeAudioContext());
});
afterEach(() => {
  setAudioCtx(originalCtx ?? null);
  if (installedStub) {
    const g = globalThis as unknown as {
      AudioContext?: unknown;
      BaseAudioContext?: unknown;
    };
    delete g.AudioContext;
    delete g.BaseAudioContext;
    installedStub = false;
  }
});

describe('previewSample — per-sample synthesis recipes', () => {
  it('bd: ~60Hz triangle wave', async () => {
    const { previewSample } = await import('./audioActions');
    previewSample('bd');
    const ctx = (globalThis as unknown as { __wavecodeAudioCtx: AudioContextMock }).__wavecodeAudioCtx;
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(ctx.createGain).toHaveBeenCalledTimes(1);
    const osc = (ctx.createOscillator as unknown as { mock: { results: Array<{ value: OscillatorMock }> } }).mock.results[0]!.value;
    expect(osc.type).toBe('triangle');
    expect(osc.frequency.value).toBeCloseTo(60, 5);
    expect(osc.start).toHaveBeenCalledTimes(1);
    expect(osc.stop).toHaveBeenCalledTimes(1);
  });

  it('sd: ~200Hz sine wave', async () => {
    const { previewSample } = await import('./audioActions');
    previewSample('sd');
    const ctx = (globalThis as unknown as { __wavecodeAudioCtx: AudioContextMock }).__wavecodeAudioCtx;
    const osc = (ctx.createOscillator as unknown as { mock: { results: Array<{ value: OscillatorMock }> } }).mock.results[0]!.value;
    expect(osc.type).toBe('sine');
    expect(osc.frequency.value).toBeCloseTo(200, 5);
  });

  it('hh: ~8000Hz square wave (cymbal-like)', async () => {
    const { previewSample } = await import('./audioActions');
    previewSample('hh');
    const ctx = (globalThis as unknown as { __wavecodeAudioCtx: AudioContextMock }).__wavecodeAudioCtx;
    const osc = (ctx.createOscillator as unknown as { mock: { results: Array<{ value: OscillatorMock }> } }).mock.results[0]!.value;
    expect(osc.type).toBe('square');
    expect(osc.frequency.value).toBeCloseTo(8000, 5);
  });

  it('cp: ~1200Hz sawtooth', async () => {
    const { previewSample } = await import('./audioActions');
    previewSample('cp');
    const ctx = (globalThis as unknown as { __wavecodeAudioCtx: AudioContextMock }).__wavecodeAudioCtx;
    const osc = (ctx.createOscillator as unknown as { mock: { results: Array<{ value: OscillatorMock }> } }).mock.results[0]!.value;
    expect(osc.type).toBe('sawtooth');
    expect(osc.frequency.value).toBeCloseTo(1200, 5);
  });

  it('cleanup: osc.onended fires disconnect on osc + gain', async () => {
    const { previewSample } = await import('./audioActions');
    previewSample('bd');
    const ctx = (globalThis as unknown as { __wavecodeAudioCtx: AudioContextMock }).__wavecodeAudioCtx;
    const osc = (ctx.createOscillator as unknown as { mock: { results: Array<{ value: OscillatorMock }> } }).mock.results[0]!.value;
    const gain = (ctx.createGain as unknown as { mock: { results: Array<{ value: GainNodeMock }> } }).mock.results[0]!.value;
    expect(osc.onended).not.toBeNull();
    // Synthesize the WebAudio `ended` event firing.
    osc.onended!();
    expect(osc.disconnect).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
  });

  it('ADSR: gain.linearRampToValueAtTime scheduled (attack/sustain/release)', async () => {
    const { previewSample } = await import('./audioActions');
    previewSample('bd');
    const ctx = (globalThis as unknown as { __wavecodeAudioCtx: AudioContextMock }).__wavecodeAudioCtx;
    const gain = (ctx.createGain as unknown as { mock: { results: Array<{ value: GainNodeMock }> } }).mock.results[0]!.value;
    const linearRamp = gain.gain.linearRampToValueAtTime as unknown as { mock: { calls: Array<[number, number]> } };
    expect(linearRamp.mock.calls.length).toBeGreaterThanOrEqual(2);
    // At minimum: attack → peakGain, decay → sustain floor
    const targets = linearRamp.mock.calls.map(([v]) => v);
    expect(targets).toContain(0.85); // bd peakGain
  });
});
