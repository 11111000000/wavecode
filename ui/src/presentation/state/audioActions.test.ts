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

/**
 * previewPreset / stopPreview tests.
 *
 * Mocking strategy (mirrors `audioActionsMixLive.test.ts`):
 *   - mock `~/infrastructure/composition` AppLayer → no-op, so the
 *     Effect runtime is bypassed for the AudioEngine `eval`/`stop`
 *     thunks and we observe the call sequence via `runPromiseCount`.
 *   - mock `./presetsStore` `getPreset` to return synthetic presets,
 *     so we can drive the function with deterministic IDs.
 *   - vi.useFakeTimers() so the auto-stop `setTimeout` is
 *     deterministic — we step the clock to fire it.
 */

let runPromiseCount = 0;

vi.mock('~/infrastructure/composition', () => ({
  AppLayer: { provide: () => (eff: unknown) => eff },
}));

vi.mock('./presetsStore', () => ({
  getPreset: (id: string) =>
    id === 'does-not-exist'
      ? undefined
      : {
          id,
          name: id,
          score: `// synthetic score: ${id}`,
          custom: false,
        },
}));

vi.mock('effect', async () => {
  const actual = (await vi.importActual('effect')) as Record<string, unknown>;
  const pipeable = (eff: unknown) => ({
    pipe: (..._args: unknown[]) => pipeable(eff),
    _orig: eff,
  });
  return {
    ...actual,
    Effect: {
      ...((actual['Effect'] as Record<string, unknown>) ?? {}),
      gen: (_fn: unknown) => pipeable({ kind: 'gen' }),
      provide: (_layer: unknown) => (eff: unknown) => pipeable(eff),
      runPromise: <A,>(_eff: unknown): Promise<A> => {
        runPromiseCount += 1;
        return Promise.resolve(undefined as A);
      },
    },
  };
});

beforeEach(() => {
  runPromiseCount = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('previewPreset / stopPreview — landing-page preset preview', () => {
  it('previewPreset: dispatches audio.stop (cleanup) + audio.eval = 2 Effect.runPromise calls', async () => {
    const { previewPreset, stopPreview } = await import('./audioActions');
    await previewPreset('creep');
    // previewPreset internally calls stopPreview() first → 1 runPromise
    // (audio.stop), then audio.eval → 1 runPromise. Total: 2.
    expect(runPromiseCount).toBe(2);
    stopPreview();
  });

  it('stopPreview: dispatches one Effect.runPromise (audio.stop) when called standalone', async () => {
    const { stopPreview } = await import('./audioActions');
    stopPreview();
    expect(runPromiseCount).toBe(1);
  });

  it('previewPreset: a second tap (stopPreview + previewPreset) on same id fires both', async () => {
    const { previewPreset, stopPreview } = await import('./audioActions');
    await previewPreset('creep'); // 1 stop + 1 eval = 2
    expect(runPromiseCount).toBe(2);
    stopPreview();                // +1 (audio.stop)
    await previewPreset('creep'); // +1 stop + +1 eval = 5 total
    expect(runPromiseCount).toBe(5);
    stopPreview();                // cleanup (+1 → 6)
  });

  it('previewPreset: switching to a different preset stops the old + starts the new', async () => {
    const { previewPreset, stopPreview } = await import('./audioActions');
    await previewPreset('creep');     // 2 (1 stop + 1 eval)
    await previewPreset('edm-house'); // previewPreset internally calls stopPreview() first → +1, then +1 (eval) = 4
    expect(runPromiseCount).toBe(4);
    stopPreview();                    // cleanup
  });

  it('previewPreset: unknown preset id is a no-op (no eval, no error throw)', async () => {
    const { previewPreset } = await import('./audioActions');
    await previewPreset('does-not-exist');
    // getPreset returns undefined → early return BEFORE stopPreview() is
    // called. So zero runPromise calls.
    expect(runPromiseCount).toBe(0);
  });

  it('previewPreset: auto-stop timer fires after PREVIEW_DURATION_MS', async () => {
    const { previewPreset, stopPreview, PREVIEW_DURATION_MS } = await import('./audioActions');
    await previewPreset('creep'); // 2
    expect(runPromiseCount).toBe(2);
    vi.advanceTimersByTime(PREVIEW_DURATION_MS - 1);
    expect(runPromiseCount).toBe(2); // not yet
    vi.advanceTimersByTime(1);
    expect(runPromiseCount).toBe(3); // auto-stop fired one more
    stopPreview();
  });

  it('stopPreview: clears pending auto-stop timer (no late Effect.runPromise)', async () => {
    const { previewPreset, stopPreview, PREVIEW_DURATION_MS } = await import('./audioActions');
    await previewPreset('creep'); // 2
    expect(runPromiseCount).toBe(2);
    stopPreview(); // manual stop before PREVIEW_DURATION_MS elapses
    expect(runPromiseCount).toBe(3); // stopPreview itself ran one more
    vi.advanceTimersByTime(PREVIEW_DURATION_MS * 2);
    expect(runPromiseCount).toBe(3); // no late eval — timer was cleared
  });
});
