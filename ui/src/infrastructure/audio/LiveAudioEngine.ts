/**
 * Live AudioEngine — real Strudel in main thread.
 *
 * Worker NOT used: Web Audio API is main-thread only (browser limitation).
 *
 * Audio pipeline:
 *   1. Импортируем core/mini/tonal/webaudio
 *   2. Их exports → globalThis (bootstrap)
 *   3. На user-eval: создаём Pattern через Function() wrapper
 *   4. Cyclist (scheduler) тикает каждые ~50ms, вызывает webaudioOutput
 *      для каждого hap → superdough → AudioContext → speakers
 *
 * NB: @strudel/transpiler сломан (peer-dep @kabelsalat/web) — не используем.
 *
 * Если в будущем парсинг станет узким местом — выделяем только transpile
 * в Worker через new Worker(new URL(...)). Audio playback всегда в main thread.
 */

import { Effect, Layer, type Context } from 'effect';
import { AudioEngine } from '~/domain/services';
import { debugStashAudioContext } from '~/presentation/panels/DebugPanel';

type WebAudioModule = {
  // webaudioOutput(hap, _t, currentTime, duration, cps) — arg 2 unused.
  webaudioOutput: (hap: unknown, _t: unknown, currentTime: number, duration: number, cps: number) => unknown;
  hush: () => void;
};

type CoreModule = {
  Pattern: new (...args: unknown[]) => unknown;
  Cyclist: new (config: CyclistConfig) => CyclistInstance;
};

type CyclistConfig = {
  interval: number;
  onTrigger: (hap: unknown, currentTime: number, cps: number, duration: number, ...rest: unknown[]) => unknown;
  onToggle?: (started: boolean) => void;
  onError?: (err: unknown) => void;
  getTime: () => number;
  latency?: number;
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  beforeStart?: () => Promise<void> | void;
};

type CyclistInstance = {
  setPattern(pattern: unknown, autostart: boolean): Promise<void>;
  start(): Promise<void>;
  pause(): void;
  stop(): void;
  setCps(cps: number): void;
  pause_on_error?: boolean;
};

let webaudioCache: WebAudioModule | null = null;
let coreCache: CoreModule | null = null;
let audioContextRef: AudioContext | null = null;
let bootstrapped = false;
let cyclist: CyclistInstance | null = null;

const ensureLoaded = async (): Promise<{
  webaudio: WebAudioModule;
  core: CoreModule;
}> => {
  if (webaudioCache && coreCache && bootstrapped) {
    return { webaudio: webaudioCache, core: coreCache };
  }

  // Load core (s/n/stack/slow + Cyclist) + webaudio (webaudioOutput, hush) +
  // mini/tonal (pattern primitives) + superdough (synth registration).
  const [webaudio, core, mini, tonal, superdough] = await Promise.all([
    import('@strudel/webaudio'),
    import('@strudel/core'),
    import('@strudel/mini'),
    import('@strudel/tonal'),
    import('superdough'),
  ]);

  webaudioCache = webaudio;
  coreCache = core;

  // Use superdough (we already imported it; this just keeps the ref).
  void superdough;

  if (!bootstrapped) {
    // Ensure AudioContext exists (lazy — first user gesture triggers resume).
    if (!audioContextRef) {
      audioContextRef = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      debugStashAudioContext(audioContextRef);
    }

    // CRITICAL: @strudel/webaudio has its own internal AudioContext (cached
    // via getAudioContext()). If superdough reads it from there while our
    // Cyclist reads from our own audioCtx, they diverge → superdough
    // gets a STALE audio context (currentTime=91s) while pattern events
    // are at pattern cycle 2.0 → "cannot schedule sounds in the past".
    // Force both to share the same AudioContext.
    if (typeof webaudio.setAudioContext === 'function') {
      webaudio.setAudioContext(audioContextRef);
    }

    // Register built-in synth sounds (sawtooth/square/triangle/sine).
    // Without this, s("sawtooth") fails with "sound not found".
    const superdough = await import('superdough');
    if (typeof superdough.registerSynthSounds === 'function') {
      superdough.registerSynthSounds();
    }

    // Expose pattern primitives as globals.
    for (const mod of [core, mini, tonal, webaudio]) {
      for (const [name, value] of Object.entries(mod)) {
        (globalThis as unknown as Record<string, unknown>)[name] = value;
      }
    }
    bootstrapped = true;
  }

  return { webaudio, core };
};

/**
 * Evaluate user code via @strudel/core's `evaluate` function.
 * Returns `{ pattern, meta }` — pattern is the Pattern object.
 *
 * Why not `new Function()`: core's `evaluate` properly sets up the scope
 * (controls, pattern proxies, register() injects), while a raw `new Function`
 * doesn't — it returns undefined because s/n/etc. globals aren't properly bound.
 */
