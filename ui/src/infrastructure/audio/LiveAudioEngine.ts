import { Effect, Layer } from 'effect';
import { AudioEngine } from '~/domain/services';
import type * as CoreModule from '@strudel/core';
import type * as MiniModule from '@strudel/mini';
import type * as TonalModule from '@strudel/tonal';
import type * as TranspilerModule from '@strudel/transpiler';
import type * as WebaudioModule from '@strudel/webaudio';
import type { LayerMix } from '~/domain/types';
import type { NoteEvent } from '~/domain/midi/encoder';
import { injectMix } from '~/application/useCases/injectMix';
import { LiveRecorder, pickSupportedMime } from './AudioRecorder';
import { renderToWav } from './OfflineRender';
import { applyVoicingAliases } from './strudelPatches';
import { setActive as setRuntimeHighlightActive, clearActive as clearRuntimeHighlightActive, parseLayerRanges } from './runtimeHighlight';

// `wrapSuperdoughLoadBuffer` is imported lazily (inside ensureRepl) so
// that test files which pull in `LiveAudioEngine` (e.g. audioActions.ts,
// TransportPanel.test.tsx) do NOT eagerly load SampleLoader, which in
// turn pulls in `@strudel/webaudio` -> `@strudel/core` -> SalatRepl from
// `@kabelsalat/web` (a CJS-only module that fails the Vitest ESM resolver).
// The dynamic import is at the call site below (~20ms in production,
// ~1ms in tests where the test never reaches ensureRepl).

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

/**
 * Install an AnalyserNode as a "tap" on the audio path going to the
 * speakers. Strudel/superdough owns the master-gain → destination
 * routing internally and exposes no hook to insert analysis nodes;
 * the standard visualization trick is to patch `AudioNode.prototype.connect`
 * so that any `node.connect(audioCtx.destination)` call is rewritten as
 * `node.connect(analyser); analyser.connect(audioCtx.destination)`.
 *
 * The analyser is pass-through (audio still reaches the speakers), and
 * exposes `getByteFrequencyData` / `getByteTimeDomainData` for the
 * `VisualizerPanel` to read. We use a re-entry guard so the
 * `analyser.connect(destination)` we issue ourselves does not recurse.
 *
 * Idempotent per audioCtx (engine caches the AudioContext in
 * `__wavecodeAudioCtx` so this runs at most once per session).
 *
 * See packet decisions/visualizer-tab.yaml for the design rationale.
 */
const installAnalyserTap = (audioCtx: AudioContext, analyser: AnalyserNode): void => {
  const tag = (AudioNode.prototype as unknown as {
    __wcAnalyserCtx?: WeakSet<AudioContext>;
  });
  tag.__wcAnalyserCtx = tag.__wcAnalyserCtx ?? new WeakSet<AudioContext>();
  if (tag.__wcAnalyserCtx.has(audioCtx)) return;
  tag.__wcAnalyserCtx.add(audioCtx);

  const original = AudioNode.prototype.connect;
  let inTap = false;
  const patched = function (this: AudioNode, ...args: unknown[]): AudioNode | undefined {
    const target = args[0];
    if (!inTap && target === audioCtx.destination) {
      inTap = true;
      try {
        const outIdx = (args[1] as number | undefined) ?? 0;
        const inIdx = (args[2] as number | undefined) ?? 0;
        const r = (original as unknown as (...a: unknown[]) => AudioNode).call(
          this,
          analyser,
          outIdx,
          0,
        );
        (original as unknown as (...a: unknown[]) => AudioNode).call(
          analyser,
          target,
          0,
          inIdx,
        );
        return r;
      } finally {
        inTap = false;
      }
    }
    return (original as unknown as (...a: unknown[]) => AudioNode).apply(this, args);
  };
  AudioNode.prototype.connect = patched as typeof AudioNode.prototype.connect;
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
  setCps?: (cps: number) => void;
  /**
   * Hot-swap the parsed Pattern into the live scheduler without going
   * through `evaluate`'s beforeEval/afterEval/sample-init side-effects.
   * `autostart=false` keeps the scheduler running; the new pattern
   * kicks in at the next lookahead window (~50ms @ cps=1).
   *
   * Used by `setLayerMix` for live mixer edits.
   * See decisions/wavecode-mixer-live-update.yaml.
   */
  setPattern?: (pattern: unknown, autostart?: boolean) => Promise<unknown>;
  /** Strudel Cyclist scheduler — exposes `.pattern` (active Pattern). */
  scheduler?: { pattern?: { queryArc?: (a: number, b: number) => unknown[] } };
  /** Repl state — contains transpiler-emitted `miniLocations`. */
  state?: { miniLocations?: ReadonlyArray<ReadonlyArray<number>> };
};

