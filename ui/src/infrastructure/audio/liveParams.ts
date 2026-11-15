import type { LiveParam, LiveParamName } from '~/domain/services';

/**
 * Live parameter control — the REAL continuous-parameter path.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until now wavecode could change "live" values in exactly two ways:
 *   - `repl.setCps()` — a scheduler-level knob (tempo);
 *   - a TEXTUAL path: rewrite `.gain(X)` inside the score string and
 *     re-evaluate the pattern (`injectMix` → `repl.evaluate`).
 *
 * The textual path re-compiles the pattern, re-fires the `beforeEval` /
 * `afterEval` hooks and swaps the whole scheduler pattern — unusable
 * for per-frame gesture control.
 *
 * WHAT IS REACHABLE
 * -----------------
 * superdough's master output is
 *   `channelMerger → destinationGain (GainNode) → audioContext.destination`
 * and `getSuperdoughAudioController().output.destinationGain` hands out
 * that live GainNode. Writing to its `gain` AudioParam changes the
 * level of everything that is currently sounding — no re-evaluation, no
 * scheduler touch, safe at frame rate.
 *
 * WHAT IS NOT REACHABLE (yet)
 * ---------------------------
 * superdough builds its per-voice FX chain (cutoff / hcutoff / room /
 * lpf) INSIDE `superdough()` on every trigger and keeps those nodes in
 * a per-voice `nodeTracker` (`superdough/modulators.mjs` exposes
 * `connectBusModulator(params, nodeTracker, controller)` — the tracker
 * is per-voice, there is no global handle). So `cutoff` / `hcutoff` /
 * `room` / `speed` cannot be driven live today: they are validated and
 * clamped, but NOT applied.
 *
 * LAYER SCOPE
 * -----------
 * wavecode's "layers" are pattern-level constructs that exist only
 * inside the score string — they are not audio-graph nodes — and
 * superdough has a single global output. A layer-scoped request is
 * therefore a documented SAFE NO-OP, never an exception.
 *
 * The class is deliberately free of any dependency on the rest of the
 * engine: the gain node and the clock are injected, so it is unit
 * testable without a real AudioContext (the vitest env is jsdom, where
 * `AudioContext` does not exist).
 */

/** Structural view of the bits of a GainNode this module touches. */
type GainLike = {
  readonly gain: {
    value: number;
    setTargetAtTime: (
      target: number,
      startTime: number,
      timeConstant: number,
    ) => unknown;
    setValueAtTime: (value: number, time: number) => unknown;
  };
  readonly context?: { readonly currentTime?: number };
};

export type LiveParamControllerOptions = {
  /**
   * Resolves the master GainNode. Called lazily on every mutation, so a
   * node that only appears later (superdough creates its controller on
   * the first trigger) is picked up automatically. MUST NOT throw.
   */
  readonly getGainNode?: () => GainNode | null;
  /**
   * Clock used to schedule AudioParam changes, in SECONDS, in the
   * AudioContext time base. Used only when the gain node does not
   * expose its own context clock.
   */
  readonly getNow?: () => number;
};

/**
 * Accepted range per parameter.
 *
 * Out-of-range values are CLAMPED (a gesture that overshoots still
 * lands on a sane value); non-finite values (NaN / ±Infinity) are
 * ignored entirely and the previous value is kept.
 */
const PARAM_RANGES: Readonly<
  Record<LiveParamName, { readonly min: number; readonly max: number }>
> = {
  gain: { min: 0, max: 1.5 },
  cutoff: { min: 20, max: 20000 },
  hcutoff: { min: 20, max: 20000 },
  room: { min: 0, max: 1 },
  speed: { min: 0.25, max: 4 },
};

/** Parameters that have a reachable node today. */
const APPLIED_PARAMS: ReadonlySet<LiveParamName> = new Set<LiveParamName>(['gain']);

/** Ramp used when the master gain is reset to unity (a click-free return). */
const RESET_RAMP_MS = 60;

export class LiveParamController {
  private readonly getGainNode: () => GainNode | null;
  private readonly getNow: () => number;
  /** Last accepted (clamped) value per parameter. */
  private readonly values = new Map<LiveParamName, number>();
  /** Ramp (ms) that accompanied the last accepted value per parameter. */
  private readonly ramps = new Map<LiveParamName, number>();
  /** Master gain waiting for a gain node to show up. */
  private pendingGain: { readonly value: number; readonly rampMs: number } | null = null;

  constructor(opts: LiveParamControllerOptions = {}) {
    this.getGainNode = opts.getGainNode ?? (() => null);
    this.getNow = opts.getNow ?? (() => 0);
  }

