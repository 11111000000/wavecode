import { audioBufferToWav, type AudioBufferLike } from '~/domain/audio/wavEncoder';
import { LiveRecorder, pickSupportedMime, takeFilename } from './AudioRecorder';

/**
 * LoopRecorder — multi-track loop recorder для live performance.
 *
 * Надстройка над существующим однократным `LiveRecorder`:
 *   - до 4 регионов (loops), каждый — отдельная запись MediaRecorder;
 *   - color-coded: 1=green, 2=cyan, 3=magenta, 4=violet;
 *   - overdub: повторный take в тот же slot ложится слоем (mix);
 *   - punch-in: запись стартует в нужный момент (по `ctx.currentTime`);
 *   - mix-down: все регионы через OfflineAudioContext + wavEncoder
 *     → один WAV Blob.
 *
 * Backward-compat: НЕ модифицирует `AudioRecorder`. Старый код
 *   `new LiveRecorder(ctx, picked)` + `start()/stop()` продолжает
 *   работать; `LiveRecorder`, `pickSupportedMime`, `takeFilename`
 *   ре-экспортированы ниже.
 *
 * ВАЖНО: Сам класс не владеет AudioContext — caller должен передать
 * `ctx: AudioContext` в `punchIn()` / `playRegion()` / `mixDownRegions()`.
 * Это решает проблему "no AudioContext" в SSR/Node-test и даёт
 * caller'у контроль над одним ctx на все регионы.
 */

export const MAX_REGIONS = 4;

const REGION_COLORS = ['green', 'cyan', 'magenta', 'violet'] as const;

export type RegionColor = (typeof REGION_COLORS)[number];

export type Region = {
  readonly id: string;
  readonly blob: Blob;
  /** Позиция старта относительно t=0 (мс). punch-in stamp. */
  readonly startMs: number;
  readonly color: RegionColor;
  /** Прозрачность последнего take 1.0 — слой по умолчанию. */
  readonly gain: number;
  /** AudioContext на которой был захвачен blob — для OfflineAudioContext. */
  readonly sampleRate: number;
  readonly createdAtMs: number;
};

export type AddRegionInput = {
  readonly blob: Blob;
  readonly startMs?: number;
  readonly sampleRate?: number;
};

export type PunchInOptions = {
  /** Слот (1..4). По умолчанию — следующий свободный slot. */
  readonly slot?: number;
  /** Логика punch-in: beat (0..3) → ms по ctc=2000ms. */
  readonly beatMs?: number;
};

/**
 * Дефолтная длина цикла Strudel (cps=0.5 → 2000 мс). Используется
 * только для расчёта punch-in смещения, если caller не передал beatMs.
 */
const DEFAULT_CYCLE_MS = 2000;

const CROSSFADE_MS = 50;

const colorForSlot = (slot: number): RegionColor => {
  const i = Math.max(0, Math.min(MAX_REGIONS - 1, slot));
  return REGION_COLORS[i]!;
};

let regionCounter = 0;
const nextRegionId = (): string => {
  regionCounter += 1;
  return `region-${Date.now().toString(36)}-${regionCounter}`;
};

const errInvalidSlot = (slot: number): Error =>
  new Error(`LoopRecorder: invalid slot ${slot} (must be 1..${MAX_REGIONS})`);

/**
 * Decode blob → AudioBuffer через переданный ctx. Caller гарантирует,
 * что ctx — тот же, что будет использоваться OfflineAudioContext.
 *
 * Если blob не decode'ится (Safari mp4 с нестандартным codec) —
 * возвращаем ошибку наружу; mixDownRegions then rejects.
 */
const decodeRegion = async (
  ctx: BaseAudioContext,
  blob: Blob,
  contextLabel: string,
): Promise<AudioBuffer> => {
  const arr = await blob.arrayBuffer();
  try {
    return await ctx.decodeAudioData(arr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `LoopRecorder: decode failed (${contextLabel}, ${blob.type ?? 'unknown mime'}): ${msg}`,
    );
  }
};

