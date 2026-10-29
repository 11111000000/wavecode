/**
 * parseStackTopLayers — pure domain helper, now AST-backed.
 *
 * Extracts the top-level layer arguments of every `stack(...)`
 * in the score and returns descriptors with auto-detected names
 * (so the mixer can label rows as «Bass», «Arp», «Samples»,
 * «Layer N») plus the owning `section` ordinal.
 *
 * Implementation: routes through the Strudel-score AST
 * (`ui/src/domain/strudel/`) rather than the prior regex-based
 * paren walker. The public shape (`LayerDescriptor`) is unchanged
 * so existing callers (MixerPanel, editGridLayer) and the
 * parseStack.test.ts suite continue to pass without
 * modification.
 *
 * Why the rewrite: the regex parser mis-counted layers for any
 * score where a comment contained the substring `s("…")` or
 * where a string literal contained `s(` as data. The AST
 * treats comments as opaque and string contents as opaque, so
 * those failures are structurally impossible.
 *
 * Why the rewrite from depth-1 to all-stacks: the first version
 * of the AST walker kept the legacy regex semantics — "the first
 * `stack(` in source order wins". That worked when presets were
 * a single `stack(…)`, but every current preset is
 * `cat(stack(…), stack(…), …)`, one stack per arrangement section,
 * so the mixer exposed only section 1. For `creep` that is 2 of 29
 * layers; for `edm-house`, 4 of 44. Every control past row 2 moved
 * a fader that `injectMix` then discarded. `collectStacks` now
 * walks all of them.
 */

import { validateForMixer, type MixerLayer } from '~/domain/strudel';

export type LayerDescriptor = {
  readonly index: number;
  /** Whitespace-trimmed source of the layer (between top-level commas). */
  readonly source: string;
  /** Auto-detected friendly name from the leading function token. */
  readonly name: string;
  /**
   * 0-based ordinal of the owning `stack(...)` within the score.
   * Every shipping preset is multi-section (`cat(stack(…), …)`), so
   * this is what lets the mixer group rows per arrangement section
   * instead of flattening 44 rows into an unreadable wall.
   */
  readonly section: number;
};

/**
 * Parse a score string and return one `LayerDescriptor` per
 * top-level layer of every `stack(...)` in the score, in source
 * order. If there is no `stack(...)` at all, fall back to a
 * single-layer view of the whole score.
 */
export const parseStackTopLayers = (score: string): ReadonlyArray<LayerDescriptor> => {
  const layers: LayerDescriptor[] = validateForMixer(score).map((l: MixerLayer) => ({
    index: l.index,
    source: l.source,
    name: l.name,
    section: l.section,
  }));
  return layers;
};