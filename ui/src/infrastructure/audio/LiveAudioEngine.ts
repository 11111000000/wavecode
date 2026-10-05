import { Effect, Layer } from 'effect';
import { AudioEngine } from '~/domain/services';
import type * as CoreModule from '@strudel/core';
import type * as MiniModule from '@strudel/mini';
import type * as TonalModule from '@strudel/tonal';
import type * as TranspilerModule from '@strudel/transpiler';
import type * as WebaudioModule from '@strudel/webaudio';
import type { NoteEvent } from '~/domain/midi/encoder';

/**
 * Live AudioEngine — реальный Strudel runtime в main thread.
 *
 * Использует `webaudioRepl()` из `@strudel/webaudio`, который:
 *   - создаёт AudioContext (если не передан),
 *   - запускает Cyclist scheduler,
 *   - подключает superdough для синтеза и сэмплов.
 *
 * Дополнительно нужно вручную:
 *   - `evalScope(core, mini, tonal)` — кладёт `stack`, `note`, `n`, `s` и т.д.
 *     на `globalThis`, иначе user snippet падает с `ReferenceError`.
 *   - `transpiler` опция в `webaudioRepl` — включает парсинг mini-notation
 *     (`<a b c>`, `*n`, `[a,b,c]`) иначе только plain-JS синтаксис.
 *
 ** На мобильных браузерах AudioContext должен быть создан/resumed ВНУТРИ
 ** user-gesture handler. `unlockAudioContext()` вызывается синхронно из
 ** click handler (ScorePanel.evalScore) ДО любых await — это критично.
 */

const MIN_PERIODIC_WAVE_LENGTH = 2;

const patchCreatePeriodicWave = (): void => {
  if ((window as unknown as { __patchedPeriodicWave?: boolean }).__patchedPeriodicWave) return;
  const proto = AudioContext.prototype as unknown as {
    createPeriodicWave: (
      real: Float32Array,
      imag: Float32Array,
      constraints?: PeriodicWaveConstraints,
    ) => PeriodicWave;
    createOscillator: (...args: unknown[]) => OscillatorNode;
  };
  // CRITICAL: НЕ биндить к proto — метод должен вызываться с `this = AudioContext instance`.
  // .bind(proto) даёт `this = AudioContext.prototype`, и OscillatorNode создаётся с
  // неправильным контекстом → Illegal invocation при .connect().
  const originalPeriodicWave = proto.createPeriodicWave;
  proto.createPeriodicWave = function (real, imag, constraints) {
    const padded = (arr: Float32Array): Float32Array => {
      if (arr.length >= MIN_PERIODIC_WAVE_LENGTH) return arr;
      const out = new Float32Array(MIN_PERIODIC_WAVE_LENGTH);
      out.set(arr);
      return out;
    };
    return originalPeriodicWave.call(this, padded(real), padded(imag), constraints);
  };
  // Counter: каждый вызов createOscillator — это новая нота.
  const originalCreateOsc = proto.createOscillator;
  proto.createOscillator = function (...args: unknown[]) {
    setDebug({ triggers: debugState.triggers + 1 });
    return originalCreateOsc.apply(this, args);
  };
  (window as unknown as { __patchedPeriodicWave?: boolean }).__patchedPeriodicWave = true;
};

type StrudelModules = {
  core: typeof CoreModule;
  mini: typeof MiniModule;
  tonal: typeof TonalModule;
  transpilerMod: typeof TranspilerModule;
  webaudio: typeof WebaudioModule;
};

type ReplHandle = {
  evaluate: (code: string) => Promise<unknown>;
  stop: () => void;
  audioCtx: AudioContext;
};

type DebugState = {
  triggers: number;
  superdoughErr: string | null;
  audioCtxState: string;
  replErr: string | null;
  lastEvalErr: string | null;
  cps: number;
};

let cachedRepl: Promise<ReplHandle> | null = null;
let modulesPromise: Promise<StrudelModules> | null = null;
let debugState: DebugState = {
  triggers: 0,
  superdoughErr: null,
  audioCtxState: 'uninitialized',
  replErr: null,
  lastEvalErr: null,
  cps: 0,
};

