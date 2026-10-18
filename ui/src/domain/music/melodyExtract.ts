/**
 * Melody grid score extraction + commit — pure functions.
 *
 * The melody grid is a parallel feature to the drum StepGrid
 * (`ui/src/domain/music/gridTypes.ts` + `gridState.ts`). Both read
 * and write the score via the AST-based splice API in
 * `~/domain/strudel/`. The two grids target DIFFERENT AST
 * subtrees:
 *
 *   - drum grid   → the first 4 `s(…)` rows inside a top stack
 *                   (gate: `canEditGridLayer`).
 *   - melody grid → the first `note(…)` / `n(…)` call inside a
 *                   top stack (gate: `extractMelodyFromScore`).
 *
 * The two grids NEVER touch each other's targets — a drum-grid
 * edit does not touch the melody layer, and vice versa.
 *
 * Pure: no Solid, no Effect, no Web Audio. The state layer
 * (`melodyGridState.ts`) calls these and applies the side effects
 * (preview, replaceScore, eval, hot-swap) on its own.
 *
 * Mini-notation output format:
 *   - 0 cells  → empty string
 *   - 1 cell   → `<c4>` (single note, no inner list)
 *   - ≥2 cells → `<[c4 e4] [g4] [c5]>` (space-separated step tokens
 *                inside a single `<>` cycle)
 *   - Always suffixed with `.s("<instrument>")` so Strudel picks
 *     the correct timbre.
 */

import {
  MELODY_COLS,
  MELODY_PITCH_LOW,
  MELODY_PITCH_HIGH,
  type MelodyCell,
  type MelodyGrid,
} from './melodyGridTypes';
import { noteNumberToName, strudelNoteToMidi } from './notes';
import {
  parseScore,
  argLeadingName,
  argText,
  replaceLayerSources,
  type ScoreAST,
} from '~/domain/strudel';

/**
 * Default BPM (120). Surfaced when neither the score nor the
 * caller provides one. Cyclist's default cps=0.5 corresponds
 * to ~120 BPM under the conventional 1-cycle-per-beat
 * assumption.
 */
export const MELODY_DEFAULT_BPM = 120;

/**
 * Default instrument for committed snippets. Matches the
 * pianoRecStore default (triangle wave — audible without a
 * sample-bank lookup).
 */
export const MELODY_DEFAULT_INSTRUMENT = 'triangle';

/**
 * Reasons `extractMelodyFromScore` may return `{ ok: false }`. The
 * UI uses this to render different tooltip copy per case.
 */
export type ExtractInvalidReason = 'empty-score' | 'no-note-call';

export type ExtractResult =
  | {
      readonly ok: true;
      readonly cells: MelodyGrid;
      /** The top-level stack arg index of the note-call we found.
       *  -1 means the note-call is the program's top-level node
       *  (bare `note("…")` with no surrounding stack); the
       *  commit path refuses to splice in that case because
       *  there is no stack to splice into. */
      readonly argIndex: number;
      /** Leading function name we found, lower-cased (`note` or `n`). */
      readonly noteName: string;
    }
  | {
      readonly ok: false;
      readonly reason: ExtractInvalidReason;
      readonly cells: ReadonlyArray<never>;
    };

/**
 * Reasons `commitMelodyToScore` may refuse to splice.
 */
export type CommitInvalidReason =
  | 'empty-score'
  | 'no-note-call'
  | 'no-stack-target';

export type CommitMelodyResult =
  | { readonly ok: true; readonly score: string; readonly replaced: number }
  | { readonly ok: false; readonly reason: CommitInvalidReason };

/**
 * Options for `commitMelodyToScore`.
 *
 * `bpm` is currently only stored in the resulting preview (the
 * audio engine reads tempo from `appStore.transportState.cps`, not
 * from the snippet). Surfaced so a future mini-notation can
 * encode `<…>.fast(N)` matching the recording tempo.
 *
 * `instrument` is appended as `.s("<instrument>")` so the snippet
 * uses the timbre the user expects.
 */
