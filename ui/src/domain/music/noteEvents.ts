/**
 * Note-event extraction for the Pianoroll.
 *
 * `extractNoteEvents(score)` turns a Strudel-score string into a flat
 * `ReadonlyArray<NoteEvent>` (see `~/domain/midi/encoder`) by walking
 * the AST, locating every `note(...)` / `n(...)` / `chord(...)` call,
 * mining the mini-notation string inside it, and emitting one event
 * per note occurrence.
 *
 * Mini-notation mining (`parseMiniNotation`) is a minimal sub-parser:
 *
 *   - `<a b c>`         → 3 even steps in 1 cycle (startCycle = 0,
 *                         1/3, 2/3; endCycle = same + 1/3).
 *   - `[a b c]`         → one step, all notes starting at the same
 *                         instant (a chord).
 *   - Whitespace, `~`   → silence (skipped).
 *   - Plain `a b c`     → 1 step, single note.
 *   - `*n`              → repeat last token `n` times (mini-notation
 *                         step-multiplier; e.g. `hh*8`).
 *
 * The parser is INTENTIONALLY light: full Strudel mini-notation has
 * features we don't need for visual editing (Euclidean `b(3,8)`,
 * polyrhythm `[a, b]`, `.late()`, per-step modifiers). Adding them
 * later is cheap — the wrapper here doesn't need to roundtrip the
 * AST, only enumerate (midi, start) pairs.
 *
 * For rows whose leading function is `s(...)` we do NOT extract
 * pitches — Strudel samples are NOT pitched in score-text form
 * (the sample bank carries its own pitch). Those rows surface as
 * a sentinel `channel === 0` "drum" placeholder so the piano-roll
 * can still paint a colored lane; piano-roll is melody-first, so
 * drum lanes only appear if the user explicitly adds a `note(...)`
 * for them (or until we extend the parser to mine drum patterns
 * out of `s("drums_bd ~ drums_bd ~")`).
 *
 * Pure — no Solid, no Effect, no DOM. Unit-tested in
 * `noteEvents.test.ts`.
 */

import type { NoteEvent } from '~/domain/midi/encoder';
import { noteNumberToName, strudelNoteToMidi } from '~/domain/music/notes';
import {
  argText,
  parseScore,
  type Arg,
  type CallNode,
  type ScoreAST,
  type ScoreNode,
} from '~/domain/strudel';

/**
 * Channel for `note(...)` / `n(...)` melody rows. We pick 1 by
 * convention — Strudel doesn't assign a MIDI channel to melodic
 * `note()` patterns; the visualizer ribbon uses channel as a
 * lane key, so we keep `1` stable across all piano-roll notes
 * unless the score picks a higher number.
 */
const MELODY_CHANNEL = 1;

/**
 * `cat([…])` advances by 1 cycle per inner pattern. Without that
 * accumulator, all `cat` items would have startCycle = 0 and
 * overlap on the canvas.
 */
const CAT_CYCLE_STEP = 1;

/** Resolve a pitched note token (e.g. `c4`, `f#3`) to its MIDI
 *  number. Returns `NaN` for unrecognised tokens. */
const tokenToMidi = (token: string): number => {
  const trimmed = token.trim();
  if (!trimmed) return NaN;
  if (trimmed === '~' || trimmed === '-') return NaN;
  // drop optional `*` (mini-notation repeat suffix) and any trailing
  // modifier symbols — `c4*2` parses to c4, multiplier handled
  // outside by parseMiniNotation
  const base = trimmed.replace(/\*[\d.]*$/u, '').trim();
  return strudelNoteToMidi(base);
};

/**
 * Parse a mini-notation string into a flat list of `(midi, startCycle)` pairs.
 *
 * `endCycle` defaults to `startCycle + 1/N` where N is the number
 * of steps (`<a b c>` has 3 → 1/3 each; `[a b c]` has 1 step →
 * note length = 1; bare token has 1 step).
 *
 * `*N` repeats the previous token N times within the same envelope;
 * the dominant pattern in wavecode presets is `hh*8` which becomes
 * 8 evenly-spaced hats.
 */