const setDebug = (patch: Partial<DebugState>): void => {
  debugState = { ...debugState, ...patch };
  (window as unknown as { __wavecodeDebug?: DebugState }).__wavecodeDebug = debugState;
};

export const getDebug = (): DebugState => debugState;

const loadModules = (): Promise<StrudelModules> => {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import('@strudel/core'),
      import('@strudel/mini'),
      import('@strudel/tonal'),
      import('@strudel/transpiler'),
      import('@strudel/webaudio'),
    ]).then(([core, mini, tonal, transpilerMod, webaudio]) => ({
      core,
      mini,
      tonal,
      transpilerMod,
      webaudio,
    }));
  }
  return modulesPromise;
};

export const unlockAudioContext = (): AudioContext => {
  patchCreatePeriodicWave();
  const existing = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx;
  const audioCtx = existing ?? new AudioContext();
  (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx = audioCtx;
  setDebug({ audioCtxState: audioCtx.state });
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
};

export const testBeep = (frequency = 440, durationMs = 400): void => {
  const audioCtx = unlockAudioContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + durationMs / 1000 + 0.05);
};

export const getAudioContextState = (): { state: string; sampleRate: number | null } => {
  const ctx = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx;
  if (!ctx) return { state: 'uninitialized', sampleRate: null };
  return { state: ctx.state, sampleRate: ctx.sampleRate };
};

const ensureRepl = (audioCtx: AudioContext): Promise<ReplHandle> => {
  if (cachedRepl) return cachedRepl;
  cachedRepl = (async () => {
    setDebug({ replErr: null });
    let modules: StrudelModules;
    try {
      modules = await loadModules();
      console.log('[wavecode] modules loaded');
      await modules.core.evalScope(modules.core, modules.mini, modules.tonal);
      console.log('[wavecode] evalScope done — stack/note/n/s on globalThis');

      // Регистрируем дефолтные синты (sawtooth/sine/square/triangle/noise).
      // БЕЗ этого Cyclist триггерит хапы, но superdough падает с
      // "sound sawtooth not found" — тишина.
      const superdoughMod = await import('superdough');
      superdoughMod.registerSynthSounds();
      console.log('[wavecode] synth sounds registered');

      // Загружаем worklet'ы (reverb, delay, djf) — нужно для synth с эффектами.
      try {
        await superdoughMod.initAudio();
        console.log('[wavecode] initAudio done (worklets loaded)');
      } catch (err) {
        console.warn('[wavecode] initAudio failed (will continue without worklets):', err);
      }

      const repl = modules.webaudio.webaudioRepl({
        audioContext: audioCtx,
        transpiler: modules.transpilerMod.transpiler,
      });
      console.log('[wavecode] webaudioRepl created');

      return {
        evaluate: async (code: string) => {
          try {
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            setDebug({ lastEvalErr: null, triggers: 0, superdoughErr: null });
            const result = await repl.evaluate(code);
            console.log('[wavecode] eval done, scheduler started');
            return result;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setDebug({ lastEvalErr: msg });
            console.error('[wavecode/eval] error:', msg, err);
            throw err;
          }
        },
        stop: () => {
          repl.stop();
          if (audioCtx.state === 'running') void audioCtx.suspend();
        },
        audioCtx,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDebug({ replErr: msg });
      console.error('[wavecode/ensureRepl] error:', msg, err);
      throw err;
    }
  })();
  return cachedRepl;
};

type HapLike = {
  whole?: { begin?: unknown };
  duration?: unknown;
  value?: unknown;
  context?: unknown;
  hasOnset?: () => boolean;
};

const fractionToNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && typeof (v as { valueOf?: () => number }).valueOf === 'function') {
    return Number((v as { valueOf: () => number }).valueOf());
  }
  return NaN;
};