export type CommitMelodyOptions = {
  readonly bpm?: number | undefined;
  readonly instrument?: string | undefined;
};

/**
 * Edit-mode gate: a score is melody-editable iff
 * `extractMelodyFromScore` returns `{ ok: true }`. Mirrors
 * `canEditGridLayer` for the drum grid.
 */
export const canEditMelodyLayer = (score: string): boolean =>
  extractMelodyFromScore(score).ok;

/** Lower-cased leading identifiers treated as "melody call". */
const melodyLeadingNames = new Set(['note', 'n']);

/**
 * Lift the inner string literal of a `note("…")` / `n("…")`
 * expression. The AST walker captures the whole `note(…)` as an
 * `Arg.expr` (it does not recurse into nested calls), so the arg
 * text looks like `note("c4 e4 g4")`. This helper pulls the
 * `c4 e4 g4` back out.
 */
const liftFirstQuotedString = (source: string): string | null => {
  for (const quote of ['"', "'", '`'] as const) {
    const start = source.indexOf(quote);
    if (start === -1) continue;
    const end = source.indexOf(quote, start + 1);
    if (end === -1) return null;
    return source.slice(start + 1, end);
  }
  return null;
};

/**
 * Locate the first `note(…)` / `n(…)` call reachable from the
 * top-level nodes of `ast`. Walks ONE level into a top-level
 * `stack(…)` call so a `stack(note("…"), s("…"))` score surfaces
 * the `note` row directly. Also accepts a bare top-level
 * `note("…")` (no surrounding stack).
 *
 * Returns `null` when no usable `note` / `n` call is found.
 *
 *   - `argIndex = i` — note-call is the i-th arg of the top stack.
 *   - `argIndex = -1` — note-call is the program's top-level node.
 */
const findFirstNoteCall = (
  ast: ScoreAST,
): {
  readonly argIndex: number;
  readonly source: string;
  readonly callName: string;
} | null => {
  for (const node of ast.nodes) {
    if (node.kind === 'stack') {
      for (let i = 0; i < node.args.length; i += 1) {
        const arg = node.args[i];
        if (arg === undefined) continue;
        const name = argLeadingName(arg);
        if (name === null) continue;
        const lc = name.toLowerCase();
        if (!melodyLeadingNames.has(lc)) continue;
        const quoted = liftFirstQuotedString(argText(arg));
        if (quoted === null) continue;
        return { argIndex: i, source: quoted, callName: lc };
      }
      return null;
    }
    if (node.kind === 'call') {
      const lc = node.name.toLowerCase();
      if (!melodyLeadingNames.has(lc)) continue;
      const firstStr = node.args.find(
        (a) => a.kind === 'string',
      );
      if (firstStr === undefined || firstStr.kind !== 'string') continue;
      return { argIndex: -1, source: firstStr.value, callName: lc };
    }
  }
  return null;
};

/**
 * Lex a single line of mini-notation into a list of tokens.
 * Splits on whitespace; `~` and `.` are rests; anything that
 * looks like `[...]` (a chord) is kept as a single token.
 */
type LexToken = { readonly text: string; readonly isRest: boolean };

const lexMiniLine = (line: string): ReadonlyArray<LexToken> => {
  const out: LexToken[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === undefined) break;
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if (ch === '[') {
      const close = line.indexOf(']', i);
      if (close === -1) {
        out.push({ text: line.slice(i).trim(), isRest: false });
        break;
      }
      out.push({ text: line.slice(i, close + 1), isRest: false });
      i = close + 1;
      continue;
    }
    if (ch === '<' || ch === '>') {
      i += 1;
      continue;
    }
    let j = i;
    while (j < line.length) {
      const c = line[j];
      if (c === undefined) break;
      if (c === ' ' || c === '\t' || c === '[' || c === '<' || c === '>') break;
      j += 1;
    }
    const tok = line.slice(i, j);
    if (tok.length > 0) {
      const isRest = tok === '~' || tok === '.';
      out.push({ text: tok, isRest });
    }
    i = j;
  }
  return out;
};