type DebugState = {
  triggers: number;
  superdoughErr: string | null;
  audioCtxState: string;
  replErr: string | null;
  lastEvalErr: string | null;
  cps: number;
  /** AudioContext.currentTime последнего успешного eval (для getCycleProgress). */
  lastEvalClock: number;
  /** cps, актуальный на момент eval (для прогресса playhead). */
  evalCps: number;
  /**
   * Последний snippet, переданный в `eval` — используется
   * `getActiveHaps` для повторного `compileAndQuery` без повторного eval
   * scheduler. Это позволяет piano FOLLOW-режиму опрашивать активные haps
   * каждые 50ms без перезапуска scheduler.
   */
  lastEvaluatedSnippet: string;
};

/**
 * Minimal superdough surface `ensureRepl` needs. Declared separately so
 * the boot sequence can be unit-tested with a recording double.
 */
type SuperdoughRuntime = typeof WebaudioModule & {
  registerSynthSounds: () => void;
  initAudio: (opts?: { maxPolyphony?: number; multiChannelOrbits?: boolean }) => Promise<void>;
  setAudioContext: (ctx: AudioContext) => void;
};

/**
 * Point superdough at OUR AudioContext, THEN load its worklets.
 *
 * ORDER IS LOAD-BEARING. `initAudio()` internally calls superdough's
 * private `getAudioContext()`, which lazily creates a brand-new
 * `AudioContext` when none has been set, and calls
 * `audioWorklet.addModule(...)` on whatever it gets back. AudioWorklet
 * processors are registered per-BaseAudioContext — `new
 * AudioWorkletNode` throws `NotSupportedError` for a name missing from
 * that context's registry.
 *
 * So calling `initAudio()` before pinning the context loads the worklet
 * modules onto a throwaway context, and the `webaudioRepl({audioContext})`
 * call that follows re-points superdough at the app context, whose
 * worklet registry is then empty. Every worklet-backed node throws on
 * every hap:
 *
 *   [getTrigger] error: Failed to construct 'AudioWorkletNode'
 *
 * once per hap, dozens of times a second. Audio survived because
 * superdough builds the source graph before applying the effect chain,
 * so effects that are merely in parallel still sounded — but `.shape()`,
 * `.djf()`, `s("supersaw")` and ladder filtering were silently DEAD in
 * production. Creep calls `.shape(0.6)` in every chorus stack.
 *
 * Set first, load second: `addModule` then lands on the context that
 * will actually be used, and the later `webaudioRepl` call re-sets the
 * same value as a no-op.
 *
 * Exported for the ordering regression test; not part of the public API.
 */
export const primeSuperdoughAudio = async (
  runtime: SuperdoughRuntime,
  audioCtx: AudioContext,
): Promise<void> => {
  runtime.setAudioContext(audioCtx);
  try {
    await runtime.initAudio();
    console.log('[wavecode] initAudio done (worklets loaded)');
  } catch (err) {
    console.warn('[wavecode] initAudio failed (will continue without worklets):', err);
  }
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
  lastEvalClock: 0,
  evalCps: 0,
  lastEvaluatedSnippet: '',
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
  const win = window as unknown as {
    __wavecodeAudioCtx?: AudioContext;
    __wavecodeAnalyser?: AnalyserNode;
  };
  let audioCtx = win.__wavecodeAudioCtx;
  if (!audioCtx) {
    audioCtx = new AudioContext();
    win.__wavecodeAudioCtx = audioCtx;
    // Create one persistent AnalyserNode and install the destination-tap
    // BEFORE any other code (Strudel's webaudioRepl) routes audio. The
    // visualizer reads it via `getAnalyserNode()` / `__wavecodeAnalyser`.
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    installAnalyserTap(audioCtx, analyser);
    win.__wavecodeAnalyser = analyser;
  }
  setDebug({ audioCtxState: audioCtx.state });
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
};

