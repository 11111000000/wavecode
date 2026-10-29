import { createSignal, type Accessor } from 'solid-js';
import {
  LoopRecorder,
  type Region,
  type RegionColor,
  MAX_REGIONS,
} from '~/infrastructure/audio/LoopRecorder';
import type { LiveRecorder } from '~/infrastructure/audio/AudioRecorder';

/**
 * recorderStore — Solid signals + actions для LoopRecorder UI.
 *
 * Single source of truth для LoopRecorderPanel:
 *   - `regions` — массив записанных лупов (readonly snapshot).
 *   - `recording` — true если в данный момент идёт запись.
 *   - `recordingSlot` — слот 1..4 который сейчас пишется (или null).
 *   - `playbackMode` — 'all' (всё вместе) / 'region' (только один).
 *   - `lastError` — поверхностный error pill для UI.
 *
 * Layering:
 *   - presentation/state/recorderStore.ts зависит от
 *     infrastructure/audio/LoopRecorder.ts (UI → infrastructure).
 *   - He lives OUTSIDE appStore.ts, чтобы domain не знал о Web Audio
 *     APIs; presentation-state свободно дёргает audio-recorder слои.
 *
 * AudioContext — глобальный из `LiveAudioEngine.unlockAudioContext()`.
 * UI использует `getActiveAudioContext()` (lazy) — он бросает понятную
 * ошибку, если ctx ещё не создан (нашлось ещё до первого eval).
 *
 * Single instance — экспортируется module-scope `recorderStore` ниже.
 * Panel дёргает его напрямую.
 */

export type PlaybackMode = 'all' | 'region';

export type RecorderStoreState = {
  readonly regions: Accessor<ReadonlyArray<Region>>;
  readonly regionCount: Accessor<number>;
  readonly recording: Accessor<boolean>;
  readonly recordingSlot: Accessor<number | null>;
  readonly playbackMode: Accessor<PlaybackMode>;
  readonly lastError: Accessor<string | null>;
};

export type RecorderStoreActions = {
  readonly startRecording: (slot?: number) => Promise<void>;
  readonly stopRecording: () => Promise<void>;
  readonly punchIn: (beat: number) => Promise<void>;
  readonly playRegion: (id: string) => Promise<void>;
  readonly removeRegion: (id: string) => void;
  readonly clearRegions: () => void;
  readonly setPlaybackMode: (mode: PlaybackMode) => void;
  readonly exportMixDown: () => Promise<Blob | null>;
};

const loopRecorder = new LoopRecorder();

const [regions, setRegionsSig] = createSignal<ReadonlyArray<Region>>(
  loopRecorder.getRegions(),
);
const [recording, setRecording] = createSignal(false);
const [recordingSlot, setRecordingSlot] = createSignal<number | null>(null);
const [playbackMode, setPlaybackModeSig] = createSignal<PlaybackMode>('all');
const [lastError, setLastError] = createSignal<string | null>(null);

let activeHandle: LiveRecorder | null = null;
let activeSlot: number | null = null;

const refreshRegions = (): void => {
  setRegionsSig(loopRecorder.getRegions());
};

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Доступ к global AudioContext из LiveAudioEngine.unlockAudioContext().
 * Lazy import — чтобы не тащить LiveAudioEngine в Store module
 * (избегаем циклической зависимости через Dynamic import).
 */
const getActiveAudioContext = async (): Promise<AudioContext | null> => {
  try {
    const { unlockAudioContext } = await import('~/infrastructure/audio/LiveAudioEngine');
    return unlockAudioContext();
  } catch (err) {
    setLastError(`AudioContext недоступен: ${errMessage(err)}`);
    return null;
  }
};

const startRecording = async (slot?: number): Promise<void> => {
  if (recording()) {
    setLastError('уже идёт запись');
    return;
  }
  if (loopRecorder.getRegionCount() >= MAX_REGIONS && slot === undefined) {
    setLastError(`loop recorder: уже ${MAX_REGIONS} регионов, удалите или выберите slot`);
    return;
  }
  const ctx = await getActiveAudioContext();
  if (!ctx) return;
  try {
    const handle = await loopRecorder.punchIn(ctx, slot !== undefined ? { slot } : {});
    activeHandle = handle;
    activeSlot = slot ?? loopRecorder.getRegionCount() + 1;
    setRecordingSlot(activeSlot);
    setRecording(true);
    setLastError(null);
  } catch (err) {
    setLastError(`не удалось стартовать запись: ${errMessage(err)}`);
  }
};

const stopRecording = async (): Promise<void> => {
  const handle = activeHandle;
  if (!handle || !recording()) {
    setLastError('нет активной записи');
    return;
  }
  if (activeSlot === null) {
    setLastError('internal: activeSlot missing');
    return;
  }
  try {
    const result = await handle.stop();
    loopRecorder.addRegion({
      blob: result.blob,
      startMs: 0,
    });
    refreshRegions();
    setLastError(null);
  } catch (err) {
    setLastError(`не удалось остановить запись: ${errMessage(err)}`);
  } finally {
    activeHandle = null;
    activeSlot = null;
    setRecording(false);
    setRecordingSlot(null);
  }
};

const punchInForBeat = async (beat: number): Promise<void> => {
  if (recording()) {
    setLastError('уже идёт запись');
    return;
  }
  const ctx = await getActiveAudioContext();
  if (!ctx) return;
  const beatMs = LoopRecorder.beatToMs(beat);
  try {
    const handle = await loopRecorder.punchIn(ctx, { beatMs });
    activeHandle = handle;
    activeSlot = loopRecorder.getRegionCount() + 1;
    setRecordingSlot(activeSlot);
    setRecording(true);
    setLastError(null);
  } catch (err) {
    setLastError(`punch-in не удался: ${errMessage(err)}`);
  }
};

const playRegionById = async (id: string): Promise<void> => {
  const ctx = await getActiveAudioContext();
  if (!ctx) return;
  try {
    await loopRecorder.playRegion(id, ctx);
  } catch (err) {
    setLastError(`воспроизведение региона не удалось: ${errMessage(err)}`);
  }
};

const removeRegionById = (id: string): void => {
  loopRecorder.removeRegion(id);
  refreshRegions();
};

const clearRegions = (): void => {
  loopRecorder.clearAllRegions();
  refreshRegions();
};

const updatePlaybackMode = (mode: PlaybackMode): void => {
  setPlaybackModeSig(mode);
};

const exportMixDown = async (): Promise<Blob | null> => {
  const ctx = await getActiveAudioContext();
  if (!ctx) return null;
  if (loopRecorder.getRegionCount() === 0) {
    setLastError('mix-down: нет регионов');
    return null;
  }
  try {
    const blob = await loopRecorder.mixDownRegions(ctx);
    setLastError(null);
    return blob;
  } catch (err) {
    setLastError(`mix-down не удался: ${errMessage(err)}`);
    return null;
  }
};

export const recorderStore: RecorderStoreState & RecorderStoreActions = {
  regions,
  regionCount: () => loopRecorder.getRegionCount(),
  recording,
  recordingSlot,
  playbackMode,
  lastError,
  startRecording,
  stopRecording,
  punchIn: punchInForBeat,
  playRegion: playRegionById,
  removeRegion: removeRegionById,
  clearRegions,
  setPlaybackMode: updatePlaybackMode,
  exportMixDown,
};

/**
 * Re-export типов для удобства: презентационные компоненты могут
 * импортировать `Region`, `RegionColor` из recorderStore.
 */
export type { Region, RegionColor };