  /**
   * Apply a live parameter change.
   *
   * - `layer` scope → safe no-op (see the file header).
   * - non-finite `value` → ignored, the last value is kept.
   * - out-of-range `value` → clamped into the parameter's range.
   * - `rampMs === 0` → immediate (`setValueAtTime`).
   * - `rampMs > 0` → smoothed (`setTargetAtTime` with
   *   `timeConstant = max(rampMs / 1000 / 3, 0.001)`).
   */
  set(param: LiveParam): void {
    // A pending master gain may have become applicable by now (the gain
    // node can appear at any time). Flush it before handling the new
    // request so a stored value is never stranded.
    this.flush();

    // Layer scope: documented no-op, never an exception.
    if (param.scope?.scope !== 'master') return;

    const range = PARAM_RANGES[param.param];
    if (!range) return;

    // Non-finite input is ignored — the last value survives.
    if (!Number.isFinite(param.value)) return;

    const value = Math.min(range.max, Math.max(range.min, param.value));
    const rampMs =
      Number.isFinite(param.rampMs) && param.rampMs > 0 ? param.rampMs : 0;

    this.values.set(param.param, value);
    this.ramps.set(param.param, rampMs);

    // Only `gain` has a reachable node today (master GainNode). The
    // other parameters are remembered but not applied — see the header.
    if (!APPLIED_PARAMS.has(param.param)) return;

    this.pendingGain = { value, rampMs };
    this.flush();
  }

  /**
   * Return the master gain to 1 and forget every stored value.
   *
   * Used when the gesture feature is switched off and when the engine
   * stops — leaving a gesture-set level behind would silently change
   * the level of the next score.
   */
  reset(): void {
    this.pendingGain = null;
    this.values.clear();
    this.ramps.clear();
    const node = this.resolveGainNode();
    if (!node) return;
    // Ramp instead of jumping: an instant jump back to unity clicks.
    this.applyGain(node, 1, RESET_RAMP_MS);
  }

  /**
   * Last accepted (clamped) value for a parameter, or `undefined` when it
   * was never set.
   *
   * NOTE: for the parameters without a reachable node today (`cutoff` /
   * `hcutoff` / `room` / `speed`) this is the REQUESTED value, not an
   * applied one.
   */
  getValue(param: LiveParamName): number | undefined {
    return this.values.get(param);
  }

  /**
   * Re-apply the last stored master gain to the CURRENT gain node.
   *
   * superdough re-creates its output graph in a few places —
   * `SuperdoughOutput.reset()` swaps in a fresh `destinationGain`, and
   * wavecode's offline render replaces the live controller with a new
   * one (`OfflineRender` → `setSuperdoughAudioController(new …)`), which
   * brings a fresh gain node whose value is 1 again. Without this call a
   * gesture-set level would silently snap back to unity.
   */
  reapply(): void {
    const value = this.values.get('gain');
    if (value === undefined) return;
    this.pendingGain = { value, rampMs: this.ramps.get('gain') ?? 0 };
    this.flush();
  }

  /**
   * Push the pending master gain to the gain node, if there is one.
   * Without a node the request STAYS PENDING and is applied as soon as
   * the node appears (next `set()` or an explicit `reapply()`).
   */
  private flush(): void {
    const pending = this.pendingGain;
    if (!pending) return;
    const node = this.resolveGainNode();
    if (!node) return;
    this.pendingGain = null;
    this.applyGain(node, pending.value, pending.rampMs);
  }

  private applyGain(node: GainNode, value: number, rampMs: number): void {
    const gain = (node as unknown as GainLike).gain;
    const now = this.now(node);
    try {
      if (rampMs <= 0) {
        gain.setValueAtTime(value, now);
        return;
      }
      // Exponential approach: with `timeConstant = ramp / 3` the curve
      // is ~95% of the way to the target after `ramp` ms.
      const timeConstant = Math.max(rampMs / 1000 / 3, 0.001);
      gain.setTargetAtTime(value, now, timeConstant);
    } catch {
      // A dead AudioContext must never break the caller.
    }
  }

  private resolveGainNode(): GainNode | null {
    try {
      const node = this.getGainNode();
      if (!node) return null;
      const gain = (node as unknown as GainLike).gain;
      if (!gain) return null;
      return node;
    } catch {
      return null;
    }
  }

  /**
   * The time base AudioParam schedules against: the gain node's own
   * AudioContext clock when it exposes one, otherwise the injected
   * clock.
   */
  private now(node: GainNode | null): number {
    const ctx = (node as unknown as GainLike).context;
    const fromCtx = ctx?.currentTime;
    if (typeof fromCtx === 'number' && Number.isFinite(fromCtx)) return fromCtx;
    const injected = this.getNow();
    return typeof injected === 'number' && Number.isFinite(injected) ? injected : 0;
  }
}
