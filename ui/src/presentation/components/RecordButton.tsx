import { Show, createSignal, onCleanup, createMemo } from 'solid-js';
import { Effect } from 'effect';
import { getActiveScore } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import type {
  LiveRecorderHandle,
  RecorderResult,
  RecorderState,
} from '~/infrastructure/audio/AudioRecorder';
import { takeFilename } from '~/infrastructure/audio/AudioRecorder';
import type { OfflineRenderProgress } from '~/infrastructure/audio/OfflineRender';

/**
 * RecordButton — UI для ⏺ Запись (live MediaRecorder) и 📼 Render offline.
 *
 * Layout:
 *   [⏺ Запись] [📼 Render offline]
 *
 * Live (⏺ Запись):
 *   toggle: первое нажатие — start(); второе — stop() → download blob.
 *   Состояние: idle / recording / stopping / error (в title и class).
 *   MIME detect через `MediaRecorder.isTypeSupported()`; UI показывает
 *   какой mime выбран ("webm/opus", "m4a", "ogg/opus") в title.
 *
 * Offline (📼 Render offline):
 *   открывает модалку с input «cycles» (1–32, default 4) и кнопкой
 *   «Рендер». Chunked progress (0–1) через setTimeout-yield + RAF-цикл,
 *   отображается в progress bar. На done — автодаунлоад .wav.
 *
 * iOS Safari limitation (см. packet.notes):
 *   - background-suspend → AudioContext.suspended → MediaRecorder
 *     теряет track → запись в фоне молча умирает.
 *   - iOS Safari поддерживает только audio/mp4 (.m4a) — другие mime
 *     не доступны, переключаем расширение.
 */

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

const humanStage = (stage: OfflineRenderProgress['stage']): string => {
  switch (stage) {
    case 'compiling': return 'компиляция';
    case 'rendering': return 'рендер';
    case 'encoding': return 'кодирование WAV';
    case 'done': return 'готово';
  }
};