type NotePair = { readonly midi: number; readonly start: number; readonly end: number };

const parseMiniNotation = (mini: string): ReadonlyArray<NotePair> => {
  if (!mini) return [];
  const out: NotePair[] = [];
  // Strip outer brackets for `< >` and the chord `[ ]` containers.
  // We don't recursively descend: `[a b]` and `<a b>` are leaf shapes.
  let s = mini;
  // Normalise any literal \n escape that survived JSON.parse.
  s = s.replace(/\\n/gu, ' ').replace(/\\t/gu, ' ');
  // First: detect the OUTERMOST container type by scanning
  // bracket-style. `cat([...])` would already have wrapped the inner
  // strings into a separate concatenation at the AST level, so the
  // mining context here is always a single mini-notation script.
  const startsWithAngle = s.trimStart().startsWith('<');
  const startsWithBracket = s.trimStart().startsWith('[');
  const endsWithGt = s.trimEnd().endsWith('>');
  const endsWithBrack = s.trimEnd().endsWith(']');
  let raw: string;
  let mode: 'sequence' | 'chord' | 'single';
  if (startsWithAngle && endsWithGt) {
    raw = s.slice(s.indexOf('<') + 1, s.lastIndexOf('>'));
    mode = 'sequence';
  } else if (startsWithBracket && endsWithBrack) {
    raw = s.slice(s.indexOf('[') + 1, s.lastIndexOf(']'));
    mode = 'chord';
  } else {
    raw = s;
    mode = 'single';
  }
  // Tokens are whitespace-separated. Skip empty + rests.
  const tokens = raw
    .split(/\s+/u)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];
  if (mode === 'chord') {
    // All tokens share the same start (and end) — a chord.
    const start = 0;
    const end = 1;
    for (const t of tokens) {
      const midi = tokenToMidi(t);
      if (Number.isNaN(midi)) continue;
      out.push({ midi, start, end });
    }
    return out;
  }
  if (mode === 'single') {
    // Bare token: a single-note pattern, usually something like
    // `g2` or `c4` — one full cycle. We treat each token as one
    // step distributed evenly.
    const n = tokens.length;
    for (let i = 0; i < n; i += 1) {
      const t = tokens[i]!;
      const midi = tokenToMidi(t);
      if (Number.isNaN(midi)) continue;
      const stepStart = i / n;
      const stepEnd = (i + 1) / n;
      out.push({ midi, start: stepStart, end: stepEnd });
    }
    return out;
  }
  // mode === 'sequence' — `<a b c d>` is 4 evenly spaced steps.
  // Handle `*N` repeat suffix on each token: token `hh*8` becomes
  // 8 evenly-spaced `hh` hits across the cycle (matching `hh*8`
  // in Strudel mini-notation).
  // Plan: expand each token into a list of (midi, stepIndexInCycle),
  // collected into a master sequence. The total step count is the
  // sum of all repeat multipliers.
  type Expanded = { readonly token: string; readonly repeat: number };
  const expanded: Expanded[] = [];
  for (const t of tokens) {
    const m = /^(.+?)\*(\d+(?:\.\d+)?)$/u.exec(t);
    if (m) {
      expanded.push({ token: m[1] ?? t, repeat: Math.max(1, Math.round(Number(m[2])) || 1) });
    } else {
      expanded.push({ token: t, repeat: 1 });
    }
  }
  const totalSteps = expanded.reduce((acc, e) => acc + e.repeat, 0);
  if (totalSteps <= 0) return [];
  let stepCursor = 0;
  for (const e of expanded) {
    const baseMidi = tokenToMidi(e.token);
    for (let i = 0; i < e.repeat; i += 1) {
      if (!Number.isNaN(baseMidi)) {
        const start = stepCursor / totalSteps;
        const end = (stepCursor + 1) / totalSteps;
        out.push({ midi: baseMidi, start, end });
      }
      stepCursor += 1;
    }
  }
  return out;
};

