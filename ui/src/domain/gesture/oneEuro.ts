/**
 * The 1€ filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * A one-pole low-pass whose cutoff adapts to the signal speed:
 *
 *   fc     = minCutoff + beta * |dx̂|      (cutoff frequency, Hz)
 *   tau    = 1 / (2 * PI * fc)             (time constant, s)
 *   alpha  = 1 / (1 + tau / dt)           (smoothing factor, dt in seconds)
 *   x̂      = alpha * x + (1 - alpha) * x̂_prev
 *   dx     = (x - x_prev) / dt            (smoothed by the same form with dCutoffHz)
 *
 * Slow movement is filtered hard (jitter disappears), fast movement is
 * filtered lightly (latency stays small) — which is exactly what hand
 * tracking needs.
 *
 * The filter is applied to *features*, not to raw landmarks: it is cheaper and
 * adds less latency. See `docs/hand-gesture-control-design.md` §3.3.
 *
 * Defaults: minCutoff = 1 Hz, beta = 0.01, dCutoff = 1 Hz.
 */

const TWO_PI = Math.PI * 2;

export type OneEuroOptions = {
  /** Cutoff frequency (Hz) at zero speed. Lower = smoother, slower. */
  readonly minCutoffHz?: number;
  /** Speed coefficient. Higher = more responsive to fast movement. */
  readonly beta?: number;
  /** Cutoff frequency (Hz) of the derivative low-pass. */
  readonly dCutoffHz?: number;
};

/**
 * Smoothing factor of a one-pole low-pass with cutoff `fc` (Hz) and a step of
 * `dt` seconds. `fc <= 0` disables the low-pass (alpha = 1).
 */
const smoothingAlpha = (fc: number, dt: number): number => {
  if (!Number.isFinite(fc) || fc <= 0) return 1;
  const tau = 1 / (TWO_PI * fc);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  private readonly minCutoffHz: number;
  private readonly beta: number;
  private readonly dCutoffHz: number;

  /** True once a first finite sample has been seen. */
  private hasPrev = false;
  /** Previous raw sample. */
  private xPrev = 0;
  /** Current filtered value. */
  private xHat = 0;
  /** Current filtered derivative. */
  private dxHat = 0;
  /** Timestamp of the last accepted sample. */
  private lastTsMs: number | undefined = undefined;
  /** Last value returned to the caller (also the fallback for bad input). */
  private lastValue = 0;

  constructor(opts?: OneEuroOptions) {
    this.minCutoffHz = opts?.minCutoffHz ?? 1.0;
    this.beta = opts?.beta ?? 0.01;
    this.dCutoffHz = opts?.dCutoffHz ?? 1.0;
  }

  /**
   * Filter one sample.
   *
   * - A non-finite sample is ignored: the last value is returned and the
   *   internal state is left untouched (a NaN must never poison the filter).
   * - A non-positive or non-finite time step carries no new information:
   *   the last value is returned and the state is left untouched.
   * - The very first sample is passed through unchanged (the filter starts
   *   from the signal itself, no ramp from zero).
   */
  filter(value: number, tsMs: number): number {
    if (!Number.isFinite(value)) return this.lastValue;

    if (!this.hasPrev) {
      this.hasPrev = true;
      this.xPrev = value;
      this.xHat = value;
      this.dxHat = 0;
      this.lastTsMs = Number.isFinite(tsMs) ? tsMs : undefined;
      this.lastValue = value;
      return value;
    }

    const prevTs = this.lastTsMs;
    if (prevTs === undefined || !Number.isFinite(tsMs)) return this.lastValue;

    const dt = (tsMs - prevTs) / 1000; // seconds
    if (!Number.isFinite(dt) || dt <= 0) return this.lastValue;

    const dx = (value - this.xPrev) / dt;
    const alphaD = smoothingAlpha(this.dCutoffHz, dt);
    this.dxHat = alphaD * dx + (1 - alphaD) * this.dxHat;

    const cutoffHz = this.minCutoffHz + this.beta * Math.abs(this.dxHat);
    const alpha = smoothingAlpha(cutoffHz, dt);
    const xHat = alpha * value + (1 - alpha) * this.xHat;

    this.xPrev = value;
    this.xHat = xHat;
    this.lastTsMs = tsMs;
    this.lastValue = xHat;
    return xHat;
  }

  /** Drop the internal state; the next sample starts a fresh filter. */
  reset(): void {
    this.hasPrev = false;
    this.xPrev = 0;
    this.xHat = 0;
    this.dxHat = 0;
    this.lastTsMs = undefined;
    this.lastValue = 0;
  }
}