export function RecordButton() {
  const [recorder, setRecorder] = createSignal<LiveRecorderHandle | null>(null);
  const [recState, setRecState] = createSignal<RecorderState>('idle');
  const [recError, setRecError] = createSignal<string | null>(null);
  const [recExt, setRecExt] = createSignal<'webm' | 'm4a' | 'ogg' | null>(null);
  const [recElapsed, setRecElapsed] = createSignal(0);
  const [modalOpen, setModalOpen] = createSignal(false);
  const [renderCycles, setRenderCycles] = createSignal(4);
  const [renderProgress, setRenderProgress] = createSignal<OfflineRenderProgress>({
    progress: 0,
    stage: 'compiling',
  });
  const [renderBusy, setRenderBusy] = createSignal(false);
  const [renderError, setRenderError] = createSignal<string | null>(null);

  let tickId: number | undefined;

  const stopTicker = (): void => {
    if (tickId !== undefined) {
      window.clearInterval(tickId);
      tickId = undefined;
    }
  };

  const startTicker = (): void => {
    if (tickId !== undefined) return;
    const t0 = Date.now();
    tickId = window.setInterval(() => {
      setRecElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 250);
  };

  onCleanup(() => {
    stopTicker();
    const r = recorder();
    r?.dispose();
  });

  const handleRecordToggle = async (): Promise<void> => {
    setRecError(null);
    const cur = recorder();
    if (cur && recState() === 'recording') {
      try {
        setRecState('stopping');
        stopTicker();
        const result: RecorderResult = await cur.stop();
        downloadBlob(result.blob, takeFilename(result.ext));
        setRecState('idle');
      } catch (err) {
        setRecError(err instanceof Error ? err.message : String(err));
        setRecState('error');
      } finally {
        setRecElapsed(0);
      }
      return;
    }

    if (cur) {
      // Reusing after stop — call start again
      try {
        setRecState('idle');
        cur.start();
        setRecState('recording');
        setRecExt(cur.getMime().ext);
        startTicker();
      } catch (err) {
        setRecError(err instanceof Error ? err.message : String(err));
        setRecState('error');
      }
      return;
    }

    try {
      const handle = await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          return yield* audio.recordLive();
        }).pipe(Effect.provide(AppLayer)),
      );
      setRecorder(handle);
      setRecExt(handle.getMime().ext);
      handle.start();
      setRecState('recording');
      startTicker();
    } catch (err) {
      setRecError(err instanceof Error ? err.message : String(err));
      setRecState('error');
    }
  };

  const handleRenderClick = (): void => {
    setModalOpen(true);
    setRenderError(null);
    setRenderProgress({ progress: 0, stage: 'compiling' });
  };

  const closeModal = (): void => {
    if (renderBusy()) return;
    setModalOpen(false);
    setRenderError(null);
    setRenderProgress({ progress: 0, stage: 'compiling' });
  };

  const handleRenderStart = async (): Promise<void> => {
    if (renderBusy()) return;
    setRenderBusy(true);
    setRenderError(null);
    setRenderProgress({ progress: 0, stage: 'compiling' });
    // Читаем сигналы вне Effect.gen, чтобы solid-js видел tracking.
    const cycles = renderCycles();
    const score = getActiveScore();
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          return yield* audio.renderOffline(
            score,
            { cycles },
            {
              onProgress: (p) => setRenderProgress(p),
            },
          );
        }).pipe(Effect.provide(AppLayer)),
      );
      downloadBlob(result.blob, takeFilename('wav'));
      setRenderProgress({ progress: 1, stage: 'done' });
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenderBusy(false);
    }
  };

  const recordLabel = createMemo(() => {
    switch (recState()) {
      case 'idle': return '⏺ Запись';
      case 'recording': return `⏹ Стоп · ${recElapsed()}с · .${recExt()}`;
      case 'stopping': return '⏳ Стоп…';
      case 'error': return '⏺ Запись (ошибка)';
    }
  });

  const recordClass = createMemo(() => {
    const state = recState();
    if (state === 'recording') return 'ctrl-btn ctrl-btn-record recording';
    if (state === 'stopping') return 'ctrl-btn ctrl-btn-record stopping';
    if (state === 'error') return 'ctrl-btn ctrl-btn-record error';
    return 'ctrl-btn ctrl-btn-record';
  });

  const mimeSupport = createMemo(() => {
    if (typeof MediaRecorder === 'undefined') return 'нет';
    return recExt() ?? 'определяется';
  });

  return (
    <>
      <button
        type="button"
        class={recordClass()}
        onClick={() => void handleRecordToggle()}
        disabled={recState() === 'stopping'}
        title={`Live MediaRecorder (${mimeSupport()}) — lossy, draft-quality. iOS Safari → .m4a, Chrome → .webm, Firefox → .ogg`}
        data-state={recState()}
      >
        {recordLabel()}
      </button>
      <button
        type="button"
        class="ctrl-btn"
        onClick={handleRenderClick}
        title="Render current score to WAV via OfflineAudioContext (lossless, chunked)"
      >
        📼 Render offline
      </button>

      <Show when={recError()}>
        <div class="record-err">{recError()}</div>
      </Show>

      <Show when={modalOpen()}>
        <div class="record-modal-backdrop" onClick={closeModal}>
          <div class="record-modal" onClick={(e) => e.stopPropagation()}>
            <div class="record-modal-title">Render offline → WAV</div>
            <div class="record-modal-row">
              <label class="record-modal-label">Циклов:</label>
              <input
                type="number"
                min="1"
                max="32"
                value={renderCycles()}
                disabled={renderBusy()}
                onInput={(e) =>
                  setRenderCycles(Math.max(1, Math.min(32, +e.currentTarget.value || 4)))
                }
                class="record-modal-input"
              />
              <span class="record-modal-hint">
                ~{(renderCycles() / 0.5).toFixed(1)} сек @ cps=0.5
              </span>
            </div>
            <div class="record-modal-progress">
              <div class="record-modal-progress-bar">
                <div
                  class="record-modal-progress-fill"
                  style={{ width: `${Math.round(renderProgress().progress * 100)}%` }}
                />
              </div>
              <div class="record-modal-progress-text">
                {humanStage(renderProgress().stage)} · {Math.round(renderProgress().progress * 100)}%
              </div>
            </div>
            <Show when={renderError()}>
              <div class="record-modal-err">{renderError()}</div>
            </Show>
            <div class="record-modal-actions">
              <button type="button" onClick={closeModal} disabled={renderBusy()}>
                Отмена
              </button>
              <button
                type="button"
                class="ctrl-btn-primary"
                onClick={() => void handleRenderStart()}
                disabled={renderBusy() || !getActiveScore().trim()}
              >
                {renderBusy() ? 'Рендер…' : '▶ Рендер'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}

// Re-export helper для unit-тестов UI (если потребуется).
export const _testHelpers = { humanStage };