const evaluateSnippet = async (snippet: string): Promise<unknown> => {
  const coreMod = await import('@strudel/core');
  const result = await coreMod.evaluate(snippet);
  return (result as { pattern?: unknown }).pattern;
};

/**
 * Build the Cyclist (scheduler) lazily on first eval.
 * The Cyclist fires onTrigger for each hap, which is forwarded to
 * webaudioOutput → superdough → AudioContext.
 */
const ensureCyclist = async (webaudio: WebAudioModule, core: CoreModule): Promise<CyclistInstance> => {
  if (cyclist) return cyclist;

  const audioCtx = audioContextRef ?? new AudioContext();

  let triggerCount = 0;
cyclist = new core.Cyclist({
    interval: 0.05,
    // Cyclist.onTrigger signature: (hap, latency, duration, cps, x)
    // — x is the absolute audio context time when the event should play.
    onTrigger: (hap: unknown, latency: unknown, duration: unknown, cps: unknown, x: unknown) => {
      triggerCount++;
      const latencyN = Number(latency ?? 0);
      const durationN = Number(duration ?? 0.5);
      const cpsN = Number(cps ?? 0.5);
      const xN = Number(x ?? 0);
      if (triggerCount <= 5) {
        // eslint-disable-next-line no-console
        console.info(
          `[wavecode audio] trigger #${triggerCount}:`,
          'hap.type=' + typeof hap,
          'whole=' + !!(hap as { whole?: unknown })?.whole,
          'latency=' + latencyN.toFixed(3),
          'cps=' + cpsN.toFixed(3),
          'duration=' + durationN.toFixed(3),
          'x=' + xN.toFixed(3),
        );
      }
      // webaudioOutput(hap, _latency, hapDuration, cps, targetTime)
      // From @strudel/webaudio dist: `De(e, t, n, o, s) => P(K(e), s, n, o, e.whole?.begin.valueOf())`
      // P signature is superdough(value, t, hapDuration, cps, cycle).
      // So: De.s → P.t (TARGET TIME), De.n → P.hapDuration, De.o → P.cps.
      // Correct order: (hap, _unused, duration, cps, x).
      const result = webaudio.webaudioOutput(hap, latencyN, durationN, cpsN, xN);
      if (triggerCount <= 5 && result) {
        // eslint-disable-next-line no-console
        console.info(
          `[wavecode audio] P args: x=${xN.toFixed(2)} dur=${durationN.toFixed(2)} cps=${cpsN.toFixed(2)} latency=${latencyN.toFixed(3)}`,
        );
      }
      if (triggerCount === 1) {
        // eslint-disable-next-line no-console
        console.info('[wavecode audio] webaudioOutput returned:', typeof result);
      }
      return result;
    },
    onToggle: (started) => {
      // eslint-disable-next-line no-console
      console.info('[wavecode audio] scheduler:', started ? 'started' : 'stopped');
    },
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error('[wavecode audio] scheduler error:', err);
    },
    getTime: () => audioCtx.currentTime,
    latency: 0.1,
    setInterval: (cb, ms) => window.setInterval(cb, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
  });

  return cyclist;
};

/* eslint-disable @typescript-eslint/no-unused-vars */

const impl: Context.Tag.Service<typeof AudioEngine> = {
  eval: (snippet: string) =>
    Effect.gen(function* () {
      const { webaudio, core } = yield* Effect.tryPromise(() => ensureLoaded());

      // Resume AudioContext (user gesture required first time).
      const audioCtx = audioContextRef;
      if (audioCtx && audioCtx.state === 'suspended') {
        yield* Effect.tryPromise({
          try: () => audioCtx.resume() as Promise<void>,
          catch: () => new Error('AudioContext resume failed'),
        }).pipe(Effect.catchAll(() => Effect.void));
      }

      const sched = yield* Effect.tryPromise(() => ensureCyclist(webaudio, core));

      // Stop previous pattern.
      yield* Effect.sync(() => {
        try { sched.stop(); } catch { /* ignore */ }
      });

      yield* Effect.tryPromise({
        try: async () => {
          const pattern = await evaluateSnippet(snippet);
          if (!pattern || typeof pattern !== 'object') {
            throw new Error(`Eval produced no pattern (got ${typeof pattern})`);
          }
          // setPattern(pattern, true) → starts the scheduler
          await sched.setPattern(pattern, true);
        },
        catch: (err) => {
          // eslint-disable-next-line no-console
          console.error('[wavecode audio] eval failed:', err);
          return err instanceof Error ? err : new Error(String(err));
        },
      });
    }),
  stop: () =>
    Effect.gen(function* () {
      if (!cyclist) return;
      yield* Effect.sync(() => {
        try { cyclist!.stop(); } catch { /* ignore */ }
      });
    }),
};

export const LiveAudioEngine: Layer.Layer<AudioEngine, never, never> = Layer.succeed(
  AudioEngine,
  impl as never,
);