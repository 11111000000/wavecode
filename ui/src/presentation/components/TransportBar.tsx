import {
  Show, For, createSignal, createEffect, onMount, onCleanup,
  untrack, type JSX,
} from 'solid-js';
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
import { allPresets } from '~/presentation/state/presetsStore';
import { PlayIcon, StopIcon } from '~/presentation/icons';

const STORAGE_KEY = 'wavecode-mobile-transport-expanded-v1';

const CPS_MIN = 0.05;
const CPS_MAX = 2.0;
const CPS_STEP = 0.01;

const SWING_DIVISORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1/4', label: '1/4' },
  { value: '1/8', label: '1/8' },
  { value: '1/16', label: '1/16' },
  { value: '1/3', label: '1/3 (triplet)' },
];

const PRESET_CPS_LABELS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.25, label: '60' },
  { value: 0.5, label: '120' },
  { value: 1.0, label: '240' },
];

const formatBpm = (cpsValue: number): number => Math.round(60 * cpsValue * 2);
const formatCps = (cpsValue: number): string => cpsValue.toFixed(2);
const formatSwing = (s: number): string => s.toFixed(2);

const isMobileViewport = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(max-width: 720px)').matches;
};

const readStored = (): boolean | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return null;
};

const writeStored = (v: boolean): void => {
  try {
    localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false');
  } catch {
    /* ignore */
  }
};

const initialExpanded = (): boolean => {
  const stored = readStored();
  if (stored !== null) return stored;
  return !isMobileViewport();
};

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

export type TransportBarProps = {
  presetId: string;
  showSavePreset: boolean;
  newPresetName: string;
  audioRunning?: () => boolean;
  audioStarting?: () => boolean;
  onLoadPreset: (id: string) => void;
  onShowSavePreset: (v: boolean) => void;
  onNewPresetName: (v: string) => void;
  onSavePreset: () => void;
  onPlay?: () => void;
  onStop?: () => void;
};

export function TransportBar(props: TransportBarProps): JSX.Element {
  const audioRunning = (): boolean => props.audioRunning?.() ?? false;
  const audioStarting = (): boolean => props.audioStarting?.() ?? false;
  const handlePlay = (): void => { (props.onPlay ?? noop)(); };
  const handleStop = (): void => { (props.onStop ?? noop)(); };

  const [expanded, setExpanded] = createSignal<boolean>(initialExpanded());

  const toggleExpanded = (): void => {
    setExpanded((v) => {
      const next = !v;
      writeStored(next);
      return next;
    });
  };

  // Reflect collapsed state on .app-body so its padding-top can switch
  // via the data-transport-collapsed CSS rules (mobile @media only).
  // On desktop the attribute is also set, but desktop CSS uses the
  // legacy calc(--preset-row-h + --controls-h) formula (96px) which
  // matches the rendered bar height, so the attribute is a no-op
  // there.
  createEffect(() => {
    const appBody = document.querySelector<HTMLElement>('.app-body');
    if (!appBody) return;
    appBody.setAttribute('data-transport-collapsed', String(!expanded()));
  });

  const [localCps, setLocalCps] = createSignal(cps());
  let rafId: number | null = null;
  let playheadEl: HTMLDivElement | undefined;

  const sync = (): void => {
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

  const isMobile = (): boolean => untrack(isMobileViewport);

  return (
    <div
      class="app-transport-bar"
      data-collapsed={!expanded()}
      data-mobile={isMobile()}
      data-testid="transport-bar"
    >
      <div class="app-transport-bar__strip">
        <button
          type="button"
          class="transport-play-btn"
          data-tone={audioRunning() ? 'cyan' : 'primary'}
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

        <div class="app-transport-bar__preset">
          <select
            class="preset-select"
            value={props.presetId}
            onChange={(e) => props.onLoadPreset(e.currentTarget.value)}
            title="Готовые пресеты"
            aria-label="Выбор композиции"
            data-testid="preset-select"
          >
            <optgroup label="Встроенные">
              <For each={allPresets().filter((p) => !p.custom)}>
                {(p) => <option value={p.id}>{p.name}{p.artist ? ` · ${p.artist}` : ''}{p.lang === 'lisp' ? ' · (Lisp)' : ''}</option>}
              </For>
            </optgroup>
            <Show when={allPresets().some((p) => p.custom)}>
              <optgroup label="Мои">
                <For each={allPresets().filter((p) => p.custom)}>
                  {(p) => <option value={p.id}>⭐ {p.name}</option>}
                </For>
              </optgroup>
            </Show>
          </select>
        </div>

        <button
          type="button"
          class="app-transport-bar__toggle"
          data-testid="transport-bar-toggle"
          aria-expanded={expanded()}
          aria-controls="app-transport-bar-body"
          title={expanded() ? 'Свернуть панель' : 'Развернуть панель (BPM/свинг)'}
          onClick={toggleExpanded}
        >
          <span class="app-transport-bar__toggle-icon" aria-hidden="true">
            {expanded() ? '▲' : '▼'}
          </span>
          <span class="app-transport-bar__toggle-label">
            {expanded() ? 'Свернуть' : 'BPM'}
          </span>
        </button>
      </div>

      <div
        id="app-transport-bar-body"
        class="app-transport-bar__body"
        data-testid="transport-bar-body"
      >
        <div class="transport-panel" data-testid="transport-panel">
          <div class="bpm-indicator bpm-indicator--in-body" data-testid="bpm-indicator" title="60 × cps × 2 при 4/4">
            <strong>{formatBpm(localCps())}</strong>
            <span class="bpm-suffix">BPM</span>
          </div>

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
                data-testid="cps-slider"
              />
              <span class="cps-readout">{formatCps(localCps())}</span>
            </label>

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

        <Show when={props.showSavePreset}>
          <div class="save-preset-bar">
            <input
              type="text"
              placeholder="Имя пресета"
              value={props.newPresetName}
              onInput={(e) => props.onNewPresetName(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') props.onSavePreset(); }}
            />
            <button
              type="button"
              class="ctrl-btn ctrl-btn-primary"
              onClick={props.onSavePreset}
              disabled={!props.newPresetName.trim()}
            >
              OK
            </button>
            <button
              type="button"
              class="ctrl-btn"
              onClick={() => {
                props.onShowSavePreset(false);
                props.onNewPresetName('');
              }}
            >
              Отмена
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
