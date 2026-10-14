/**
 * Runtime mini-notation highlight — CodeMirror extension.
 *
 * Connects the module-scope `runtimeHighlight` bridge (driven by
 * LiveAudioEngine + rAF loop) to a CodeMirror DecorationSet. The bridge
 * emits throttled, dedup'd `ColoredRange[]` (per-layer color + per-beat
 * `down`/`off` brightness); this extension reflects them as
 * `cm-mini-active c{color} {beat}` marks without competing with the
 * static `cm-mini-notation` syntax marker.
 *
 * Design contract: see `math/wavecode-runtime-mini-highlight/packet.md`.
 *
 * Decoration order:
 *   - cm-mini-notation (static, syntax) — provided by miniNotationHighlight
 *   - cm-mini-active   (runtime, this file) — `c{0..3} {down|off}`
 *
 * CodeMirror applies overlapping marks via DOM nesting; the active
 * class sits inside the notation span and only changes background-color /
 * box-shadow — it does not override text color, so the static syntax
 * hue remains visible.
 *
 * Stability guarantee: ranges are clipped to doc length each tick, so
 * user typing that reduces doc length can never throw, and stale ranges
 * pointing past the end are silently dropped (the highlight naturally
 * disappears until next eval).
 *
 * Pattern follows miniNotationHighlight.ts — the `ViewPlugin.fromClass`
 * shape with `decorations: (v) => v.decorations` accessor. Alternative
 * APIs (`EditorView.decorations.compute([field], …)`) are only in CM6
 * post-SCENT, and wavecode pins the base CM6 release without that
 * extension.
 */

import { StateEffect, StateField, type Extension, type StateEffectType } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  subscribe,
  type ColoredRange,
} from '~/infrastructure/audio/runtimeHighlight';

const EMPTY_RANGES: ReadonlyArray<ColoredRange> = Object.freeze([]);

const setActiveRangesEffect: StateEffectType<ReadonlyArray<ColoredRange>> =
  StateEffect.define<ReadonlyArray<ColoredRange>>();

const activeRangesField = StateField.define<ReadonlyArray<ColoredRange>>({
  create: () => EMPTY_RANGES,
  update: (value, tr): ReadonlyArray<ColoredRange> => {
    for (const e of tr.effects) {
      if (e.is(setActiveRangesEffect)) return e.value;
    }
    return value;
  },
});

/**
 * Build a DecorationSet from active ranges, clipped to `docLength`.
 * Each range carries a `color` (palette index 0..3) and a `beat`
 * (`down` | `off`) — combined into the class
 * `cm-mini-active c{color} {beat}` so CSS can give each combination
 * a distinct intensity. Out-of-bounds or zero-length ranges are
 * skipped — they would render as `0 × 0px` rectangles or trigger
 * CodeMirror assertions on position > docLength.
 */
const buildDecorationSet = (
  ranges: ReadonlyArray<ColoredRange>,
  docLength: number,
): DecorationSet => {
  if (ranges.length === 0 || docLength <= 0) return Decoration.none;
  const marks = [];
  for (const r of ranges) {
    if (!Number.isFinite(r.from) || !Number.isFinite(r.to)) continue;
    const from = Math.max(0, Math.min(r.from, docLength));
    const to = Math.max(0, Math.min(r.to, docLength));
    if (to - from <= 0) continue;
    const cls = `cm-mini-active c${r.color} ${r.beat}`;
    marks.push(Decoration.mark({ class: cls }).range(from, to));
  }
  if (marks.length === 0) return Decoration.none;
  return Decoration.set(marks, true);
};

export const runtimeMiniHighlight: Extension = [
  activeRangesField,
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private prevRanges: ReadonlyArray<ColoredRange> = EMPTY_RANGES;
      private prevDocLength = -1;
      private readonly unsub: () => void;

      constructor(view: EditorView) {
        const ranges = view.state.field(activeRangesField);
        const docLen = view.state.doc.length;
        this.prevRanges = ranges;
        this.prevDocLength = docLen;
        this.decorations = buildDecorationSet(ranges, docLen);
        this.unsub = subscribe((next) => {
          // The bridge calls us from the rAF tick — outside any CM
          // update cycle. Dispatch directly; effects flow through
          // `setActiveRangesEffect` → the field is updated →
          // `update()` below rebuilds decorations on the next doc
          // tick.
          view.dispatch({ effects: setActiveRangesEffect.of(next) });
        });
      }

      // CodeMirror calls this on every transaction. Rebuild decorations
      // ONLY when (a) the active ranges changed (via the effect above)
      // or (b) the doc length changed (clamping ranges to a shorter
      // doc is the only state we have to refresh).
      update(update: ViewUpdate): void {
        const ranges = update.state.field(activeRangesField);
        const docLen = update.state.doc.length;
        const rangesChanged = ranges !== this.prevRanges;
        const docChanged = docLen !== this.prevDocLength;
        if (rangesChanged || docChanged) {
          this.prevRanges = ranges;
          this.prevDocLength = docLen;
          this.decorations = buildDecorationSet(ranges, docLen);
        }
      }

      destroy(): void {
        this.unsub();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  ),
];