export const getAnalyserNode = (): AnalyserNode | null => {
  const win = window as unknown as { __wavecodeAnalyser?: AnalyserNode };
  return win.__wavecodeAnalyser ?? null;
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

      // (The warm-cache wrapper that used to be installed here was
      // removed 2026-10-20: patching `loadBuffer` on the
      // `@strudel/webaudio` module namespace can never succeed — spec
      // hardwires `[[Set]]`/`[[DefineOwnProperty]]` to `false` on a
      // module namespace object — and it targets a symbol superdough
      // calls as a module-local const anyway. See the long note in
      // SampleLoader.ts for the full post-mortem.)

      // Inject chord-symbol aliases (min7 → m7, maj7 → ^7, …) into every
      // voicing dictionary BEFORE any preset using `.voicing()` is evaluated.
      // Otherwise strudel throws per hap and logs `[voicing]: unknown chord`
      // ~8 times/sec for `<Dmin7 G7 Cmaj7>`-style progressions.
      // See strudelPatches.ts for the full rationale.
      const voicingAliasCount = applyVoicingAliases(modules.tonal);
      if (voicingAliasCount > 0) {
        console.log(`[wavecode] voicing aliases registered: ${voicingAliasCount}`);
      }

      // Регистрируем дефолтные синты (sawtooth/sine/square/triangle/noise).
      // БЕЗ этого Cyclist триггерит хапы, но superdough падает с
      // "sound sawtooth not found" — тишина.
      //
      // CRITICAL: must use the SAME superdough instance that
      // `webaudioRepl` is using internally, otherwise `registerSound`
      // writes to a different `soundMap` than the one Cyclist reads
      // from — every hap with `.s("sawtooth")` / `.s("triangle")` /
      // `.s("white")` then throws `sound X not found`. We use the
      // re-exported surface from `@strudel/webaudio` (loaded via the
      // SAME `loadModules()` instance that created the repl) instead
      // of a separate `import * from 'superdough'` — Vite's static
      // analysis would otherwise create a second superdough module
      // instance and we'd hit the dual-soundMap bug (see the
      // `[getTrigger] error: sound X not found` storm in the user's
      // console before this fix).
      const superdoughRuntime = modules.webaudio as typeof WebaudioModule & {
        registerSynthSounds: () => void;
        initAudio: (opts?: { maxPolyphony?: number; multiChannelOrbits?: boolean }) => Promise<void>;
        setAudioContext: (ctx: AudioContext) => void;
      };
      superdoughRuntime.registerSynthSounds();
      console.log('[wavecode] synth sounds registered');

      // Point superdough's module-global AudioContext at OURS *before*
      // loading worklets. This ordering is load-bearing.
      //
      // `initAudio()` calls superdough's private `getAudioContext()`,
      // which lazily creates its OWN AudioContext if none was set, and
      // then calls `audioWorklet.addModule(...)` on whatever it got.
      // AudioWorklet processors are registered per-BaseAudioContext, not
      // process-wide, and `new AudioWorkletNode` throws NotSupportedError
      // for a name absent from that context's registry.
      //
      // The bug this fixes: `webaudioRepl({audioContext})` below calls
      // superdough's `setAudioContext()` and re-points every subsequent
      // trigger at OUR context — but the worklet modules had already been
      // added to superdough's throwaway context. Ours had an empty
      // registry, so every worklet-backed node threw at trigger time:
      //   [getTrigger] error: Failed to construct 'AudioWorkletNode'
      // once per hap, dozens of times a second. Audio kept playing
      // because superdough connects the source graph before the effect
      // chain, but `.shape()`, `.djf()`, `s("supersaw")` and ladder
      // filtering were SILENTLY DEAD in production — Creep uses
      // `.shape(0.6)` in every chorus stack.
      //
      // Setting the context first means `addModule` lands on the context
      // that will actually be used. `webaudioRepl` below then sets the
      // same value, which is a no-op.
      await primeSuperdoughAudio(superdoughRuntime, audioCtx);

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
            // Snapshot clock + cps сразу после успешного eval — playhead
            // должен отсчитывать прогресс цикла, синхронно с Цикл-листом
            // Strudel. Если просто пересчитывать на каждом RAF без якоря —
            // прогресс уползёт при каждом reload preset.
            setDebug({
              lastEvalClock: audioCtx.currentTime,
              evalCps: debugState.cps,
            });
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
          // Reset progress anchor — после stop прогресс должен показать 0,
          // а не «застыть» на значении, бывшем в момент остановки.
          setDebug({ lastEvalClock: 0 });
          // Clear runtime mini-notation highlight — no active pattern,
          // any leftover decoration would freeze on stale ranges.
          clearRuntimeHighlightActive();
        },
        setCps: (cps: number) => {
          // Cyclist (через @strudel/webaudio) поддерживает setCps сразу —
          // никакого re-eval не нужно, scheduler пересчитает lookahead.
          if (typeof repl.setCps === 'function') {
            repl.setCps(cps);
            setDebug({ cps });
          }
        },
        audioCtx,
        // Expose scheduler + state so callers (runtime mini-notation
        // highlight, future inspector tools) can reach the live Pattern
        // and the transpiler's miniLocations from outside the closure.
        scheduler: repl.scheduler as unknown as ReplHandle['scheduler'],
        state: repl.state as unknown as ReplHandle['state'],
      } as ReplHandle;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDebug({ replErr: msg });
      console.error('[wavecode/ensureRepl] error:', msg, err);
      throw err;
    }
  })();
  return cachedRepl as Promise<ReplHandle>;
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

