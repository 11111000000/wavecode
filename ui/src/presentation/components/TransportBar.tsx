import {
  For, createSignal, createEffect, onMount, onCleanup,
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
import { PlayIcon, StopIcon } from '~/presentation/icons';

/**
 * TransportBar — строка транспорта.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): строка transport
 * была девятью контролами в ряд — play, select композиций, кнопка
 * раскрытия, а в раскрытом виде ещё CPS-слайдер, свинг, три пресета
 * темпа и полоса сохранения пресета. По плану остаётся ОДНА строка:
 *
 *     ▶ · 120 BPM · 2.3 · (тонкая полоса позиции)
 *
 * Всё остальное (темп в циклах, свинг, пресеты темпа) — за раскрытием,
 * а выбор самой композиции уехал в лист «Инструменты»
 * (см. PresetPicker.tsx).
 *
 * Раскрытие по умолчанию ЗАКРЫТО на всех экранах: одна строка — это
 * и есть состояние покоя. Положение «раскрыто» помнится в
 * localStorage, чтобы решение пользователя не переигрывалось при
 * каждом релоаде.
 */

const STORAGE_KEY = 'wavecode-mobile-transport-expanded-v1';

const CPS_MIN = 0.05;
const CPS_MAX = 2.0;
const CPS_STEP = 0.01;

const SWING_DIVISORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1/4', label: '1/4' },
  { value: '1/8', label: '1/8' },
  { value: '1/16', label: '1/16' },
  { value: '1/3', label: '1/3 (триоли)' },
];

const PRESET_CPS_LABELS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.25, label: '60' },
  { value: 0.5, label: '120' },
  { value: 1.0, label: '240' },
];

const formatBpm = (cpsValue: number): number => Math.round(60 * cpsValue * 2);
const formatCps = (cpsValue: number): string => cpsValue.toFixed(2);
const formatSwing = (s: number): string => s.toFixed(2);

/**
 * Позиция внутри цикла: один цикл Strudel = один такт 4/4, поэтому
 * прогресс 0…1 раскладывается в «такт.доля» (1.1 … 1.4).
 */
const formatPosition = (progress: number): string => {
  const beats = progress * 4;
  const bar = Math.floor(beats) + 1;
  const beat = Math.floor((beats % 1) * 4) + 1;
  return `${bar}.${beat}`;
};

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

/**
 * Фаза 6: строка transport по умолчанию свёрнута на всех экранах.
 * Раньше на десктопе она раскрывалась сразу — и занимала треть
 * экрана слайдерами, которые никто не двигал.
 */
const initialExpanded = (): boolean => readStored() ?? false;

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
  audioRunning?: () => boolean;
  audioStarting?: () => boolean;
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
  // via the data-transport-collapsed CSS rules. Desktop and mobile
  // both read the same two tokens now: expanded = 108px (the rendered
  // height of this bar), collapsed = 48px (strip only).
  createEffect(() => {
    const appBody = document.querySelector<HTMLElement>('.app-body');
    if (!appBody) return;
    appBody.setAttribute('data-transport-collapsed', String(!expanded()));
  });

  const [localCps, setLocalCps] = createSignal(cps());
  const [position, setPosition] = createSignal('1.1');
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
  let lastPosWrite = 0;
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
    // Позиция — текст, её незачем обновлять 60 раз в секунду: десяти
    // раз в секунду хватает, чтобы цифра читалась как живая.
    if (now - lastPosWrite >= 100) {
      lastPosWrite = now;
      void readProgress().then((p) => {
        const clamped = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
        const next = formatPosition(clamped);
        setPosition((prev) => (prev === next ? prev : next));
      });
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
          data-tour="play"
          aria-label={audioRunning() ? 'Стоп' : 'Запуск'}
          aria-pressed={audioRunning()}
          aria-busy={!audioRunning() && audioStarting()}
          disabled={!audioRunning() && audioStarting()}
          data-testid="transport-play-btn"
          title={audioRunning() ? 'Стоп' : 'Запуск'}
          onClick={() => { if (audioRunning()) handleStop(); else handlePlay(); }}
        >
          {audioRunning() ? <StopIcon size={16} /> : <PlayIcon size={16} />}
        </button>

        {/* Темп и позиция — показания, а не кнопки: строка транспорта
            это «play · темп · позиция», и лишних интерактивных
            регионов в ней быть не должно. Настройки темпа — за
            раскрытием (кнопка «▼ Темп»). */}
        <span
          class="app-transport-bar__bpm"
          data-testid="transport-bpm"
          title="Темп"
        >
          <strong>{formatBpm(localCps())}</strong>
          <span class="bpm-suffix">BPM</span>
        </span>

        <span
          class="app-transport-bar__position"
          data-testid="transport-position"
          title="Позиция в такте"
          aria-label={`Позиция ${position()}`}
        >
          {position()}
        </span>

        <div class="playhead-track" aria-hidden="true">
          <div class="playhead" ref={(el) => (playheadEl = el)} style={{ '--playhead-x': '0%' }} />
        </div>

        <button
          type="button"
          class="app-transport-bar__toggle"
          data-testid="transport-bar-toggle"
          aria-expanded={expanded()}
          aria-controls="app-transport-bar-body"
          title={expanded() ? 'Свернуть настройки' : 'Настройки темпа'}
          onClick={toggleExpanded}
        >
          <span class="app-transport-bar__toggle-icon" aria-hidden="true">
            {expanded() ? '▲' : '▼'}
          </span>
          <span class="app-transport-bar__toggle-label">
            {expanded() ? 'Свернуть' : 'Темп'}
          </span>
        </button>
      </div>

      <div
        id="app-transport-bar-body"
        class="app-transport-bar__body"
        data-testid="transport-bar-body"
      >
        <div class="transport-panel" data-testid="transport-panel">
          <div class="transport-controls">
            <label class="cps-control">
              <span class="cps-label">темп, циклов/с</span>
              <input
                type="range"
                min={CPS_MIN}
                max={CPS_MAX}
                step={CPS_STEP}
                value={localCps()}
                onInput={onSliderInput}
                title="Циклы в секунду (0.05 — 2.0)"
                aria-label="Темп в циклах в секунду"
                data-testid="cps-slider"
              />
              <span class="cps-readout">{formatCps(localCps())}</span>
            </label>

            <div class="swing-control" data-testid="swing-control">
              <span class="swing-label">свинг</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={swingAmount()}
                onInput={onSwingSlider}
                class="swing-slider"
                title="Свинг: 0 — ровно, 1 — максимум"
                aria-label="Свинг"
                data-testid="swing-slider"
              />
              <span class="swing-readout" data-testid="swing-readout">{formatSwing(swingAmount())}</span>
              <select
                class="swing-divisor"
                value={swingDivisor()}
                onChange={onDivisorChange}
                title="Делитель свинга"
                aria-label="Делитель свинга"
                data-testid="swing-divisor"
              >
                <For each={SWING_DIVISORS}>
                  {(d) => <option value={d.value}>{d.label}</option>}
                </For>
              </select>
            </div>

            <div class="cps-presets" role="group" aria-label="Готовый темп">
              <For each={PRESET_CPS_LABELS}>
                {(p) => (
                  <button
                    type="button"
                    class="cps-preset-btn"
                    onClick={() => onPresetClick(p.value)}
                    title={`${p.label} BPM`}
                  >
                    {p.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
