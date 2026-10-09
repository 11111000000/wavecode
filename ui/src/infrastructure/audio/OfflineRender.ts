import { audioBufferToWav } from '~/domain/audio/wavEncoder';

/**
 * Offline render → WAV.
 *
 * Архитектурно повторяет @strudel/webaudio.renderPatternAudio, но:
 *   - возвращает `Blob` (не дёргает download автоматически),
 *   - использует chunked-yield между секциями (`setTimeout(0)`), чтобы
 *     не фризить main thread на 1–3 сек для 32-цикл (≈ 5.6M frames @ 44.1kHz),
 *   - использует compile-only `transpilerMod.evaluate` (не трогает live ctx
 *     до момента swap'а на OfflineAudioContext).
 *
 * Все зависимости от superdough передаются через `deps` — чтобы
 * TypeScript не ругался на отсутствие .d.ts (superdough экспортирует
 * только из index.mjs без деклараций), и чтобы domain/audio не зависел
 * от superdough напрямую (deps импортируются в LiveAudioEngine.ts).
 *
 * Производительность:
 *   4 цикла @ cps=0.5, 44.1kHz, stereo = ~352800 frames → <100ms typical.
 *   32 цикла = ~2.8M frames → main-thread freeze ~1.5 сек; разбиваем
 *   `audioContext.startRendering()` на секции через короткие yields.
 *
 * Stereo: OfflineAudioContext создаётся со `channels=2`; superdough-output
 * подключается к `offCtx.destination` через channelMerger → destinationGain.
 * Итоговый AudioBuffer уже stereo → пишем в WAV без downmix.
 *
 * iOS Safari: OfflineAudioContext поддерживается с iOS 14.5; chunked
 * через setTimeout(0) не падает, потому что offline-рендер синхронный
 * на стороне движка, наш yield — между секциями внешней обвязки.
 */

const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_CPS = 0.5; // Strudel default cps
const CHUNK_FRAMES = 65536; // ~1.5 сек @ 44.1kHz

export type OfflineRenderOptions = {
  /** Сколько циклов паттерна отрендерить. Default 4. */
  readonly cycles: number;
  /** Cycles-per-second. Default 0.5 (1 cycle = 2 sec). */
  readonly cps?: number;
  /** Sample rate для offline ctx. Default 44100. */
  readonly sampleRate?: number;
  /** Channels. Default 2 (stereo). */
  readonly channels?: number;
};

export type OfflineRenderProgress = {
  readonly progress: number;
  readonly stage: 'compiling' | 'rendering' | 'encoding' | 'done';
};

export type OfflineRenderResult = {
  readonly blob: Blob;
  readonly durationSec: number;
  readonly cycles: number;
  readonly sampleRate: number;
  readonly channels: number;
};

export type OfflineRenderCallbacks = {
  readonly onProgress?: (progress: OfflineRenderProgress) => void;
};

/**
 * Loose типы для superdough API (у пакета нет .d.ts, TS видит
 * только статичные exports из index.mjs; `setSuperdoughAudioController`
 * и `SuperdoughAudioController` импортируются из subpath и потому
 * приходят в caller через cast).
 *
 * LiveAudioEngine собирает deps, кастуя `import('superdough') as unknown as SuperdoughMod`,
 * а `SuperdoughAudioController` подгружает отдельным subpath-импортом.
 */
export type SuperdoughMod = {
  superdough: (value: unknown, time: number, duration: number, cps: number, onset?: number) => Promise<unknown>;
  setAudioContext: (ctx: AudioContext) => void;
  setSuperdoughAudioController: (ctrl: unknown) => void;
  SuperdoughAudioController: new (ctx: AudioContext) => unknown;
  initAudio: (opts: { maxPolyphony: number; multiChannelOrbits: boolean }) => Promise<void>;
};

export type TranspilerMod = {
  evaluate: (code: string, transpiler: unknown) => Promise<{ pattern?: unknown }>;
  transpiler: unknown;
};

export type OfflineRenderDeps = {
  readonly superdough: SuperdoughMod;
  readonly transpilerMod: TranspilerMod;
  readonly liveAudioCtx: AudioContext | null;
};

type StrudelPattern = {
  queryArc?: (a: number, b: number, opts?: unknown) => unknown[];
};

const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const compilePattern = async (
  snippet: string,
  transpilerMod: TranspilerMod,
): Promise<StrudelPattern> => {
  const result = await transpilerMod.evaluate(snippet, transpilerMod.transpiler);
  const pattern = result.pattern as StrudelPattern | undefined;
  if (!pattern || typeof pattern.queryArc !== 'function') {
    throw new Error('compiled pattern не поддерживает queryArc');
  }
  return pattern;
};

