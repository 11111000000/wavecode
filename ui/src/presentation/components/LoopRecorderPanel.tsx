import { For, Show, createSignal, type JSX } from 'solid-js';
import { recorderStore } from '../state/recorderStore';
import {
  LoopRecorder,
  MAX_REGIONS,
  type Region,
  type RegionColor,
} from '~/infrastructure/audio/LoopRecorder';
import { takeFilename } from '~/infrastructure/audio/AudioRecorder';

/**
 * LoopRecorderPanel — Boss RC-505-style UI для multi-track loop recorder.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  ⏺ Loop recorder                            [Mix → WAV] [✕] │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ [▣ 1 · green] [▣ 2 · cyan] [▣ 3 · magenta] [▣ 4 · violet]  │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ Timeline (0 ──── 4 beats)        [⏺ REC] [⏹ STOP]          │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ Counter: 2/4 regions · status line                          │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Каждый slot:
 *   - data-color="green|cyan|magenta|violet" → CSS задаёт цвет.
 *   - click — play this region (если есть) / start recording (если пустой).
 *   - Shift+click — удалить регион.
 *   - Status pill: empty / recording / playing / has-region.
 *
 * Timeline:
 *   - 4 beat-markers (0/1/2/3). Click на маркер — старт записи
 *     в нужной точке цикла (punch-in).
 *
 * Mix → WAV кнопка:
 *   - вызывает recorderStore.exportMixDown().
 *   - пусто / error path → disabled или показ ошибки.
 *
 * Кнопка Clear all:
 *   - удаляет все регионы (защита через prompt не нужна — UI ясно).
 *
 * LiveRecorder / takeFilename / wavEncoder — все через recorderStore,
 * Web Audio API скрыт в LoopRecorder. Старая RecordButton сохранена
 * для backward-compat (single-shot fallback).
 */

const COLORS: ReadonlyArray<RegionColor> = ['green', 'cyan', 'magenta', 'violet'];

const BEATS = [0, 1, 2, 3] as const;

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

type SlotStatus = 'empty' | 'recording' | 'has-region';

const slotStatus = (region: Region | undefined, recordingSlot: number | null, slotIdx: number): SlotStatus => {
  if (recordingSlot !== null && slotIdx === recordingSlot - 1) return 'recording';
  if (region) return 'has-region';
  return 'empty';
};

const slotStatusLabel = (status: SlotStatus): string => {
  switch (status) {
    case 'empty': return 'empty';
    case 'recording': return '● rec';
    case 'has-region': return '▶ play';
  }
};

export function LoopRecorderPanel(): JSX.Element {
  const [hoveredBeat, setHoveredBeat] = createSignal<number | null>(null);

  const handleSlotClick = async (
    region: Region | undefined,
    slotIdx: number,
    ev: MouseEvent & { shiftKey: boolean },
  ): Promise<void> => {
    if (ev.shiftKey && region) {
      recorderStore.removeRegion(region.id);
      return;
    }
    if (region) {
      await recorderStore.playRegion(region.id);
      return;
    }
    // empty slot → start recording в этот slot (1-based)
    await recorderStore.startRecording(slotIdx + 1);
  };

  const handleStop = (): void => {
    void recorderStore.stopRecording();
  };

  const handleBeatClick = (beat: number): void => {
    void recorderStore.punchIn(beat);
  };

  const handleMixDown = async (): Promise<void> => {
    const blob = await recorderStore.exportMixDown();
    if (!blob) return;
    downloadBlob(blob, takeFilename('wav'));
  };

  const handleClearAll = (): void => {
    recorderStore.clearRegions();
  };

  return (
    <div class="loop-recorder">
      <div class="loop-recorder-header">
        <span class="loop-recorder-title">⏺ Loop recorder</span>
        <div class="loop-recounter-stats">
          <span class="loop-recounter-count">{recorderStore.regionCount()}/{MAX_REGIONS} regions</span>
          <Show when={recorderStore.recording()}>
            <span class="loop-recounter-pill">● recording slot {recorderStore.recordingSlot()}</span>
          </Show>
        </div>
        <div class="loop-recorder-actions">
          <button
            type="button"
            class="ctrl-btn ctrl-btn-primary"
            disabled={recorderStore.regionCount() === 0}
            onClick={() => void handleMixDown()}
            title="Mix down all regions to a single 16-bit PCM WAV via OfflineAudioContext"
          >
            🎛 Mix → WAV
          </button>
          <button
            type="button"
            class="ctrl-btn"
            onClick={handleClearAll}
            disabled={recorderStore.regionCount() === 0}
            title="Delete all regions"
          >
            ✕ Clear
          </button>
        </div>
      </div>

      <div class="loop-slot-row">
        <For each={COLORS}>
          {(color, idx) => {
            const region = (): Region | undefined => recorderStore.regions()[idx()];
            const status = (): SlotStatus =>
              slotStatus(region(), recorderStore.recordingSlot(), idx());
            return (
              <button
                type="button"
                class="loop-slot"
                data-color={color}
                data-status={status()}
                data-empty={region() === undefined}
                onClick={(ev) => void handleSlotClick(region(), idx(), ev)}
                title={
                  region()
                    ? `Tap to play · Shift+click to delete (${region()?.id})`
                    : 'Tap to start recording into this slot'
                }
              >
                <span class="loop-slot-index">{idx() + 1}</span>
                <span class="loop-slot-status">{slotStatusLabel(status())}</span>
                <Show when={region()}>
                  <span class="loop-slot-bar"><span class="loop-slot-bar-fill" /></span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>

      <div class="loop-timeline">
        <span class="loop-timeline-label">Punch-in (beats)</span>
        <div class="loop-timeline-strip">
          <For each={BEATS}>
            {(beat) => (
              <button
                type="button"
                class="loop-timeline-beat"
                data-active={hoveredBeat() === beat}
                onMouseEnter={() => setHoveredBeat(beat)}
                onMouseLeave={() => setHoveredBeat(null)}
                onClick={() => handleBeatClick(beat)}
                title={`Punch-in at beat ${beat} (${LoopRecorder.beatToMs(beat)}ms @ cps=0.5)`}
              >
                {beat}
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          class="ctrl-btn ctrl-btn-record"
          disabled={!recorderStore.recording()}
          onClick={handleStop}
          title="Stop current recording and commit to its slot"
        >
          ⏹ Stop
        </button>
      </div>

      <Show when={recorderStore.lastError()}>
        <div class="loop-err">{recorderStore.lastError()}</div>
      </Show>
    </div>
  );
}
