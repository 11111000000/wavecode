import type { LayerMix } from '~/domain/types';

/**
 * injectMix — pure application use case.
 *
 * Takes a `score` (typically `stack(l1, l2, ...)`) and a `layerMix` array,
 * produces a new score where each top-level layer is rewritten with
 * per-layer gain and solo/mute logic.
 *
 * Rules (see decisions/wavecode-track-mixer.yaml):
 *   - If no `stack(...)` is detected, treat the whole score as a single
 *     layer and apply the FIRST layerMix entry (or noop if none).
 *   - For each top-level layer:
 *       • if any layer is `soloed`, non-soloed layers are muted → `.gain(0)`;
 *       • else if a layer is `muted`, that layer is muted → `.gain(0)`;
 *       • otherwise, the layer's effective gain = `layerMix[i].gain`.
 *   - The effective gain is applied by REPLACING every existing `.gain(<X>)`
 *     in the layer (or APPENDING `.gain(<X>)` if none exists).
 *   - `.gain()` accepts scalar numbers 0..1.5; we always emit a literal
 *     number for determinism and predictable replay.
 *
 * The function does not import `@strudel/transpiler` — the eslint
 * `application/` rule forbids direct strudel deps. Paren-aware parsing
 * mirrors `domain/layers/parseStack.ts` (same trade-off: see that file's
 * header for the rationale).
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

type StackSpan = { open: number; close: number };

const findOutermostStack = (score: string): StackSpan | null => {
  const re = /\bstack\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(score)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 1;
    let i = open + 1;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLine = false;
    let inBlock = false;
    while (i < score.length && depth > 0) {
      const ch = score[i];
      const prev = i > 0 ? score[i - 1] : '';
      if (inLine) { if (ch === '\n') inLine = false; i += 1; continue; }
      if (inBlock) { if (prev === '*' && ch === '/') inBlock = false; i += 1; continue; }
      if (inSingle) { if (ch === "'" && prev !== '\\') inSingle = false; i += 1; continue; }
      if (inDouble) { if (ch === '"' && prev !== '\\') inDouble = false; i += 1; continue; }
      if (inTemplate) { if (ch === '`' && prev !== '\\') inTemplate = false; i += 1; continue; }
      if (ch === '/' && score[i + 1] === '/') { inLine = true; i += 2; continue; }
      if (ch === '/' && score[i + 1] === '*') { inBlock = true; i += 2; continue; }
      if (ch === "'") { inSingle = true; i += 1; continue; }
      if (ch === '"') { inDouble = true; i += 1; continue; }
      if (ch === '`') { inTemplate = true; i += 1; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) return { open, close: i };
      }
      i += 1;
    }
  }
  return null;
};

const splitTopLevel = (body: string): ReadonlyArray<{ start: number; end: number; text: string }> => {
  const parts: Array<{ start: number; end: number; text: string }> = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLine = false;
  let inBlock = false;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const prev = i > 0 ? body[i - 1] : '';
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (prev === '*' && ch === '/') inBlock = false; continue; }
    if (inSingle) { if (ch === "'" && prev !== '\\') inSingle = false; continue; }
    if (inDouble) { if (ch === '"' && prev !== '\\') inDouble = false; continue; }
    if (inTemplate) { if (ch === '`' && prev !== '\\') inTemplate = false; continue; }
    if (ch === '/' && body[i + 1] === '/') { inLine = true; continue; }
    if (ch === '/' && body[i + 1] === '*') { inBlock = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push({ start, end: i, text: body.slice(start, i) });
      start = i + 1;
    }
  }
  parts.push({ start, end: body.length, text: body.slice(start) });
  return parts;
};

const anySoloed = (mix: ReadonlyArray<LayerMix>): boolean =>
  mix.some((m) => m.soloed);

export const injectMix = (score: string, layerMix: ReadonlyArray<LayerMix>): string => {
  if (!score.trim()) return score;
  const soloActive = anySoloed(layerMix);
  const stack = findOutermostStack(score);
  if (!stack) {
    if (layerMix.length === 0) return score;
    const only = layerMix[0]!;
    const muted = only.muted || (soloActive && !only.soloed);
    const gain = muted ? 0 : only.gain;
    return replaceGain(score, gain);
  }
  // Re-parse inside stack — we need char offsets relative to `body`,
  // then map back to absolute `score` positions for the rebuild.
  const body = score.slice(stack.open + 1, stack.close);
  const parts = splitTopLevel(body);
  const bodyStart = stack.open + 1;
  const out: string[] = [];
  let cursor = bodyStart;
  let index = 0;
  for (const part of parts) {
    const trimmed = part.text.replace(/\/\/.*$/gm, '').trim();
    if (!trimmed) {
      // Preserve empty slots as-is.
      out.push(score.slice(cursor, bodyStart + part.end));
      cursor = bodyStart + part.end;
      continue;
    }
    const mix = layerMix[index];
    out.push(score.slice(cursor, bodyStart + part.start));
    if (mix === undefined) {
      // No mixer state for this layer — keep original.
      out.push(part.text);
    } else {
      // Solo cascade: if any layer is soloed, only soloed layers are
      // audible. Soloed layers ignore their own `muted` flag (standard
      // DAW behaviour: solo forces the track on).
      const isAudible = soloActive ? mix.soloed : !mix.muted;
      const gain = isAudible ? mix.gain : 0;
      out.push(replaceGain(part.text, gain));
    }
    cursor = bodyStart + part.end;
    index += 1;
  }
  // Tail after the last part (e.g. trailing whitespace, comments).
  out.push(score.slice(cursor, stack.close));
  const head = score.slice(0, stack.open + 1);
  const tail = score.slice(stack.close);
  return `${head}${out.join('')}${tail}`;
};
