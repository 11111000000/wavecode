import { createSignal, onCleanup, onMount, For } from 'solid-js';
import { Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import {
  cps,
  setCpsLocal,
  swing,
  toggleSwingLocal,
} from '~/presentation/state/transportState';

/**
 * TransportPanel — CPS-слайдер, BPM-индикатор, swing toggle и playhead.
 *
 * Layout (slim, 28px tall, помещается в `.app-controls-row`):
 *
 *   ┌── .transport-panel ──────────────────────────────┐
 *   │ CPS [slider]   120 BPM   [Swing]  ▮▮▮░░░░░░░░░░  │
 *   └──────────────────────────────────────────────────┘
 *
 * BPM = 60 · cps · 2 при 4/4 — это UX-проекция, не параметр runtime.
 * Swing toggle пишет в transportState (через reducer), но НЕ в score —
 * переключение применяется через evalWithTransport на лету при следующем eval.
 *
 * Playhead — узкая полоска (height 2px), absolute, читает
 * `AudioEngine.getCycleProgress()` через RAF и применяет transform.
 * Не вызывает re-render компонента — только DOM-mutation.
 */

const CPS_MIN = 0.05;
const CPS_MAX = 2.0;
const CPS_STEP = 0.01;
const CPS_DEFAULT = 0.5;

const formatBpm = (cpsValue: number): number => Math.round(60 * cpsValue * 2);

const formatCps = (cpsValue: number): string => cpsValue.toFixed(2);

const PRESET_CPS_LABELS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.25, label: '60' },
  { value: 0.5, label: '120' },
  { value: 1.0, label: '240' },
];

const readProgress = async (): Promise<number> => {
  try {
    return await Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        return yield* audio.getCycleProgress();
      }).pipe(Effect.provide(AppLayer)),
    );
  } catch {
    return 0;
  }
};

export function TransportPanel() {
  const [localCps, setLocalCps] = createSignal(cps());
  let rafId: number | null = null;
  let playheadEl: HTMLDivElement | undefined;

  // Keep slider thumb synced when transport state changes externally
  // (например, при load preset, или если кто-то меняет store напрямую).
  const sync = () => {
    const storeCps = cps();
    if (Math.abs(storeCps - localCps()) > 1e-9) setLocalCps(storeCps);
  };

  const onSliderInput = (event: Event & { currentTarget: HTMLInputElement }): void => {
    const next = Number.parseFloat(event.currentTarget.value);
    if (!Number.isFinite(next)) return;
    setLocalCps(next);
    setCpsLocal(next);
  };

  const onPresetClick = (value: number): void => {
    setLocalCps(value);
    setCpsLocal(value);
  };

  onMount(() => {
    rafId = requestAnimationFrame(loop);
  });

  onCleanup(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });

  let lastWrite = 0;
  const loop = (): void => {
    const now = performance.now();
    if (now - lastWrite >= 14) {
      lastWrite = now;
      if (playheadEl) {
        // RAF без await DOM-мутации — async-free, минимум 60Hz апается.
        void readProgress().then((p) => {
          if (playheadEl) {
            const clamped = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
            playheadEl.style.setProperty('--playhead-x', `${clamped * 100}%`);
          }
        });
      }
    }
    sync();
    rafId = requestAnimationFrame(loop);
  };

  return (
    <div class="transport-panel" data-testid="transport-panel">
      <div class="transport-controls">
        <label class="cps-control">
          <span class="cps-label">cps</span>
          <input
            type="range"
            min={CPS_MIN}
            max={CPS_MAX}
            step={CPS_STEP}
            value={localCps()}
            onInput={onSliderInput}
            title="cycles per second (0.05 — 2.0)"
            aria-label="CPS"
          />
          <span class="cps-readout">{formatCps(localCps())}</span>
        </label>

        <span class="bpm-indicator" data-testid="bpm-indicator" title="60 × cps × 2 при 4/4">
          <strong>{formatBpm(localCps())}</strong>
          <span class="bpm-suffix">BPM</span>
        </span>

        <button
          type="button"
          class="swing-btn"
          classList={{ 'swing-btn-on': swing() }}
          onClick={() => toggleSwingLocal()}
          title={swing() ? 'Swing ON (.swing(0.5, 1/3))' : 'Swing OFF'}
          aria-pressed={swing()}
          data-testid="swing-btn"
        >
          swing
        </button>

        <div class="cps-presets" role="group" aria-label="CPS presets">
          <For each={PRESET_CPS_LABELS}>
            {(p) => (
              <button
                type="button"
                class="cps-preset-btn"
                onClick={() => onPresetClick(p.value)}
                title={`cps ${p.value} (${p.label} BPM)`}
              >
                {p.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="playhead-track" aria-hidden="true">
        <div class="playhead" ref={(el) => (playheadEl = el)} style={{ '--playhead-x': '0%' }} />
      </div>
    </div>
  );
}

// Re-export DEFAULT for testability + dev only.
export const CPS_PRESET_DEFAULT = CPS_DEFAULT;