const extractFromHap = (
  hap: unknown,
  getFrequency: (h: unknown) => unknown,
  accumulator: NoteEvent[],
): void => {
  const h = hap as HapLike;
  if (h.hasOnset && !h.hasOnset()) return;
  const value = h.value;
  if (value === undefined || value === null) return;

  const begin = fractionToNumber(h.whole?.begin);
  const dur = h.duration !== undefined ? fractionToNumber(h.duration) : 0.25;
  if (!Number.isFinite(begin) || !Number.isFinite(dur) || dur <= 0) return;

  let velocity = 100;
  let channel = 1;
  const ctx = h.context;
  if (typeof ctx === 'object' && ctx !== null) {
    const gain = (ctx as { gain?: unknown }).gain;
    if (typeof gain === 'number') velocity = Math.round(Math.max(0, Math.min(1, gain)) * 127);
    const ch = (ctx as { channel?: unknown }).channel;
    if (typeof ch === 'number' && ch >= 1 && ch <= 16) channel = ch;
  }

  const pushNote = (midi: number): void => {
    if (!Number.isFinite(midi)) return;
    accumulator.push({
      midi,
      startCycle: begin,
      endCycle: begin + dur,
      velocity,
      channel,
    });
  };

  try {
    const freq = getFrequency(hap);
    if (typeof freq === 'number' && Number.isFinite(freq) && freq > 0) {
      pushNote(Math.round(12 * Math.log2(freq / 440) + 69));
      return;
    }
  } catch {
    /* fallthrough to raw value */
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    pushNote(value);
  }
};

export const LiveAudioEngine: Layer.Layer<AudioEngine, never, never> = Layer.succeed(
  AudioEngine,
  {
    eval: (snippet: string) =>
      Effect.tryPromise({
        try: async () => {
          const audioCtx = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx
            ?? unlockAudioContext();
          const repl = await ensureRepl(audioCtx);
          // Stop the in-flight scheduler first so the previous pattern
          // does NOT keep playing one more cycle after the new one is
          // loaded. Without this, switching presets while audio was playing
          // leaves the user listening to the previous score for one cycle.
          await Promise.resolve();
          repl.stop();
          // AudioContext itself stays alive (do not call suspend — preserve
          // user-gesture state for subsequent context-stable resumes).
          if (audioCtx.state === 'suspended') await audioCtx.resume();
          await repl.evaluate(snippet);
        },
        catch: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[wavecode/LiveAudioEngine.eval]', msg, err);
          return new Error(`eval failed: ${msg}`);
        },
      }),
    stop: () =>
      Effect.tryPromise({
        try: async () => {
          if (!cachedRepl) return;
          const repl = await cachedRepl;
          repl.stop();
        },
        catch: () => null as null,
      }).pipe(Effect.catchAll(() => Effect.void)),
    compileAndQuery: (snippet: string, cycles: number) =>
      Effect.tryPromise({
        try: async () => {
          const modules = await loadModules();
          // ensure evalScope has been called so globalThis has stack/note/n/s
          await modules.core.evalScope(modules.core, modules.mini, modules.tonal);
          const transpilerMod = modules.transpilerMod as unknown as {
            evaluate?: (code: string, transpiler: unknown) => Promise<{ pattern?: unknown }>;
            transpiler?: unknown;
          };
          if (!transpilerMod.evaluate) throw new Error('transpilerMod.evaluate недоступен');
          const result = await transpilerMod.evaluate(snippet, transpilerMod.transpiler);
          const pattern = result.pattern as { queryArc?: (a: number, b: number) => unknown[] } | undefined;
          if (!pattern || typeof pattern.queryArc !== 'function') {
            throw new Error('compiled pattern не поддерживает queryArc');
          }
          const haps = pattern.queryArc(0, Math.max(1, Math.min(32, cycles | 0)));
          const coreMod = modules.core as unknown as {
            getFrequency?: (h: unknown) => unknown;
          };
          const getFreq = coreMod.getFrequency ?? ((h: unknown) => {
            const v = (h as { value?: unknown }).value;
            return typeof v === 'number' ? v : NaN;
          });
          const events: NoteEvent[] = [];
          for (const hap of haps) {
            extractFromHap(hap, getFreq, events);
          }
          return events;
        },
        catch: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[wavecode/LiveAudioEngine.compileAndQuery]', msg, err);
          return new Error(`compileAndQuery failed: ${msg}`);
        },
      }),
  },
);

export const ensureAudioLoaded = (): Promise<void> =>
  loadModules()
    .then(() => undefined)
    .catch(() => undefined);