/**
 * Sync-first version of the transpile + queryArc + extract pipeline that
 * `compileAndQuery` uses. Extracted so `getActiveHaps` can re-run the
 * SAME pipeline against the last evaluated snippet without going through
 * `compileAndQuery`'s effect wrapper (which would re-import modules and
 * re-allocate state on every 50ms poll).
 */
const rawCompileAndQuery = async (
  snippet: string,
  cycles: number,
): Promise<ReadonlyArray<NoteEvent>> => {
  const modules = await loadModules();
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

/**
 * Hot-swap helper shared by `setLayerMix` and `setScore`. Both methods
 * build a new snippet (via `injectMix`), re-evaluate it through the
 * live scheduler (no `repl.stop`, so the old pattern keeps sounding
 * for one compile window), refresh the runtime highlight bridge with
 * the existing playhead anchor (mix edits shouldn't shift the
 * highlight phase), and silently roll back on parse failure (audio
 * keeps playing the previous pattern). The two callers used to
 * duplicate this 25-line body verbatim; extracting it removes the
 * drift risk and keeps the contract in one place.
 */
const hotSwapPattern = async (newSnippet: string, _callerTag: string): Promise<void> => {
  const audioCtx = unlockAudioContext();
  const repl = await ensureRepl(audioCtx);
  setDebug({ lastEvaluatedSnippet: newSnippet });
  await repl.evaluate(newSnippet);
  const livePattern = repl.scheduler?.pattern;
  const anchor = debugState.lastEvalClock > 0 ? debugState.lastEvalClock : audioCtx.currentTime;
  if (livePattern && typeof (livePattern as { queryArc?: unknown }).queryArc === 'function') {
    setRuntimeHighlightActive({
      pattern: livePattern as unknown as { queryArc(begin: number, end: number): ReadonlyArray<unknown> },
      ctx: audioCtx,
      anchor,
      cps: debugState.cps > 0 ? debugState.cps : 1,
      layerRanges: parseLayerRanges(newSnippet),
    });
  }
};

/**
 * Catch handler for `setLayerMix` / `setScore`. Logs a warning at the
 * engine level (so Debug > Console can surface the reason the user's
 * mixer/grid edits didn't reach their ears) and returns a void
 * sentinel so the wrapping `Effect.catchAll` can resolve cleanly.
 */
const silentRollback = (callerTag: string) => (err: unknown): null => {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(
    `[wavecode/LiveAudioEngine.${callerTag}] parse failed, keeping previous pattern:`,
    msg,
  );
  return null;
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
            // Snapshot the snippet SOON AS POSSIBLE — even before the
            // scheduler's first lookahead resolves. `getActiveHaps` uses
            // this to re-run `compileAndQuery` against the latest score
            // without re-starting the scheduler.
            setDebug({ lastEvaluatedSnippet: snippet });
            // Activate runtime mini-notation highlight (CodeMirror): feed
            // the freshly-scheduled Pattern into the bridge so editor
            // decorations start emitting. We call setActive unconditionally
            // and let the bridge filter — if the pattern is missing or
            // has no queryArc, bridge simply computes empty ranges.
            // See decisions/wavecode-runtime-mini-highlight.yaml.
            const livePattern = repl.scheduler?.pattern;
            const hasQueryArc = !!livePattern && typeof (livePattern as { queryArc?: unknown }).queryArc === 'function';
            // Diagnostic surface — published every eval so we can tell
            // from devtools whether scheduler.pattern was populated
            // when setActive was called.
            if (typeof window !== 'undefined') {
              (window as unknown as { __wavecodeReplState?: unknown }).__wavecodeReplState = {
                hasRepl: !!repl,
                hasScheduler: !!repl.scheduler,
                hasPattern: !!livePattern,
                hasQueryArc,
                patternType: livePattern ? (typeof livePattern).toString() : null,
              };
            }
            if (livePattern) {
              setRuntimeHighlightActive({
                pattern: livePattern as unknown as { queryArc(begin: number, end: number): ReadonlyArray<unknown> },
                ctx: audioCtx,
                anchor: audioCtx.currentTime,
                cps: debugState.cps > 0 ? debugState.cps : 1,
                layerRanges: parseLayerRanges(snippet),
              });
            } else if (process.env.NODE_ENV !== 'production') {
              console.warn('[wavecode/LiveAudioEngine.eval] no livePattern; setActive skipped (repl.scheduler=', !!repl.scheduler, 'hasPattern=', !!livePattern, ')');
            }
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
        try: async () => rawCompileAndQuery(snippet, cycles),
        catch: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[wavecode/LiveAudioEngine.compileAndQuery]', msg, err);
          return new Error(`compileAndQuery failed: ${msg}`);
        },
      }),
    setCps: (cps: number) =>
      Effect.tryPromise({
        try: async () => {
          // Update debug.cps SYNCHRONOUSLY before any awaits. Without
          // this, an early setCps call (from useTransportAudioSync's
          // 100ms debounce — repl may not yet exist) silently no-ops
          // and debugState.cps stays 0; the subsequent audio.eval
          // captures evalCps=0 → getCycleProgress returns 0 →
          // playhead sticks at column 0. The inner repl.setCps
          // (ensureRepl::callable) also writes setDebug — that's
          // idempotent once repl exists. See packet
          // decisions/wavecode-step-grid-autoload-and-sync.yaml.
          setDebug({ cps });
          if (!cachedRepl) return;
          const repl = await cachedRepl;
          repl.setCps?.(cps);
        },
        catch: () => null as null,
      }).pipe(Effect.catchAll(() => Effect.void)),
    /**
     * Hot-swap mixer edits into the live pattern.
     *
     * Flow:
     *   1. read `debugState.lastEvaluatedSnippet` (set by `eval()`);
     *   2. rebuild the snippet via `injectMix(snippet, layerMix)`
     *      (pure string-level .gain() injection per top-level layer);
     *   3. `repl.evaluate(newSnippet)` — same code path as a fresh eval
     *      MINUS the explicit `repl.stop()` that `eval()` does above;
     *      scheduler stays running, the new pattern takes over at the
     *      next lookahead window (`Cyclist.setPattern` assigns
     *      `this.pattern = newPat` atomically when already started —
     *      see @strudel/core/cyclist.mjs:3171-3173).
     *
     * Trade-offs (wavecode-mixer-live-update packet):
     *   - `eval()`'s `repl.stop()` is intentionally skipped. The old
     *     pattern keeps playing for the duration of `compileKabel`
     *     (~5-30ms for a 6-layer stack) then atomically swaps to the
     *     new one. No audio gap, no static, no scheduler reset.
     *   - On parse failure (corrupt snippet between eval and mix —
     *     e.g. user hit undo with a stale score), the catch silently
     *     no-ops. The old pattern continues; UI debounces will retry
     *     on the next mixer change.
     *   - `evalScope()` and `applyVoicingAliases()` are re-run on each
     *     call (cheap, idempotent); `beforeEval`/`afterEval` callbacks
     *     fire but are designed to be safe to repeat.
     *
     * Called by `applyMixLive` in `audioActions.ts`, debounced 50ms
     * from the MixerPanel.
     */
    setLayerMix: (layerMix: ReadonlyArray<LayerMix>) =>
      Effect.tryPromise({
        try: async () => {
          const lastSnippet = debugState.lastEvaluatedSnippet;
          if (!lastSnippet.trim()) return;
          await hotSwapPattern(injectMix(lastSnippet, layerMix), 'setLayerMix');
        },
        catch: silentRollback('setLayerMix'),
      }).pipe(Effect.catchAll(() => Effect.void)),
    /**
     * Hot-swap a new score into the live scheduler. Used by StepGrid
     * edit-mode per-tap (see decisions/wavecode-step-grid-modes.yaml).
     *
     * Flow is the same as `setLayerMix` but the input is a complete
     * score (not a mixer-state patch). We rebuild the snippet via
     * `injectMix(newScore, layerMix)` so mixer state is preserved
     * across edit-mode taps, then call `repl.evaluate(newSnippet)`
     * which atomically swaps the parsed Pattern into the running
     * scheduler at the next lookahead window — no `repl.stop`, no
     * audio gap, no scheduler reset.
     *
     * Trade-offs: identical to `setLayerMix`. On parse failure, the
     * existing `repl.scheduler.pattern` keeps playing; UI debounces
     * retry on the next tap.
     */
    setScore: (score: string, layerMix: ReadonlyArray<LayerMix>) =>
      Effect.tryPromise({
        try: async () => {
          if (!score.trim()) return;
          await hotSwapPattern(injectMix(score, layerMix), 'setScore');
        },
        catch: silentRollback('setScore'),
      }).pipe(Effect.catchAll(() => Effect.void)),
    getCycleProgress: () =>
      Effect.sync(() => {
        // Sync-only — вызывается RAF-ом, обещание здесь неуместно.
        // Используем cps, актуальный на момент eval (evalCps) — если юзер
        // успел дёрнуть setCps после последнего eval, мы ещё не знаем, с
        // какой скоростью тикает scheduler; репортим по старой.
        const ctx = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx;
        if (!ctx) return 0;
        const cps = debugState.evalCps;
        const anchor = debugState.lastEvalClock;
        if (cps <= 0 || anchor <= 0) return 0;
        const elapsed = ctx.currentTime - anchor;
        // ((elapsed * cps) mod 1) даёт позицию 0..1 в цикле.
        const progress = (elapsed * cps) - Math.floor(elapsed * cps);
        return Number.isFinite(progress) ? progress : 0;
      }),
    getActiveHaps: () =>
      Effect.tryPromise({
        try: async (): Promise<ReadonlyArray<{ readonly midi: number }>> => {
          // No snippet was ever evaluated → scheduler is silent, return
          // an empty set rather than synthesising a query.
          const snippet = debugState.lastEvaluatedSnippet;
          if (!snippet) return [];

          // Determine current cycle position relative to the eval
          // anchor (same math as getCycleProgress).
          const ctx = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx;
          const cps = debugState.evalCps;
          const anchor = debugState.lastEvalClock;
          if (!ctx || cps <= 0 || anchor <= 0) return [];
          const elapsed = ctx.currentTime - anchor;
          const nowCycle = elapsed * cps;

          // Query a 2-cycle window so we catch haps whose begin is just
          // before "now" but whose end is past "now" (a note that
          // started 50ms ago should still be lit up).
          const events = await rawCompileAndQuery(snippet, 2);
          const windowStart = nowCycle - 0.05; // 50ms tolerance backwards
          const windowEnd = nowCycle + 0.95;   // up to ~1 cycle ahead

          const seen = new Set<number>();
          const out: { midi: number }[] = [];
          for (const e of events) {
            if (!Number.isFinite(e.midi)) continue;
            if (e.endCycle <= windowStart) continue;
            if (e.startCycle >= windowEnd) continue;
            if (seen.has(e.midi)) continue;
            seen.add(e.midi);
            out.push({ midi: e.midi });
          }
          return out;
        },
        catch: (err) => {
          // Defensive: if anything fails (transpiler hiccup, modules
          // not loaded), swallow it — caller (piano FOLLOW poll) just
          // highlights nothing. NEVER throw: that would pull
          // Effect-Error plumbing into presentation callers.
          const msg = err instanceof Error ? err.message : String(err);
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[wavecode/LiveAudioEngine.getActiveHaps]', msg);
          }
          return null;
        },
      }).pipe(Effect.catchAll(() => Effect.succeed<ReadonlyArray<{ readonly midi: number }>>([]))),
    recordLive: () =>
      Effect.try({
        try: () => {
          const audioCtx = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx
            ?? unlockAudioContext();
          const picked = pickSupportedMime();
          if (!picked) {
            throw new Error(
              'MediaRecorder.isTypeSupported вернул false для всех mime — браузер не поддерживает запись',
            );
          }
          return new LiveRecorder(audioCtx, picked);
        },
        catch: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[wavecode/LiveAudioEngine.recordLive]', msg, err);
          return new Error(`recordLive failed: ${msg}`);
        },
      }),
    renderOffline: (snippet: string, opts, callbacks) =>
      Effect.tryPromise({
        try: async () => {
          const modules = await loadModules();
          await modules.core.evalScope(modules.core, modules.mini, modules.tonal);
          const transpilerMod = modules.transpilerMod as unknown as {
            evaluate?: (code: string, transpiler: unknown) => Promise<{ pattern?: unknown }>;
            transpiler?: unknown;
          };
          if (!transpilerMod.evaluate) throw new Error('transpilerMod.evaluate недоступен');
          if (!transpilerMod.transpiler) throw new Error('transpilerMod.transpiler недоступен');
          const sdIdx = (await import('superdough')) as unknown as Record<string, unknown>;
          const sdOut = (await import(
            /* @vite-ignore */ 'superdough/superdoughoutput.mjs'
          )) as unknown as Record<string, unknown>;
          const SuperdoughAudioController = sdOut['SuperdoughAudioController'] as
            | (new (ctx: AudioContext) => unknown)
            | undefined;
          const superdough = sdIdx['superdough'] as
            | ((v: unknown, t: number, d: number, c: number, o?: number) => Promise<unknown>)
            | undefined;
          const setAudioContext = sdIdx['setAudioContext'] as
            | ((ctx: AudioContext) => void)
            | undefined;
          const setSuperdoughAudioController = sdIdx['setSuperdoughAudioController'] as
            | ((ctrl: unknown) => void)
            | undefined;
          const initAudio = sdIdx['initAudio'] as
            | ((opts: { maxPolyphony: number; multiChannelOrbits: boolean }) => Promise<void>)
            | undefined;
          if (!SuperdoughAudioController || !superdough || !setAudioContext ||
              !setSuperdoughAudioController || !initAudio) {
            throw new Error('superdough API не полностью доступно');
          }
          const liveCtx = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx ?? null;
          const result = await renderToWav(
            snippet,
            opts,
            callbacks ?? {},
            {
              superdough: {
                superdough,
                setAudioContext,
                setSuperdoughAudioController,
                SuperdoughAudioController,
                initAudio,
              },
              transpilerMod: {
                evaluate: transpilerMod.evaluate,
                transpiler: transpilerMod.transpiler,
              },
              liveAudioCtx: liveCtx,
            },
          );
          return result;
        },
        catch: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[wavecode/LiveAudioEngine.renderOffline]', msg, err);
          return new Error(`renderOffline failed: ${msg}`);
        },
      }),
  },
);

export const ensureAudioLoaded = (): Promise<void> =>
  loadModules()
    .then(() => undefined)
    .catch(() => undefined);
