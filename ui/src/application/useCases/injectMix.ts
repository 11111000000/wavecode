import type { LayerMix } from '~/domain/types';
import { collectStacksOf } from '~/domain/strudel/walker';
import { argText } from '~/domain/strudel/parser';
import type { Arg } from '~/domain/strudel/ast';

/**
 * injectMix — pure application use case.
 *
 * Takes a `score` and a `layerMix` array, produces a new score where
 * each top-level layer of every `stack(...)` is rewritten with per-layer
 * gain and solo/mute logic.
 *
 * Rules (see decisions/wavecode-track-mixer.yaml):
 *   - If no `stack(...)` is detected, treat the whole score as a single
 *     layer and apply the FIRST layerMix entry (or noop if none).
 *   - `layerMix` is indexed by the SAME enumeration order as
 *     `validateForMixer`: rows are grouped per `stack(...)` in source
 *     order, so row `i` addresses the `i`-th layer across the whole
 *     score, not the `i`-th layer of the first stack.
 *   - For each layer:
 *       • if any layer is `soloed`, non-soloed layers are muted → `.gain(0)`;
 *       • else if a layer is `muted`, that layer is muted → `.gain(0)`;
 *       • otherwise, the layer's effective gain = `layerMix[i].gain`.
 *   - The effective gain is applied by REPLACING every existing `.gain(<X>)`
 *     in the layer (or APPENDING `.gain(<X>)` if none exists).
 *   - `.gain()` accepts scalar numbers 0..1.5; we always emit a literal
 *     number for determinism and predictable replay.
 *
 * Multi-section scores: the previous implementation located a single
 * `stack(` with a regex and rewrote only that one, so a preset like
 * `cat(stack(…), stack(…), …)` had its gain edits applied to section 1
 * only. Rows 3+ (the mixer's own output) were then silently dropped —
 * the control moved a fader and nothing happened. Rewriting every
 * collected stack keeps the two in sync.
 *
 * Layer detection runs through the AST walker (`domain/strudel/`),
 * which treats comments and string literals as opaque — the previous
 * hand-rolled paren counter had to re-implement that and could be
 * fooled by a `stack(` appearing inside a string. The function does
 * not import `@strudel/transpiler` — the eslint `application/` rule
 * forbids direct strudel deps; `domain/strudel/` is a pure-TS AST with
 * no strudel imports.
 */

const GAIN_RE = /\.gain\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/g;

const appendGainAtChainEnd = (layerText: string, gainLit: string): string => {
  // Append `.gain(X)` at the end of the actual chain (after the last
  // non-whitespace char) so we preserve surrounding indentation and
  // newlines (e.g. `"\n  s(\"b\")\n"` becomes `"\n  s(\"b\").gain(0.4)\n"`).
  let i = layerText.length - 1;
  while (i >= 0 && /\s/.test(layerText[i] ?? '')) i -= 1;
  const cutPoint = i + 1;
  return `${layerText.slice(0, cutPoint)}.gain(${gainLit})${layerText.slice(cutPoint)}`;
};

const replaceGain = (layerText: string, gain: number): string => {
  const gainLit = formatGain(gain);
  // If the layer already has a numeric `.gain(X)`, replace the LAST one
  // (the most-recent gain in the chain is the active one in Strudel).
  // Non-numeric gain (e.g. `.gain("<0.5 1>")`) — append instead of replace.
  const matches: ReadonlyArray<RegExpExecArray> = Array.from(layerText.matchAll(GAIN_RE));
  const last = matches[matches.length - 1];
  if (last === undefined) {
    return appendGainAtChainEnd(layerText, gainLit);
  }
  const idx = last.index ?? 0;
  const before = layerText.slice(0, idx);
  const after = layerText.slice(idx + last[0].length);
  return `${before}.gain(${gainLit})${after}`;
};

const formatGain = (gain: number): string => {
  if (!Number.isFinite(gain)) return '1';
  // Clamp into a sane range to avoid blowing up speakers.
  const clamped = Math.max(0, Math.min(1.5, gain));
  // Stable: 4 decimal places, strip trailing zeros.
  return Number(clamped.toFixed(4)).toString();
};

/**
 * Absolute byte range of every top-level segment of a stack body.
 *
 * A comment-only segment yields empty text once comments are stripped —
 * callers emit it verbatim without consuming a mixer row.
 */
const splitSegments = (
  bodyStart: number,
  args: ReadonlyArray<Arg>,
): ReadonlyArray<{ start: number; end: number }> =>
  args.map((arg) => ({ start: arg.span.start - bodyStart, end: arg.span.end - bodyStart }));

const anySoloed = (mix: ReadonlyArray<LayerMix>): boolean =>
  mix.some((m) => m.soloed);

/**
 * Absolute byte offset of the `(` that opens a stack's body.
 *
 * `StackNode.span.start` points at the `stack` IDENT, not the paren —
 * `+1` would land inside the word. Scanning forward for the first
 * `(` is safe because the tokenizer only emits LPAREN as a real token,
 * so nothing between the ident and the paren can be a paren.
 */
const openParenAt = (score: string, stackStart: number): number => {
  const i = score.indexOf('(', stackStart);
  return i === -1 ? stackStart : i;
};

/** One pending text replacement, expressed in absolute score offsets. */
type Edit = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export const injectMix = (score: string, layerMix: ReadonlyArray<LayerMix>): string => {
  if (!score.trim()) return score;
  const soloActive = anySoloed(layerMix);
  const stacks = collectStacksOf(score);

  if (stacks.length === 0) {
    if (layerMix.length === 0) return score;
    const only = layerMix[0]!;
    const muted = only.muted || (soloActive && !only.soloed);
    const gain = muted ? 0 : only.gain;
    return replaceGain(score, gain);
  }

  const edits: Edit[] = [];
  let index = 0;

  for (const ref of stacks) {
    const bodyStart = openParenAt(score, ref.start) + 1;
    const segments = splitSegments(bodyStart, ref.args);

    for (const seg of segments) {
      const raw = score.slice(bodyStart + seg.start, bodyStart + seg.end);
      const trimmed = raw.replace(/\/\/.*$/gm, '').trim();
      if (!trimmed) {
        // Comment-only or empty slot — preserve as-is, no row consumed.
        continue;
      }
      const mix = layerMix[index];
      index += 1;
      if (mix === undefined) continue;
      // Solo cascade: if any layer is soloed, only soloed layers are
      // audible. Soloed layers ignore their own `muted` flag (standard
      // DAW behaviour: solo forces the track on).
      const isAudible = soloActive ? mix.soloed : !mix.muted;
      const gain = isAudible ? mix.gain : 0;
      edits.push({
        start: bodyStart + seg.start,
        end: bodyStart + seg.end,
        text: replaceGain(raw, gain),
      });
    }
  }

  if (edits.length === 0) return score;
  // Apply right-to-left so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let out = score;
  for (const e of edits) {
    out = `${out.slice(0, e.start)}${e.text}${out.slice(e.end)}`;
  }
  return out;
};

/** Re-exported for tests that need the raw arg text of a layer. */
export const __argText = argText;