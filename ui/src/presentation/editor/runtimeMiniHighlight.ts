/**
 * Runtime mini-notation highlight — CodeMirror extension.
 *
 * Connects the module-scope `runtimeHighlight` bridge (driven by
 * LiveAudioEngine + rAF loop) to a CodeMirror DecorationSet. The bridge
 * emits throttled, dedup'd char ranges; this extension reflects them as
 * `cm-mini-active` marks without competing with the static
 * `cm-mini-notation` syntax marker.
 *
 * Design contract: see `math/wavecode-runtime-mini-highlight/packet.md`.
 *
 * Decoration order:
 *   - cm-mini-notation (static, syntax) — provided by miniNotationHighlight
 *   - cm-mini-active   (runtime, this file)
 *
 * CodeMirror applies overlapping marks via DOM nesting; the active class
 * sits inside the notation span and only changes background-color /
 * box-shadow — it does not override text color, so the static syntax
 * hue remains visible.
 *
 * Stability guarantee: ranges are clipped to doc length each tick, so
 * user typing that reduces doc length can never throw, and stale ranges
 * pointing past the end are silently dropped (the highlight naturally
 * disappears until next eval).
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
  type CharRange,
} from '~/infrastructure/audio/runtimeHighlight';

const EMPTY_RANGES: ReadonlyArray<CharRange> = Object.freeze([]);

const setActiveRangesEffect: StateEffectType<ReadonlyArray<CharRange>> =
  StateEffect.define<ReadonlyArray<CharRange>>();

const activeRangesField = StateField.define<ReadonlyArray<CharRange>>({
  create: () => EMPTY_RANGES,
  update: (value, tr): ReadonlyArray<CharRange> => {
    for (const e of tr.effects) {
      if (e.is(setActiveRangesEffect)) return e.value;
    }
    return value;
  },
});

/**
 * Build a DecorationSet from active ranges, clipped to `docLength`.
 * Out-of-bounds or zero-length ranges are skipped — they would render
 * as `0 × 0px` rectangles or trigger CodeMirror assertions on
 * position > docLength.
 */
const buildDecorationSet = (
  ranges: ReadonlyArray<CharRange>,
  docLength: number,
): DecorationSet => {
  if (ranges.length === 0 || docLength <= 0) return Decoration.none;
  const marks = [];
  for (const r of ranges) {
    if (!Number.isFinite(r[0]) || !Number.isFinite(r[1])) continue;
    const from = Math.max(0, Math.min(r[0], docLength));
    const to = Math.max(0, Math.min(r[1], docLength));
    if (to - from <= 0) continue;
    marks.push(Decoration.mark({ class: 'cm-mini-active' }).range(from, to));
  }
  if (marks.length === 0) return Decoration.none;
  return Decoration.set(marks, true);
};

export const runtimeMiniHighlight: Extension = [
  activeRangesField,
  EditorView.decorations.compute([activeRangesField], (state) => {
    const ranges = state.field(activeRangesField);
    return buildDecorationSet(ranges, state.doc.length);
  }),
  ViewPlugin.fromClass(
    class {
      private readonly unsub: () => void;

      constructor(view: EditorView) {
        this.unsub = subscribe((next) => {
          // The bridge calls us from the rAF tick — outside any CM update
          // cycle. Wrap dispatch in microtask defensively in case the
          // callback fires during a transaction in some odd browser state.
          const dispatch = (): void => {
            view.dispatch({ effects: setActiveRangesEffect.of(next) });
          };
          if (typeof queueMicrotask === 'function') queueMicrotask(dispatch);
          else setTimeout(dispatch, 0);
        });
      }

      // CRITICAL: do NOT mutate state in update(); the
      // `EditorView.decorations.compute` already re-reads the field on
      // every transaction, so this method just observes for diagnostics.
      update(_update: ViewUpdate): void {
        // no-op — pure observer. Decorations are recomputed via the
        // facet bound to `activeRangesField`.
      }

      destroy(): void {
        this.unsub();
      }
    },
  ),
];