/**
 * LoopRecorder — public API.
 *
 * Mutable внутреннее состояние, но не singleton (между экспериментами
 * пользователь может создать свежий recorder). Каждый экземпляр
 * держит свой массив регионов.
 *
 * SingleSourceOfTruth: единственный источник истины для UI —
 * массив `regions`. Accessor'ы на UI должны подписываться на сигнал
 * в `recorderStore.ts` (presentation слой).
 */
export class LoopRecorder {
  private readonly regionsStore: Region[] = [];

  /**
   * Регионы в порядке добавления. Возвращаем копию, чтобы caller
   * не мог мутировать внутренний store.
   */
  getRegions(): ReadonlyArray<Region> {
    return [...this.regionsStore];
  }

  getRegionCount(): number {
    return this.regionsStore.length;
  }

  /**
   * Добавить регион (уже записанный blob). Авто-цвет по индексу.
   * Если регионов уже 4 — кидает ошибку.
   */
  addRegion(input: AddRegionInput): Region {
    if (this.regionsStore.length >= MAX_REGIONS) {
      throw new Error(
        `LoopRecorder: max regions reached (${MAX_REGIONS}); clear or delete before adding`,
      );
    }
    const slot = this.regionsStore.length;
    const region: Region = {
      id: nextRegionId(),
      blob: input.blob,
      startMs: input.startMs ?? 0,
      color: colorForSlot(slot),
      gain: 1,
      sampleRate: input.sampleRate ?? 44100,
      createdAtMs: Date.now(),
    };
    this.regionsStore.push(region);
    return region;
  }

  /**
   * Удалить регион по id. После удаления цвета остальных регионов
   * НЕ пересчитываются (UI stable). Если нужно — clearAllRegions + addRegion заново.
   */
  removeRegion(id: string): boolean {
    const idx = this.regionsStore.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.regionsStore.splice(idx, 1);
    return true;
  }

  clearAllRegions(): void {
    this.regionsStore.length = 0;
  }

  /**
   * Найти регион по id. Pure accessor — возвращает null если нет.
   */
  findRegion(id: string): Region | null {
    return this.regionsStore.find((r) => r.id === id) ?? null;
  }

  /**
   * Воспроизвести регион в указанном ctx. Returns AudioBufferSourceNode
   * для опционального .stop() / подключения к gain.  Никакого auto-stop —
   * caller решает, когда выключать.
   *
   * Источник: декодированный AudioBuffer из blob. Если blob не decode'ится
   * (Safari mp4 с экзотическим codec) — пробрасывает ошибку.
   */
  async playRegion(id: string, ctx: AudioContext): Promise<AudioBufferSourceNode> {
    const region = this.findRegion(id);
    if (!region) throw new Error(`LoopRecorder: region ${id} not found`);
    const buffer = await decodeRegion(ctx, region.blob, `region ${id}`);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    return source;
  }

  /**
   * Punch-in: старт записи в нужный момент (по ctx.currentTime).
   *
   * Использует существующий LiveRecorder — backward-compat не нарушается.
   * Возвращает LiveRecorder handle, который caller может stop()'нуть
   * и завернуть в `addRegion()`.
   *
   * `options.slot` — в какой slot писать (1..4). По умолчанию используется
   * следующий свободный slot, или последний заполненный (overdub).
   *
   * `options.beatMs` — смещение от текущего момента (мс). По умолчанию
   * 0 (сразу). Если > 0, `handle.start()` вызывается синхронно из
   * setTimeout по истечении delay — caller получит handle сразу и
   * сможет подписаться на stop; real start уже произойдёт в фоне.
   */
  async punchIn(ctx: AudioContext, options: PunchInOptions = {}): Promise<LiveRecorder> {
    const picked = pickSupportedMime();
    if (!picked) {
      throw new Error('LoopRecorder.punchIn: ни один MediaRecorder MIME не поддержан');
    }
    const handle = new LiveRecorder(ctx, picked);
    const slot = options.slot ?? this.regionsStore.length + 1;
    if (slot < 1 || slot > MAX_REGIONS) throw errInvalidSlot(slot);
    const beatMs = Math.max(0, options.beatMs ?? 0);

    if (beatMs === 0) {
      handle.start();
    } else {
      const targetTime = ctx.currentTime + beatMs / 1000;
      const waitMs = Math.max(0, (targetTime - ctx.currentTime) * 1000);
      setTimeout(() => {
        handle.start();
      }, waitMs);
    }
    return handle;
  }