type ParsedCol = { readonly midi: number | null };

/**
 * Parse a (single-line) mini-notation snippet into columns of
 * `(midi | null)` per step. Each token is one step.
 *
 *   - `c4`        → midi = 60
 *   - `~`         → null (rest)
 *   - `[c4 e4]`   → midi = 60 (lowest of the chord; chord ↔
 *                   step collapse is a documented lossy part
 *                   of the round-trip — see
 *                   `melodyToMini` which expands chords on
 *                   commit).
 */
const parseNoteArgs = (text: string): ReadonlyArray<ParsedCol> | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tokens = lexMiniLine(trimmed);
  if (tokens.length === 0) return null;

  const cols: ParsedCol[] = [];
  for (const t of tokens) {
    if (t.isRest) {
      cols.push({ midi: null });
      continue;
    }
    if (t.text.startsWith('[') && t.text.endsWith(']')) {
      const inner = t.text.slice(1, -1).trim();
      const pitches = inner.split(/\s+/).filter((s) => s.length > 0);
      const midis: number[] = [];
      for (const p of pitches) {
        const m = strudelNoteToMidi(p);
        if (Number.isFinite(m) && m >= 0) midis.push(m);
      }
      cols.push({ midi: midis.length === 0 ? null : Math.min(...midis) });
      continue;
    }
    const midi = strudelNoteToMidi(t.text);
    cols.push({
      midi: Number.isFinite(midi) && midi >= 0 ? Math.round(midi) : null,
    });
  }
  return cols;
};

/**
 * AST-based score → melody-grid cells.
 *
 * Pure. No Solid, no Effect. Walks the AST produced by
 * `parseScore` and looks for the first `note(…)` / `n(…)` call
 * reachable from the top level (with or without a surrounding
 * stack). Parses the call's first string arg as mini-notation
 * and emits `{ step, midi }` tuples (skipping rests and out-of-
 * range pitches).
 *
 * Returns `{ ok: true, cells, argIndex, noteName }` on success.
 * Returns `{ ok: false, reason, cells: [] }` on:
 *   - `empty-score`  — input is empty / whitespace
 *   - `no-note-call` — no top-level note(…) / n(…) reachable
 *
 * Out-of-range pitches (midi < 48 or > 83) are silently dropped
 * to keep the grid aligned with `MELODY_PITCH_RANGE`.
 */
export const extractMelodyFromScore = (score: string): ExtractResult => {
  if (score.trim() === '') {
    return { ok: false, reason: 'empty-score', cells: [] };
  }
  const ast = parseScore(score);
  const hit = findFirstNoteCall(ast);
  if (hit === null) {
    return { ok: false, reason: 'no-note-call', cells: [] };
  }
  const cols = parseNoteArgs(hit.source);
  if (cols === null) {
    return { ok: false, reason: 'no-note-call', cells: [] };
  }

  const cells: MelodyCell[] = [];
  for (let step = 0; step < cols.length && step < MELODY_COLS; step += 1) {
    const col = cols[step];
    if (col === undefined) continue;
    if (col.midi === null) continue;
    const midi = col.midi;
    if (!Number.isFinite(midi)) continue;
    if (midi < MELODY_PITCH_LOW || midi > MELODY_PITCH_HIGH) continue;
    cells.push({ step, midi });
  }
  return { ok: true, cells, argIndex: hit.argIndex, noteName: hit.callName };
};

/**
 * Format a melody (column-major sparse list) as a Strudel
 * mini-notation `<…>` line. Returns a non-empty string even for
 * an empty `melody` (yields `<~ ~ ~ … ~>` of length MELODY_COLS,
 * which Strudel plays as silence — useful as a placeholder).
 *
 * Truncates to `MELODY_COLS` columns; later columns are dropped.
 */
