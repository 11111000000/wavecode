import { For, Show, createMemo, type JSX } from 'solid-js';
import {
  micMeterFrame,
  micPeakTimes,
  micListening,
} from '../state/micStoreAdapter';

/**
 * MicMeter — live RMS bar with onset spike markers.
 *
 * Renders three pieces inside a flex row:
 *   1. The meter bar — width proportional to the latest `micMeterFrame().rms`.
 *      Empty + dimmed when not listening; pulses cyan when active.
 *   2. Spike markers — small magenta dots positioned by recent
 *      `micPeakTimes()` (last 3s). Each mark's X-position maps to
 *      "how long ago the onset fired", newest at the right edge.
 *   3. Read-out — "RMS: 0.4" / "240Hz" stacked on the right, both
 *      monospace tabular numbers so the values don't jiggle as the
 *      frame updates.
 *
 * Heights/widths match the CSS contract:
 *   `.mic-ux-row-meter`  — the row container (flex)
 *   `.mic-ux-meter`      — the bar container (relative, fixed height)
 *   `.mic-ux-meter-bar`  — the bar itself (absolute, fills left→right)
 *   `.mic-ux-meter-spike`— the onset marker (absolute dot)
 *   `.mic-ux-meter-readout` — right-side text column
 *
 * The component reads ONLY from the adapter — never from the
 * underlying `micStore` directly. This keeps it independent of the
 * parallel domain merge (WS-A): the adapter's `micMeterFrame()` /
 * `micPeakTimes()` swap from local-derived to store-native when the
 * merge lands, the component doesn't notice.
 */
const RMS_REFERENCE = 0.3;
const PEAK_WINDOW_MS = 3000;

export function MicMeter(): JSX.Element {
  const frame = createMemo(() => micMeterFrame());
  const peaks = createMemo(() => micPeakTimes());

  /** RMS → percent width, clamped to [0, 100]. 0.3 ≈ loud speech;
   *  above that we clip so the bar doesn't overflow. */
  const rmsPct = createMemo<string>(() => {
    const f = frame();
    if (f === null) return '0%';
    const pct = (f.rms / RMS_REFERENCE) * 100;
    return `${Math.max(0, Math.min(100, pct))}%`;
  });

  const rmsText = createMemo<string>(() => {
    const f = frame();
    if (f === null) return '0.00';
    return f.rms.toFixed(2);
  });

  const hzText = createMemo<string>(() => {
    const f = frame();
    if (f === null || f.hz === null) return '— Hz';
    return `${Math.round(f.hz)} Hz`;
  });

  /** Each peak positioned by `now - ms`. Newest at 100% (right edge),
   *  oldest at 0% (left edge). We recompute the `now` once per memo
   *  to keep all marks consistent. */
  const peakPositions = createMemo<
    ReadonlyArray<{ readonly type: 'note' | 'transient'; readonly xPct: number }>
  >(() => {
    const list = peaks();
    if (list.length === 0) return [];
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    return list.map((p) => ({
      type: p.type,
      xPct: Math.max(
        0,
        Math.min(100, ((PEAK_WINDOW_MS - (now - p.ms)) / PEAK_WINDOW_MS) * 100),
      ),
    }));
  });

  return (
    <div class="mic-ux-row-meter" role="group" aria-label="Live mic meter">
      <div
        class="mic-ux-meter"
        data-listening={micListening()}
        aria-hidden="true"
      >
        <div
          class="mic-ux-meter-bar"
          data-listening={micListening() ? 'true' : 'false'}
          style={{ width: rmsPct() }}
        />
        <For each={peakPositions()}>
          {(p) => (
            <span
              class="mic-ux-meter-spike"
              data-peak-type={p.type}
              style={{ left: `${p.xPct}%` }}
            />
          )}
        </For>
      </div>
      <div class="mic-ux-meter-readout" aria-live="polite">
        <div class="mic-ux-meter-readout-row">
          <span>RMS</span><span>{rmsText()}</span>
        </div>
        <div class="mic-ux-meter-readout-row">
          <span>Hz</span><span>{hzText()}</span>
        </div>
      </div>
      <Show when={frame() === null}>
        {/* No active frame: still render the row but mark it idle so
            screen readers know nothing is being measured. */}
        <span class="mic-ux-meter-idle-flag" data-state="idle" hidden />
      </Show>
    </div>
  );
}