const isMelodyFn = (name: string | null): boolean => {
  if (name === null) return false;
  const lc = name.toLowerCase();
  return lc === 'note' || lc === 'n' || lc === 'chord';
};

/**
 * Walk a `ScoreNode` and emit every (midi, startCycle) it contains.
 * Returns synchronously; pure.
 *
 * `cycleOffset` accounts for `cat([...])` — each inner `note(...)` is
 * shifted right by the cumulative cat position.
 */
const collectFromNode = (
  node: ScoreNode,
  cycleOffset: number,
  out: { events: NoteEvent[] },
): void => {
  if (node.kind === 'stack') {
    // stack(...) layers play SIMULTANEOUSLY. Each arg starts at the
    // same cycleOffset (= the cat-position so far).
    for (const arg of node.args) {
      collectFromSingleArg(arg, cycleOffset, out);
    }
    return;
  }
  if (node.kind === 'call') {
    const lc = node.name.toLowerCase();
    if (lc === 'cat') {
      // cat(...) is a sequential concatenation; each inner arg is
      // at the next cycle offset. The parser wraps a `cat([a,b,c])`
      // body inside ONE bracketed arg — we handle the wrapped-form
      // by splitting the bracket contents by top-level commas.
      let offset = cycleOffset;
      for (const arg of node.args) {
        collectFromCatArg(arg, offset, out);
        offset += CAT_CYCLE_STEP;
      }
      return;
    }
    if (isMelodyFn(node.name)) {
      collectFromCall(node, cycleOffset, out);
      return;
    }
    // Other calls (s, gain, lpf, .shape, etc) — no pitches directly;
    // recurse into their args (e.g. `slow(2, note(...))`).
    for (const arg of node.args) {
      collectFromSingleArg(arg, cycleOffset, out);
    }
    return;
  }
  // comments / other — nothing.
};

/**
 * Cat-only arg collector: recognises the `cat([…])` bracket-wrapped
 * body shape and treats each top-level comma inside as a separate
 * cycle-step (= one section of the cat concatenation).
 *
 * Used ONLY by the `cat` branch of `collectFromNode`. Other paths
 * (`stack`, modifier calls like `.slow()`) use
 * `collectFromSingleArg` so a `stack(note("a"), note("b"))` body
 * stays simultaneous — splitting top-level commas there would
 * accidentally model `stack(a, b)` as a 2-cycle sequence.
 */