export const melodyToMini = (melody: ReadonlyArray<MelodyCell>): string => {
  const cols: string[] = [];
  for (let step = 0; step < MELODY_COLS; step += 1) {
    const ms = melody
      .filter((c) => c.step === step)
      .map((c) => c.midi)
      .sort((a, b) => a - b);
    if (ms.length === 0) {
      cols.push('~');
      continue;
    }
    const names = ms.map((m) => noteNumberToName(m).toLowerCase());
    if (names.length === 1) {
      cols.push(names[0]!);
    } else {
      cols.push(`[${names.join(' ')}]`);
    }
  }
  return `<${cols.join(' ')}>`;
};

/**
 * AST-based commit: rebuild the score with the first
 * `note(…)` / `n(…)` call's string arg replaced by a fresh
 * `<…>` mini-notation encoding `melody`. Everything else in
 * the score is preserved byte-for-byte (because
 * `replaceLayerSources` only touches the matched arg span).
 *
 * Pure. No Solid, no Effect.
 *
 *   score = stack(
 *     note("g3 b3 d4 b3"),    ← THIS arg gets replaced
 *     note("g2").s("sawtooth")...,
 *     s("drums_bd ~ …"),
 *   )
 *                       ↓
 *   score = stack(
 *     note("<c4 d4 e4 f4 g4 a4 b4 c5>").s("triangle"),
 *     note("g2").s("sawtooth")...,
 *     s("drums_bd ~ …"),
 *   )
 *
 * Returns `{ ok: false, reason: 'no-stack-target' }` when the
 * note-call is a top-level node (no surrounding stack to splice
 * into) — the caller should fall back to sketch mode in that
 * case (use `appendToTopStack`).
 */
export const commitMelodyToScore = (
  score: string,
  melody: ReadonlyArray<MelodyCell>,
  opts: CommitMelodyOptions = {},
): CommitMelodyResult => {
  if (score.trim() === '') {
    return { ok: false, reason: 'empty-score' };
  }
  const ast = parseScore(score);
  const hit = findFirstNoteCall(ast);
  if (hit === null) {
    return { ok: false, reason: 'no-note-call' };
  }
  if (hit.argIndex === -1) {
    // Bare top-level note-call — no stack to splice into. Caller
    // must use appendToTopStack + the new melody layer instead.
    return { ok: false, reason: 'no-stack-target' };
  }
  const instr = opts.instrument ?? MELODY_DEFAULT_INSTRUMENT;
  const minic = melodyToMini(melody);
  const newSource = `${hit.callName}("${minic}").s("${instr}")`;

  const res = replaceLayerSources(score, [
    { index: hit.argIndex, source: newSource },
  ]);
  if (!res.ok) {
    return { ok: false, reason: 'no-note-call' };
  }
  return { ok: true, score: res.score, replaced: res.replaced };
};

/**
 * Convenience: round-trip helper for tests. Takes `score`,
 * extracts the melody, applies `mutate` to the list, and
 * commits back. Returns `null` if either step fails.
 */
export const roundTripMelody = (
  score: string,
  mutate: (cells: MelodyCell[]) => MelodyCell[],
  opts: CommitMelodyOptions = {},
): string | null => {
  const extracted = extractMelodyFromScore(score);
  if (!extracted.ok) return null;
  const next = mutate([...extracted.cells]);
  const committed = commitMelodyToScore(score, next, opts);
  return committed.ok ? committed.score : null;
};

// Empty melody (re-exported for convenience).
export { emptyMelody } from './melodyGridTypes';
// Type re-export for state consumers.
export type { MelodyGrid } from './melodyGridTypes';

// Default BPM-based note arg index — `extractMelodyFromScore` uses
// MELODY_PITCH_RANGE; consumers can rely on `MELODY_PITCH_HIGH`
// re-export if they need it.
export { MELODY_PITCH_HIGH };