  /**
   * Beat → ms через ctc. cps=0.5 → cycle=2000ms, beat=0..3 → 0,500,1000,1500ms.
   */
  static beatToMs(beat: number, cycleMs = DEFAULT_CYCLE_MS): number {
    return beat * cycleMs;
  }

  /**
   * Mix-down всех регионов в один WAV Blob через OfflineAudioContext.
   *
   * Алгоритм:
   *   1. Decode всех blobs → AudioBuffer'ы (sample rate может различаться,
   *      но переданный ctx используется как референсный).
   *   2. max(endMs) — общая длина микса.
   *   3. Create OfflineAudioContext(channels=2, length=maxFrames, sampleRate=ctx.sampleRate).
   *   4. Для каждого региона: AudioBufferSourceNode с offset=startMs,
   *      gain=region.gain, fadeIn/CROSSFADE_MS. Если регионы перекрываются
   *      — применяется crossfade по границе.
   *   5. startRendering() → AudioBuffer → audioBufferToWav → Blob.
   *
   * Edge cases:
   *   - 0 регионов → throw (UI должен disable mix-down button).
   *   - Все регионы empty / decode fails → reject с понятной ошибкой.
   */
  async mixDownRegions(ctx: AudioContext): Promise<Blob> {
    if (this.regionsStore.length === 0) {
      throw new Error('LoopRecorder.mixDownRegions: нет регионов');
    }
    const sampleRate = ctx.sampleRate;
    const decoded: Array<{ region: Region; buffer: AudioBuffer }> = [];
    let maxFrames = 0;
    for (const region of this.regionsStore) {
      const buffer = await decodeRegion(ctx, region.blob, `mix-down region ${region.id}`);
      const startFrames = Math.round((region.startMs / 1000) * sampleRate);
      const endFrames = startFrames + buffer.length;
      if (endFrames > maxFrames) maxFrames = endFrames;
      decoded.push({ region, buffer });
    }
    if (maxFrames === 0) throw new Error('LoopRecorder.mixDownRegions: все регионы пустые');

    const numberOfChannels = 2;
    const offCtx = new OfflineAudioContext(numberOfChannels, maxFrames, sampleRate);

    for (const { region, buffer } of decoded) {
      const source = offCtx.createBufferSource();
      source.buffer = buffer;
      const gainNode = offCtx.createGain();
      const startSec = region.startMs / 1000;
      gainNode.gain.setValueAtTime(0, startSec);
      gainNode.gain.linearRampToValueAtTime(region.gain, startSec + CROSSFADE_MS / 1000);
      source.connect(gainNode).connect(offCtx.destination);
      source.start(startSec);
      // fade-out в конце чтобы избежать клина на стыке
      const durSec = buffer.duration;
      const fadeOutStart = startSec + durSec - CROSSFADE_MS / 1000;
      if (fadeOutStart > startSec + CROSSFADE_MS / 1000) {
        gainNode.gain.setValueAtTime(region.gain, fadeOutStart);
        gainNode.gain.linearRampToValueAtTime(0, startSec + durSec);
      }
    }

    const rendered = await offCtx.startRendering();
    const wavBytes = audioBufferToWav(rendered as unknown as AudioBufferLike);
    const wavBuffer = new ArrayBuffer(wavBytes.byteLength);
    new Uint8Array(wavBuffer).set(wavBytes);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  /**
   * Утилита для quick-inspect'а в дев-режиме: сколько памяти сейчас
   * занято всеми blobs регионов (rough estimate).
   */
  estimatedBlobBytes(): number {
    return this.regionsStore.reduce((acc, r) => acc + r.blob.size, 0);
  }
}

// Re-exports для backward-compat: презентационный код может импортировать
// `LiveRecorder`, `pickSupportedMime`, `takeFilename` из LoopRecorder.ts
// или из AudioRecorder.ts — оба пути работают.
export { LiveRecorder, pickSupportedMime, takeFilename };
