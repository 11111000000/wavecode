/**
 * parseStackTopLayers — pure domain helper, now AST-backed.
 *
 * Extracts the top-level layer arguments of a Strudel `stack(...)`
 * call and returns descriptors with auto-detected names (so the
 * mixer can label rows as «Bass», «Arp», «Samples», «Layer N»).
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
 */

import { validateForMixer, type MixerLayer } from '~/domain/strudel';

export type LayerDescriptor = {
  readonly index: number;
  /** Whitespace-trimmed source of the layer (between top-level commas). */
  readonly source: string;
  /** Auto-detected friendly name from the leading function token. */
  readonly name: string;
};

/**
 * Parse a score string and return one `LayerDescriptor` per
 * top-level `stack(...)` arg. If there is no top-level stack,
 * fall back to a single-layer view of the whole score.
 */
export const parseStackTopLayers = (score: string): ReadonlyArray<LayerDescriptor> => {
  const layers: LayerDescriptor[] = validateForMixer(score).map((l: MixerLayer) => ({
    index: l.index,
    source: l.source,
    name: l.name,
  }));
  return layers;
};