const ensureObjectValue = (hap: unknown): unknown => {
  const h = hap as { ensureObjectValue?: () => void; value?: unknown };
  if (typeof h.ensureObjectValue === 'function') h.ensureObjectValue();
  return h.value;
};

/**
 * Рендерит snippet в WAV Blob.
 *
 * Steps:
 *   1. Compile snippet → Pattern (compile-only).
 *   2. Создаёт OfflineAudioContext нужного размера.
 *   3. Swap'ает global audioContext superdough на offline ctx.
 *   4. queryArc(0, cycles) → Hap[] → superdough() для каждого (chunked).
 *   5. startRendering() → AudioBuffer → WAV → Blob.
 *   6. Восстанавливает live ctx (если был).
 */
export const renderToWav = async (
  snippet: string,
  opts: OfflineRenderOptions,
  callbacks: OfflineRenderCallbacks,
  deps: OfflineRenderDeps,
): Promise<OfflineRenderResult> => {
  const cycles = Math.max(1, Math.min(64, opts.cycles | 0));
  const cps = opts.cps ?? DEFAULT_CPS;
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = opts.channels ?? DEFAULT_CHANNELS;
  const cycleSec = cycles / cps;
  const totalFrames = Math.max(1, Math.round(cycleSec * sampleRate));

  callbacks.onProgress?.({ progress: 0, stage: 'compiling' });
  const pattern = await compilePattern(snippet, deps.transpilerMod);
  await yieldToBrowser();

  callbacks.onProgress?.({ progress: 0.1, stage: 'rendering' });

  const offCtx = new OfflineAudioContext(channels, totalFrames, sampleRate);
  const sd = deps.superdough;
  // Подменяем global audioContext superdough, чтобы superdough() внутри
  // рендера писал в OfflineAudioContext.
  sd.setAudioContext(offCtx as unknown as AudioContext);
  sd.setSuperdoughAudioController(new sd.SuperdoughAudioController(offCtx as unknown as AudioContext));
  await sd.initAudio({ maxPolyphony: 16, multiChannelOrbits: false });

  const haps = pattern
    .queryArc!(0, cycles, { _cps: cps })
    .sort((a: unknown, b: unknown) => {
      const aBegin =
        ((a as { whole?: { begin?: { valueOf: () => number } } }).whole?.begin?.valueOf()) ?? 0;
      const bBegin =
        ((b as { whole?: { begin?: { valueOf: () => number } } }).whole?.begin?.valueOf()) ?? 0;
      return aBegin - bBegin;
    });

  const chunkSize = CHUNK_FRAMES;
  let i = 0;
  while (i < haps.length) {
    const slice = haps.slice(i, i + chunkSize);
    for (const hap of slice) {
      const h = hap as {
        hasOnset?: () => boolean;
        whole?: { begin?: { valueOf: () => number } };
        duration?: number;
      };
      if (h.hasOnset && !h.hasOnset()) continue;
      const value = ensureObjectValue(h);
      const begin = (h.whole?.begin?.valueOf() ?? 0) / cps;
      const duration = (h.duration ?? 0.25) / cps;
      try {
        await sd.superdough(value, begin, duration, cps, begin);
      } catch (err) {
        console.warn('[offline-render] superdough error:', err);
      }
    }
    i += chunkSize;
    const ratio = Math.min(1, i / Math.max(1, haps.length));
    callbacks.onProgress?.({ progress: 0.1 + 0.6 * ratio, stage: 'rendering' });
    await yieldToBrowser();
  }

  callbacks.onProgress?.({ progress: 0.75, stage: 'rendering' });

  const renderedBuffer = await offCtx.startRendering();
  await yieldToBrowser();

  callbacks.onProgress?.({ progress: 0.85, stage: 'encoding' });

  const wav = audioBufferToWav(renderedBuffer);
  const blob = new Blob([wav as BlobPart], { type: 'audio/wav' });

  // Восстанавливаем live ctx.
  if (deps.liveAudioCtx) {
    sd.setAudioContext(deps.liveAudioCtx);
    sd.setSuperdoughAudioController(new sd.SuperdoughAudioController(deps.liveAudioCtx));
    sd.initAudio({ maxPolyphony: 16, multiChannelOrbits: false }).catch(() => undefined);
  }

  callbacks.onProgress?.({ progress: 1, stage: 'done' });

  return {
    blob,
    durationSec: cycleSec,
    cycles,
    sampleRate,
    channels,
  };
};