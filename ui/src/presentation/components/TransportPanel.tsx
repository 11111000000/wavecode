import { createSignal, onCleanup, onMount, For, type JSX } from 'solid-js';
import { Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import {
  cps,
  setCpsLocal,
  swingAmount,
  swingDivisor,
  setSwingAmountLocal,
  setSwingDivisorLocal,
} from '~/presentation/state/transportState';
import { PlayIcon, StopIcon } from '~/presentation/icons';

const CPS_MIN = 0.05;
const CPS_MAX = 2.0;
const CPS_STEP = 0.01;
const CPS_DEFAULT = 0.5;

const SWING_DIVISORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1/4', label: '1/4' },
  { value: '1/8', label: '1/8' },
  { value: '1/16', label: '1/16' },
  { value: '1/3', label: '1/3 (triplet)' },
];

const formatBpm = (cpsValue: number): number => Math.round(60 * cpsValue * 2);
const formatCps = (cpsValue: number): string => cpsValue.toFixed(2);
const formatSwing = (s: number): string => s.toFixed(2);

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

const noop = (): void => undefined;

export type TransportPanelProps = {
  audioRunning?: () => boolean;
  audioStarting?: () => boolean;
  onPlay?: () => void;
  onStop?: () => void;
};

export function TransportPanel(props: TransportPanelProps = {}): JSX.Element {
  const audioRunning = (): boolean => props.audioRunning?.() ?? false;
  const audioStarting = (): boolean => props.audioStarting?.() ?? false;
  const handlePlay = (): void => { (props.onPlay ?? noop)(); };
  const handleStop = (): void => { (props.onStop ?? noop)(); };

  const [localCps, setLocalCps] = createSignal(cps());
  let rafId: number | null = null;
  let playheadEl: HTMLDivElement | undefined;

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

  const onSwingSlider = (event: Event & { currentTarget: HTMLInputElement }): void => {
    const next = Number.parseFloat(event.currentTarget.value);
    if (!Number.isFinite(next)) return;
    setSwingAmountLocal(next);
  };

  const onDivisorChange = (event: Event & { currentTarget: HTMLSelectElement }): void => {
    setSwingDivisorLocal(event.currentTarget.value);
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
        <button
          type="button"
          class="transport-play-btn"
          data-tone={audioRunning() ? 'cyan' : 'amber'}
          data-state={audioRunning() ? 'stop' : 'play'}
          aria-label={audioRunning() ? 'Стоп' : 'Запуск'}
          aria-pressed={audioRunning()}
          aria-busy={!audioRunning() && audioStarting()}
          disabled={!audioRunning() && audioStarting()}
          data-testid="transport-play-btn"
          title={audioRunning() ? 'Стоп (running)' : 'Запуск (play)'}
          onClick={() => { if (audioRunning()) handleStop(); else handlePlay(); }}
        >
          {audioRunning() ? <StopIcon size={16} /> : <PlayIcon size={16} />}
        </button>

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

        <div class="swing-control" data-testid="swing-control">
          <span class="swing-label">swing</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={swingAmount()}
            onInput={onSwingSlider}
            class="swing-slider"
            title="Swing amount: 0=off, 1=max shuffle"
            aria-label="Swing amount"
            data-testid="swing-slider"
          />
          <span class="swing-readout" data-testid="swing-readout">{formatSwing(swingAmount())}</span>
          <select
            class="swing-divisor"
            value={swingDivisor()}
            onChange={onDivisorChange}
            title="Swing divisor (Strudel .swing amount, divisor)"
            aria-label="Swing divisor"
            data-testid="swing-divisor"
          >
            <For each={SWING_DIVISORS}>
              {(d) => <option value={d.value}>{d.label}</option>}
            </For>
          </select>
        </div>

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

export const CPS_PRESET_DEFAULT = CPS_DEFAULT;