const collectFromCatArg = (
  arg: Arg,
  cycleOffset: number,
  out: { events: NoteEvent[] },
): void => {
  const text = argText(arg);
  if (!text) return;
  if (!/\b(note|n|chord)\s*\(/u.test(text)) return;
  let bodyForSplit = text.trim();
  if (
    bodyForSplit.startsWith('[') && bodyForSplit.endsWith(']')
  ) {
    bodyForSplit = bodyForSplit.slice(1, -1);
  }
  const chunks = splitTopLevelCommas(bodyForSplit);
  if (chunks.length <= 1) {
    collectFromArgText(text, cycleOffset, out);
    return;
  }
  let offset = cycleOffset;
  for (const chunk of chunks) {
    collectFromArgText(chunk, offset, out);
    offset += CAT_CYCLE_STEP;
  }
};

/**
 * Single-arg collector (stack layer, modifier arg). No comma-split,
 * no cycle-stepping — the parent handles position semantics.
 */
const collectFromSingleArg = (
  arg: Arg,
  cycleOffset: number,
  out: { events: NoteEvent[] },
): void => {
  const text = argText(arg);
  if (!text) return;
  if (!/\b(note|n|chord)\s*\(/u.test(text)) return;
  collectFromArgText(text, cycleOffset, out);
};

const collectFromArgText = (
  text: string,
  cycleOffset: number,
  out: { events: NoteEvent[] },
): void => {
  const trimmed = text.trim();
  if (!trimmed) return;
  const inner = parseScore(trimmed);
  for (const node of inner.nodes) {
    collectFromNode(node, cycleOffset, out);
  }
};

/**
 * Split `text` by top-level commas (respecting bracket depth).
 * Returns at least one element (the original text if no splits).
 * Used to break an opaque `expr` arg back into its comma-separated
 * parts before re-parsing — this preserves the `cat([…, …])`
 * cycle-step semantics when we descend into a cat wrapper.
 */
const splitTopLevelCommas = (text: string): ReadonlyArray<string> => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inStr: string | null = null;
  let i = 0;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr !== null) {
      if (ch === '\\' && i + 1 < text.length) {
        i += 1;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '<' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '>' || ch === '}') {
      depth -= 1;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.filter((c) => c.trim() !== '');
};

const collectFromCall = (
  call: CallNode,
  cycleOffset: number,
  out: { events: NoteEvent[] },
): void => {
  // `note(...)` / `n(...)` / `chord(...)` — first arg is the
  // mini-notation string literal; the rest are voice modifiers
  // (e.g. `.s("triangle").decay(.28)`) which we ignore.
  const first = call.args[0];
  if (first === undefined) return;
  if (first.kind !== 'string') return;
  const pairs = parseMiniNotation(first.value);
  if (pairs.length === 0) return;
  // Skip the rest of the chain methods on `note(...)` — they
  // appear as nested CallNodes. We don't try to chain them here.
  for (const p of pairs) {
    out.events.push({
      midi: Math.round(p.midi),
      startCycle: cycleOffset + p.start,
      endCycle: cycleOffset + p.end,
      velocity: 100,
      channel: MELODY_CHANNEL,
    });
  }
};

/**
 * Pure: extract a flat `NoteEvent[]` from a Strudel score.
 *
 * Empty / whitespace-only input returns `[]`. Malformed input
 * (parser falls back to `OtherNode`) also returns `[]` — the
 * pianoroll shows the empty state in that case.
 */
export const extractNoteEvents = (score: string): ReadonlyArray<NoteEvent> => {
  if (!score || !score.trim()) return [];
  const ast: ScoreAST = parseScore(score);
  const out: { events: NoteEvent[] } = { events: [] };
  for (const node of ast.nodes) {
    collectFromNode(node, 0, out);
  }
  return out.events;
};

/**
 * Count `note(...)` / `n(...)` / `chord(...)` calls in `score`,
 * including nested calls inside `stack(...)` / `cat(...)`. Mirrors
 * `extractNoteEvents` but without extracting pitches — useful for
 * an empty-state check that distinguishes "no notes" from "score
 * has rows but no pitches" (which would be a `s(...)` drum row;
 * rare for the pianoroll but defensible).
 */
export const countMelodyFns = (score: string): number => {
  if (!score || !score.trim()) return 0;
  const ast = parseScore(score);
  let n = 0;
  const visit = (node: ScoreNode): void => {
    if (node.kind === 'call') {
      if (isMelodyFn(node.name)) n += 1;
      for (const arg of node.args) {
        const text = argText(arg);
        if (!text) continue;
        if (!/\b(note|n|chord)\s*\(/u.test(text)) continue;
        const inner = parseScore(text);
        for (const innerNode of inner.nodes) visit(innerNode);
      }
    } else if (node.kind === 'stack') {
      for (const arg of node.args) {
        const text = argText(arg);
        if (!text) continue;
        const inner = parseScore(text);
        for (const innerNode of inner.nodes) visit(innerNode);
      }
    }
  };
  for (const node of ast.nodes) visit(node);
  return n;
};

/**
 * Synthesize a Strudel mini-notation string from a list of (midi, start, end)
 * pairs. Inverse of `parseMiniNotation` for the simple shapes we accept
 * (single sequence + occasional chords).
 *
 * The format chosen is `<a b [c d] e>` for grouped chord columns
 * (multiple notes inside one beat window collapse to a `[a b]`
 * chord token), one token per column.
 *
 * For now this is best-effort — the pianoroll only needs round-trip
 * fidelity for the simple case (a single sequence). For complex
 * scores it returns a single-token approximation; the user edits
 * in CodeMirror for fine control.
 */

const midiToStrudel = (midi: number): string => noteNumberToName(midi).toLowerCase();

export const notePairsToMini = (pairs: ReadonlyArray<NotePair>): string => {
  if (pairs.length === 0) return '';
  // Group pairs by their start/end window (column). Two notes are
  // "same column" if start and end match within a small epsilon.
  const groups: NotePair[][] = [];
  const eps = 0.01;
  for (const p of pairs) {
    const last = groups[groups.length - 1];
    if (
      last === undefined
      || last.length === 0
      || Math.abs(last[0]!.start - p.start) > eps
      || Math.abs(last[0]!.end - p.end) > eps
    ) {
      groups.push([p]);
    } else {
      last.push(p);
    }
  }
  const tokens = groups.map((g) => {
    if (g.length === 1) return midiToStrudel(g[0]!.midi);
    const sorted = [...g].map((p) => midiToStrudel(p.midi)).sort();
    return `[${sorted.join(' ')}]`;
  });
  // Single bare note: no wrapper.
  if (groups.length === 1 && tokens[0]!.startsWith('[') === false) {
    return tokens[0]!;
  }
  // Single chord column: keep the brackets, but no sequence wrapper.
  if (groups.length === 1) return tokens[0]!;
  return `<${tokens.join(' ')}>`;
};

// =========================================================================
//  Visual projection helpers — coordinates only, no rendering.
// =========================================================================

/**
 * MIDI bounds for the piano-roll canvas. Default C1..C6 keeps the
 * piano-roll familiar for any score; auto-shrinks to the actual
 * note range of `events` if they're all in a smaller window.
 */
export type MidiBounds = { readonly lo: number; readonly hi: number };

export const defaultMidiBounds = (events: ReadonlyArray<NoteEvent>): MidiBounds => {
  if (events.length === 0) return { lo: 24, hi: 96 }; // C1..C7
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of events) {
    if (!Number.isFinite(e.midi)) continue;
    if (e.midi < lo) lo = e.midi;
    if (e.midi > hi) hi = e.midi;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 24, hi: 96 };
  lo = Math.max(0, Math.floor(lo) - 2);
  hi = Math.min(127, Math.ceil(hi) + 2);
  if (hi - lo < 12) hi = lo + 12;
  return { lo, hi };
};

/**
 * Cycles (X-axis) bounds. Default = [0..16] which covers most
 * presets including the 32-section Creep. Auto-shrinks if events
 * fit inside.
 */
export type CycleBounds = { readonly lo: number; readonly hi: number };

export const defaultCycleBounds = (events: ReadonlyArray<NoteEvent>): CycleBounds => {
  if (events.length === 0) return { lo: 0, hi: 16 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of events) {
    if (e.startCycle < lo) lo = e.startCycle;
    if (e.endCycle > hi) hi = e.endCycle;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 16 };
  // Round to integer cycles, with at least 4 cycles of headroom.
  const start = Math.max(0, Math.floor(lo) - 1);
  const end = Math.ceil(hi) + 1;
  return { lo: start, hi: Math.max(end, start + 4) };
};

// Re-export `Arg` type-guard helpers for convenience (callers that
// want to introspect the source AST node alongside a NoteEvent).
export { type Arg } from '~/domain/strudel';
export { argText };
