/**
 * parseStackTopLayers — pure domain helper.
 *
 * Extracts the top-level layer arguments of a Strudel `stack(...)` call.
 * Returns descriptors with auto-detected names (so the mixer can label
 * rows as «Bass», «Arp», «Samples», «Layer N»).
 *
 * Implementation: paren-aware split. We DO NOT depend on `@strudel/transpiler`
 * from domain/ (architecture boundary — see eslint.config.js). The transpiler
 * also does not expose an AST, only a transpiled JS output, so regex split
 * is the practical approach. Robustness is preserved by:
 *   - tracking paren depth (so nested `stack()` doesn't break splitting)
 *   - respecting string and template-literal boundaries
 *   - falling back to a single-layer view when no `stack(...)` is found
 *
 * This is the «less accurate» fallback documented in
 * `math/wavecode-track-mixer/packet.md` antithesis (1).
 */

export type LayerDescriptor = {
  readonly index: number;
  /** Whitespace-trimmed source of the layer (between top-level commas). */
  readonly source: string;
  /** Auto-detected friendly name from the leading function token. */
  readonly name: string;
};

const detectName = (source: string, index: number): string => {
  const trimmed = source.trim();
  const firstToken = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  const fn = firstToken?.[1];
  if (fn === undefined) return `Layer ${index}`;
  switch (fn) {
    case 'note': {
      // Heuristic: classify the first letter+digit pitch reference.
      //   - oct <= 2 → Bass (g2, a1, …)
      //   - oct >= 5 → Lead (c5, d6, …)
      //   - mid (3..4) → Piano (generic — could be anything)
      // Patterns without letter+digit (e.g. `note("<[55,59,62]>")`) → Piano.
      const pitch = trimmed.match(/([a-gA-G])(\d)/);
      if (pitch && pitch[1] && pitch[2]) {
        const letter = pitch[1];
        const octRaw = pitch[2];
        const oct = Number.parseInt(octRaw, 10);
        if (oct <= 2) return `Bass (${letter.toLowerCase()}${oct})`;
        if (oct >= 5) return `Lead (${letter.toLowerCase()}${oct})`;
        return 'Piano';
      }
      return 'Piano';
    }
    case 'n': return 'Arp';
    case 's': return 'Samples';
    case 'stack': return 'Sub-stack';
    case 'cat': return 'Sequence';
    case 'silence': return 'Silence';
    default: return fn;
  }
};

const findOutermostStack = (score: string): { open: number; close: number } | null => {
  const re = /\bstack\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(score)) !== null) {
    const open = match.index + match[0].length - 1; // position of '('
    // Walk forward to the matching ')' respecting strings and parens.
    let depth = 1;
    let i = open + 1;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    while (i < score.length && depth > 0) {
      const ch = score[i];
      const prev = i > 0 ? score[i - 1] : '';
      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        i += 1;
        continue;
      }
      if (inBlockComment) {
        if (prev === '*' && ch === '/') inBlockComment = false;
        i += 1;
        continue;
      }
      if (inSingle) {
        if (ch === "'" && prev !== '\\') inSingle = false;
        i += 1;
        continue;
      }
      if (inDouble) {
        if (ch === '"' && prev !== '\\') inDouble = false;
        i += 1;
        continue;
      }
      if (inTemplate) {
        if (ch === '`' && prev !== '\\') inTemplate = false;
        i += 1;
        continue;
      }
      if (ch === '/' && score[i + 1] === '/') { inLineComment = true; i += 2; continue; }
      if (ch === '/' && score[i + 1] === '*') { inBlockComment = true; i += 2; continue; }
      if (ch === "'") { inSingle = true; i += 1; continue; }
      if (ch === '"') { inDouble = true; i += 1; continue; }
      if (ch === '`') { inTemplate = true; i += 1; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
      if (depth === 0) return { open, close: i - 1 };
    }
    if (depth !== 0) {
      // Unbalanced — abandon this match and try the next.
      continue;
    }
  }
  return null;
};

/** Split the inside of a `stack(...)` body into top-level layer sources. */
const splitTopLevel = (body: string): ReadonlyArray<string> => {
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const prev = i > 0 ? body[i - 1] : '';
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (prev === '*' && ch === '/') inBlockComment = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'" && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== '\\') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`' && prev !== '\\') inTemplate = false;
      continue;
    }
    if (ch === '/' && body[i + 1] === '/') { inLineComment = true; continue; }
    if (ch === '/' && body[i + 1] === '*') { inBlockComment = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
};

export const parseStackTopLayers = (score: string): ReadonlyArray<LayerDescriptor> => {
  const trimmed = score.trim();
  if (!trimmed) return [];
  const stack = findOutermostStack(trimmed);
  if (!stack) {
    // No `stack(...)` wrapper → treat the whole score as a single layer.
    return [{ index: 0, source: trimmed, name: detectName(trimmed, 0) }];
  }
  const body = trimmed.slice(stack.open + 1, stack.close);
  const raw = splitTopLevel(body);
  const layers: LayerDescriptor[] = [];
  let index = 0;
  for (const part of raw) {
    const stripped = part.replace(/\/\/.*$/gm, '').trim();
    if (!stripped) continue; // skip empty slots between commas
    layers.push({
      index,
      source: part.trim(),
      name: detectName(stripped, index),
    });
    index += 1;
  }
  return layers;
};
