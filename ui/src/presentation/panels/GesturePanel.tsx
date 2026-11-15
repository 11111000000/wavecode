import { For, Show, createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import {
  GESTURE_CURVE_OPTIONS,
  GESTURE_PARAM_OPTIONS,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  calibrateFar,
  calibrateNear,
  clearGestureTermHits,
  commitTermPattern,
  gestureActive,
  gestureAxes,
  gestureCalibrationState,
  gestureEnabled,
  gestureError,
  gestureFeatures,
  gestureLandmarks,
  gestureLiveValues,
  gestureSensitivity,
  gestureStatus,
  gestureStatusLabel,
  gestureTermHits,
  gestureTermMode,
  gestureTwoHands,
  resetCalibration,
  setGestureAxisCurve,
  setGestureAxisInvert,
  setGestureAxisParam,
  setGestureSensitivity,
  setGestureTermMode,
  setGestureTwoHands,
  setGestureVideoElement,
  toggleGestureControl,
  type GestureAxisConfig,
  type GestureCurve,
} from '../state/gestureStore';
import type { ContinuousParam, Landmark } from '~/domain/gesture/types';

/**
 * GesturePanel — «управление руками» (hand-gesture control).
 *
 * The panel is the ONLY place that starts the camera: the master toggle
 * calls `toggleGestureControl()`, which is the first `getUserMedia` /
 * permission prompt of the session. Nothing here touches the tracker
 * directly — the store owns the capture, the filtering and the mapping.
 *
 * Layout (mobile-first, one column, same visual language as `MicPanel`):
 *
 *   row 1 — master toggle + status pill (+ error banner)
 *   row 2 — camera preview (video + landmark overlay) + gesture badge
 *   row 3 — axis list (parameter / invert / curve) + sensitivity slider
 *   row 4 — calibration («близко» / «далеко» / «сброс»)
 *   row 5 — «две руки» + «режим терминовки» + «готово» (commit the rhythm)
 *
 * Accessibility: every control is a real `<button>`, `<input>` or `<select>`
 * with a label — no click handlers on `<div>`s, everything keyboard reachable.
 */

/**
 * MediaPipe hand topology — the connections between the 21 landmarks.
 * Used to draw the hand outline over the camera preview.
 */
const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Draw the 21 landmarks + the hand outline on the overlay canvas. */
const drawHand = (
  canvas: HTMLCanvasElement | undefined,
  landmarks: ReadonlyArray<Landmark> | null,
): void => {
  if (canvas === undefined) return;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    // jsdom has no 2D context — the overlay is simply not drawn.
    ctx = null;
  }
  if (ctx === null) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (landmarks === null || landmarks.length === 0) return;

  const px = (index: number): number => {
    const lm = landmarks[index];
    if (lm === undefined) return 0;
    return lm.x * width;
  };
  const py = (index: number): number => {
    const lm = landmarks[index];
    if (lm === undefined) return 0;
    return lm.y * height;
  };

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(94, 234, 212, 0.85)';
  ctx.beginPath();
  for (const [from, to] of HAND_CONNECTIONS) {
    ctx.moveTo(px(from), py(from));
    ctx.lineTo(px(to), py(to));
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(167, 139, 250, 0.95)';
  for (let i = 0; i < landmarks.length; i += 1) {
    ctx.beginPath();
    ctx.arc(px(i), py(i), 3, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Label of a continuous parameter (Russian, short enough for a <select>). */
const PARAM_LABEL: Readonly<Record<ContinuousParam, string>> = {
  pitch: 'высота',
  volume: 'громкость',
  pan: 'панорама',
  cutoff: 'фильтр',
  room: 'ревер',
  speed: 'скорость',
};

/** Label of the response curve. */
const CURVE_LABEL: Readonly<Record<GestureCurve, string>> = {
  linear: 'линейная',
  log: 'лог',
  exp: 'экспонента',
};

/**
 * Which hand feature drives each parameter — mirrors the `featureForParam`
 * table of `domain/gesture/mapping.ts`. It is only a UI hint: the mapping
 * itself lives in the domain.
 */
const PARAM_SOURCE: Readonly<Record<ContinuousParam, string>> = {
  pitch: 'высота ладони',
  volume: 'раскрытие',
  pan: 'позиция X',
  cutoff: 'близость',
  room: 'близость',
  speed: 'наклон',
};

export function GesturePanel(): JSX.Element {
  let videoRef: HTMLVideoElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;

  onMount(() => {
    // Hand the preview element to the store so the capture can stream into
    // it. (The capture may also create its own element — the panel simply
    // renders whatever the handle exposes.)
    setGestureVideoElement(videoRef ?? null);
  });

  onCleanup(() => {
    setGestureVideoElement(null);
  });

  // Redraw the overlay whenever a new frame arrives.
  createEffect(() => {
    const landmarks = gestureLandmarks();
    drawHand(canvasRef, landmarks);
  });

  const onToggle = (): void => {
    void toggleGestureControl();
  };

  const onAxisParam = (index: number, value: string): void => {
    if (value === 'off') {
      setGestureAxisParam(index, null);
      return;
    }
    setGestureAxisParam(index, value as ContinuousParam);
  };

  const onAxisCurve = (index: number, value: string): void => {
    setGestureAxisCurve(index, value as GestureCurve);
  };

  const axisParamValue = (axis: GestureAxisConfig): string => axis.param ?? 'off';

  const axisLabel = (axis: GestureAxisConfig): string =>
    axis.param === null ? 'выключено' : PARAM_LABEL[axis.param];

  const axisSource = (axis: GestureAxisConfig): string =>
    axis.param === null ? '—' : PARAM_SOURCE[axis.param];

  const liveValueText = (param: ContinuousParam | null): string => {
    if (param === null) return '—';
    const value = gestureLiveValues()[param];
    if (value === undefined) return '—';
    return value.toFixed(2);
  };

  return (
    <div
      class="gesture-panel"
      data-status={gestureStatus()}
      data-enabled={gestureEnabled() ? 'true' : 'false'}
      data-term-mode={gestureTermMode() ? 'true' : 'false'}
    >
      {/* ── row 1: master toggle + status ─────────────────────────────────── */}
      <div class="gesture-row-status">
        <button
          type="button"
          class="gesture-toggle"
          data-cta="toggle"
          aria-pressed={gestureEnabled()}
          aria-label="Управление руками — включить или выключить камеру"
          title={
            gestureEnabled()
              ? 'Выключить управление руками'
              : 'Включить управление руками (запрос камеры)'
          }
          onClick={onToggle}
        >
          <span aria-hidden="true">✋</span>
          <span class="gesture-toggle-label">Управление руками</span>
          <span class="gesture-toggle-state">
            {gestureEnabled() ? 'вкл' : 'выкл'}
          </span>
        </button>
        <span
          class="gesture-pill"
          data-status={gestureStatus()}
          role="status"
          aria-live="polite"
        >
          {gestureStatusLabel()}
        </span>
      </div>

      <Show when={gestureError() !== null}>
        <p class="gesture-error" role="alert">
          {gestureError()}
        </p>
      </Show>

      {/* ── row 2: camera preview ─────────────────────────────────────────── */}
      <div class="gesture-preview-wrap">
        <div class="gesture-preview">
          <video
            class="gesture-video"
            ref={videoRef}
            muted
            playsinline
            aria-label="Превью камеры"
          />
          <canvas
            class="gesture-overlay"
            ref={canvasRef}
            width={320}
            height={240}
            aria-hidden="true"
          />
          <Show when={gestureActive() !== null}>
            <span class="gesture-badge" data-gesture={gestureActive() ?? ''}>
              {gestureActive()}
            </span>
          </Show>
        </div>
        <div class="gesture-readout">
          <span class="gesture-readout-row">
            <span>жест</span>
            <span data-readout="gesture">{gestureActive() ?? '—'}</span>
          </span>
          <span class="gesture-readout-row">
            <span>близость</span>
            <span data-readout="closeness">
              {gestureFeatures() === null ? '—' : gestureFeatures()!.closeness.toFixed(2)}
            </span>
          </span>
          <span class="gesture-readout-row">
            <span>раскрытие</span>
            <span data-readout="openness">
              {gestureFeatures() === null ? '—' : gestureFeatures()!.openness.toFixed(2)}
            </span>
          </span>
          <For each={gestureAxes()}>
            {(axis) => (
              <Show when={axis.param !== null}>
                <span class="gesture-readout-row">
                  <span>{axisLabel(axis)}</span>
                  <span data-readout={`axis-${axis.param ?? 'off'}`}>
                    {liveValueText(axis.param)}
                  </span>
                </span>
              </Show>
            )}
          </For>
        </div>
      </div>

      {/* ── row 3: axis mapping + sensitivity ─────────────────────────────── */}
      <div class="gesture-axes">
        <div class="gesture-section-title">Оси управления</div>
        <For each={gestureAxes()}>
          {(axis, index) => (
            <div class="gesture-axis" data-axis={axis.param ?? 'off'}>
              <span class="gesture-axis-label">{axisLabel(axis)}</span>
              <span class="gesture-axis-source">{axisSource(axis)}</span>
              <label class="gesture-axis-select-wrap">
                <span class="gesture-axis-select-label">параметр</span>
                <select
                  class="gesture-axis-select"
                  data-axis-select={axis.param ?? 'off'}
                  value={axisParamValue(axis)}
                  onChange={(e) => onAxisParam(index(), e.currentTarget.value)}
                >
                  <option value="off">выключено</option>
                  <For each={GESTURE_PARAM_OPTIONS}>
                    {(param) => (
                      <option value={param}>{PARAM_LABEL[param]}</option>
                    )}
                  </For>
                </select>
              </label>
              <label class="gesture-axis-invert-wrap">
                <input
                  type="checkbox"
                  class="gesture-axis-invert"
                  data-axis-invert={axis.param ?? 'off'}
                  checked={axis.invert}
                  onChange={(e) => setGestureAxisInvert(index(), e.currentTarget.checked)}
                />
                <span>инверсия</span>
              </label>
              <label class="gesture-axis-curve-wrap">
                <span class="gesture-axis-curve-label">кривая</span>
                <select
                  class="gesture-axis-curve"
                  data-axis-curve={axis.param ?? 'off'}
                  value={axis.curve}
                  onChange={(e) => onAxisCurve(index(), e.currentTarget.value)}
                >
                  <For each={GESTURE_CURVE_OPTIONS}>
                    {(curve) => (
                      <option value={curve}>{CURVE_LABEL[curve]}</option>
                    )}
                  </For>
                </select>
              </label>
            </div>
          )}
        </For>

        <label class="gesture-sensitivity-wrap">
          <span class="gesture-sensitivity-label">
            чувствительность
            <span class="gesture-sensitivity-value">
              {gestureSensitivity().toFixed(1)} Hz
            </span>
          </span>
          <input
            type="range"
            class="gesture-sensitivity"
            data-cta="sensitivity"
            min={SENSITIVITY_MIN}
            max={SENSITIVITY_MAX}
            step={0.1}
            value={gestureSensitivity()}
            aria-label="Чувствительность фильтра"
            onInput={(e) => setGestureSensitivity(Number(e.currentTarget.value))}
          />
        </label>
      </div>

      {/* ── row 4: calibration ────────────────────────────────────────────── */}
      <div class="gesture-calibration">
        <div class="gesture-section-title">Калибровка</div>
        <div class="gesture-calibration-row">
          <button
            type="button"
            class="gesture-btn"
            data-cta="calibrate-near"
            aria-label="Показать руку близко — верхняя граница шкалы"
            onClick={() => calibrateNear()}
          >
            близко
          </button>
          <button
            type="button"
            class="gesture-btn"
            data-cta="calibrate-far"
            aria-label="Показать руку далеко — нижняя граница шкалы"
            onClick={() => calibrateFar()}
          >
            далеко
          </button>
          <button
            type="button"
            class="gesture-btn"
            data-cta="calibrate-reset"
            aria-label="Сбросить калибровку"
            onClick={() => resetCalibration()}
          >
            сброс
          </button>
          <span class="gesture-calibration-state" data-calibrated={gestureCalibrationState().calibrated ? 'true' : 'false'}>
            {gestureCalibrationState().calibrated ? 'откалибровано' : 'по умолчанию'}
          </span>
        </div>
      </div>

      {/* ── row 5: two hands + term mode ──────────────────────────────────── */}
      <div class="gesture-modes">
        <label class="gesture-switch">
          <input
            type="checkbox"
            class="gesture-switch-input"
            data-cta="two-hands"
            checked={gestureTwoHands()}
            onChange={(e) => setGestureTwoHands(e.currentTarget.checked)}
          />
          <span>две руки</span>
        </label>

        <label class="gesture-switch">
          <input
            type="checkbox"
            class="gesture-switch-input"
            data-cta="term-mode"
            checked={gestureTermMode()}
            onChange={(e) => setGestureTermMode(e.currentTarget.checked)}
          />
          <span>режим терминовки</span>
        </label>

        <button
          type="button"
          class="gesture-btn gesture-btn--primary"
          data-cta="term-commit"
          aria-label="Готово — записать собранный ритм в сетку"
          disabled={gestureTermHits().length === 0}
          onClick={() => {
            commitTermPattern();
          }}
        >
          готово ({gestureTermHits().length})
        </button>
        <button
          type="button"
          class="gesture-btn"
          data-cta="term-clear"
          aria-label="Очистить собранный ритм"
          disabled={gestureTermHits().length === 0}
          onClick={() => clearGestureTermHits()}
        >
          очистить
        </button>
      </div>
    </div>
  );
}
