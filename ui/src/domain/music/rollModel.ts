/**
 * RollModel — what the piano roll draws.
 *
 * The note list alone ("midi + start + end") cannot show what a
 * score actually IS: a `cat` of sections, each section a `stack` of
 * layers, some of them drums. That structure is the arrangement, and
 * the roll has to show it, otherwise a chorus looks exactly like a
 * verse and the viewer cannot tell where the music changes.
 *
 * The model therefore carries:
 *
 *   - `layers`  — the rows of the arrangement (one per `stack`
 *     branch). A layer knows whether it is melody or drums, which
 *     sample it plays, and how loud it is.
 *   - `sections` — the `cat` items: the bars between which the
 *     arrangement changes. The roll draws them as bands.
 *   - `notes`   — the pitched events, each bound to its layer.
 *   - `hits`    — the drum events, each bound to its layer.
 *
 * The time axis is the score's own bars: one `cat` section is one
 * bar wide, exactly like the note events the extractor produces (see
 * `~/domain/music/noteEvents.ts`). The playhead lives in the same
 * coordinates (`~/domain/music/scoreTimeline.ts`).
 *
 * Pure — no Solid, no Effect, no DOM.
 */

import {
  argText,
  parseScore,
  type Arg,
  type CallNode,
  type ScoreAST,
  type ScoreNode,
} from '~/domain/strudel';
import {
  isMelodyFn,
  parseMiniSteps,
  splitTopLevelCommas,
} from './noteEvents';
import { noteNumberToName, strudelNoteToMidi } from '~/domain/music/notes';
import { scoreTimingFromAst } from './scoreTimeline';
import type { CycleBounds } from './noteEvents';

export type RollLayerKind = 'melody' | 'drum';

export type RollLayer = {
  /** Stable id: the layer path inside the score (`0`, `1`, `0.2`). */
  readonly id: string;
  /** Index of the layer inside its stack — the palette slot. */
  readonly slot: number;
  readonly kind: RollLayerKind;
  /** Short human label: the sample name, or the first pitches. */
  readonly label: string;
  /** Sample name for drum layers (`drums_bd`). */
  readonly sampleName: string | null;
  /** `.gain(...)` of the layer, when the score states one. */
  readonly gain: number | null;
};

export type RollNote = {
  readonly midi: number;
  readonly startCycle: number;
  readonly endCycle: number;
  readonly layerId: string;
};

export type RollHit = {
  readonly startCycle: number;
  readonly endCycle: number;
  readonly layerId: string;
  readonly sampleName: string;
};

export type RollSection = {
  readonly index: number;
  readonly startCycle: number;
  readonly endCycle: number;
  /** Layer ids that sound in this section. */
  readonly layerIds: ReadonlyArray<string>;
};

export type RollModel = {
  readonly notes: ReadonlyArray<RollNote>;
  readonly hits: ReadonlyArray<RollHit>;
  readonly layers: ReadonlyArray<RollLayer>;
  readonly sections: ReadonlyArray<RollSection>;
  /** One repetition of the pattern, in drawn bars (≥ 1). */
  readonly periodCycles: number;
  /** Global `.slow()` / `.fast()` factor (1 = the score runs 1:1). */
  readonly timeScale: number;
};

export const EMPTY_ROLL_MODEL: RollModel = {
  notes: [],
  hits: [],
  layers: [],
  sections: [],
  periodCycles: 1,
  timeScale: 1,
};

/**
 * X-axis bounds of the roll.
 *
 * `lo` is the pattern's phase 0 — the first bar of the repetition —
 * so the playhead (which lives in pattern coordinates) always has
 * somewhere to sit, even when the first bars carry no pitched notes
 * (drum-only `cat` sections).
 *
 * `hi` adds one bar of margin after the last bar of the repetition.
 */
export const rollCycleBounds = (model: RollModel): CycleBounds => {
  if (model.notes.length === 0 && model.hits.length === 0) return { lo: 0, hi: 16 };
  const period = Math.max(1, Math.round(model.periodCycles));
  return { lo: 0, hi: Math.max(period + 1, 4) };
};

// ---------------------------------------------------------------------------
//  Palette — the layer colours.
//
//  Melody layers get the cool half of the wheel, drums the warm one,
//  so "is this the bass or is this the hi-hat?" is answerable at a
//  glance without a legend. The slot (the layer's index inside its
//  stack) picks the hue, which keeps the same instrument the same
//  colour across the sections of a song.
// ---------------------------------------------------------------------------

const MELODY_COLORS: ReadonlyArray<string> = [
  'hsl(174 80% 60%)',   // cyan
  'hsl(265 75% 68%)',   // violet
  'hsl(205 85% 66%)',   // sky
  'hsl(150 65% 56%)',   // green
  'hsl(315 70% 66%)',   // magenta
  'hsl(45 75% 60%)',    // sand
];

const DRUM_COLORS: ReadonlyArray<string> = [
  'hsl(28 90% 60%)',    // amber
  'hsl(8 85% 62%)',     // orange-red
  'hsl(52 90% 60%)',    // yellow
  'hsl(340 75% 66%)',   // pink
  'hsl(12 70% 55%)',    // rust
  'hsl(75 65% 55%)',    // olive
];

export const layerColor = (layer: RollLayer): string => {
  const palette = layer.kind === 'drum' ? DRUM_COLORS : MELODY_COLORS;
  return palette[layer.slot % palette.length] ?? palette[0]!;
};

// ---------------------------------------------------------------------------
//  Extraction
// ---------------------------------------------------------------------------

type WalkState = {
  /** Current position on the drawn (bar) axis. */
  offset: number;
  readonly notes: RollNote[];
  readonly hits: RollHit[];
  readonly layers: Map<string, RollLayer>;
  readonly sections: RollSection[];
  /** Layer ids touched by the section currently being walked. */
  readonly sectionLayers: Set<string>;
};

const GAIN_RE = /\.gain\(\s*([\d.]+)\s*\)/u;

/** The text of a node's arguments, for the `.gain(...)` lookup. */
const argTextOf = (node: ScoreNode): string =>
  node.kind === 'call' || node.kind === 'stack'
    ? node.args.map((a) => argText(a)).join(' ')
    : '';

const layerIdOf = (path: ReadonlyArray<number>): string => path.join('.');

/** The `.gain(...)` stated for a layer, if any. */
const gainOf = (text: string): number | null => {
  const m = GAIN_RE.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
};

/** The `cat` items: a bracketed list is split, a plain arg list is used as is. */
const catItems = (node: CallNode): ReadonlyArray<string> => {
  const items: string[] = [];
  for (const arg of node.args) {
    const text = argText(arg);
    if (!text) continue;
    let body = text.trim();
    if (body.startsWith('[') && body.endsWith(']')) {
      body = body.slice(1, -1);
    }
    for (const chunk of splitTopLevelCommas(body)) {
      const trimmed = chunk.trim();
      if (trimmed) items.push(trimmed);
    }
  }
  return items;
};

const registerLayer = (
  st: WalkState,
  path: ReadonlyArray<number>,
  kind: RollLayerKind,
  label: string,
  sampleName: string | null,
  gain: number | null,
): string => {
  const id = layerIdOf(path);
  st.sectionLayers.add(id);
  if (!st.layers.has(id)) {
    st.layers.set(id, {
      id,
      slot: path.length > 0 ? path[path.length - 1]! : 0,
      kind,
      label,
      sampleName,
      gain,
    });
  }
  return id;
};

const walkText = (
  text: string,
  path: ReadonlyArray<number>,
  st: WalkState,
  gain: number | null,
): number => {
  if (!text) return 0;
  let ast: ScoreAST;
  try {
    ast = parseScore(text);
  } catch {
    return 0;
  }
  let span = 0;
  for (const node of ast.nodes) {
    span = Math.max(span, walkNode(node, path, st, gain));
  }
  return span;
};

const walkArg = (
  arg: Arg,
  path: ReadonlyArray<number>,
  st: WalkState,
): number => {
  const text = argText(arg);
  // The branch text carries the whole chain: `note(...).gain(0.16)`.
  return walkText(text, path, st, gainOf(text));
};

const walkNode = (
  node: ScoreNode,
  path: ReadonlyArray<number>,
  st: WalkState,
  gain: number | null,
): number => {
  if (node.kind === 'stack') {
    // Every branch of a stack is its own layer: the arrangement's rows.
    let span = 0;
    node.args.forEach((arg, index) => {
      span = Math.max(span, walkArg(arg, [...path, index], st));
    });
    return span === 0 ? 1 : span;
  }
  if (node.kind !== 'call') return 0;
  const lc = node.name.toLowerCase();
  if (lc === 'cat') {
    // A cat is the song's section list: each item is a section.
    let span = 0;
    const items = catItems(node);
    items.forEach((item) => {
      const start = st.offset;
      st.sectionLayers.clear();
      const itemSpan = walkText(item, path, st, gainOf(item));
      const end = start + itemSpan;
      st.offset = end;
      st.sections.push({
        index: st.sections.length,
        startCycle: start,
        endCycle: end,
        layerIds: [...st.sectionLayers],
      });
      span += itemSpan;
    });
    return span === 0 ? 1 : span;
  }
  if (isMelodyFn(node.name)) {
    return walkMelody(node, path, st, gain);
  }
  if (lc === 's') {
    return walkDrums(node, path, st, gain);
  }
  // A modifier wrapper (`gain(...)`, `lpf(...)`, `slow(...)`, ...):
  // the pattern lives in one of its arguments.
  let span = 0;
  for (const arg of node.args) {
    span = Math.max(span, walkArg(arg, path, st));
  }
  return span === 0 ? 1 : span;
};

const walkMelody = (
  node: CallNode,
  path: ReadonlyArray<number>,
  st: WalkState,
  gain: number | null,
): number => {
  const first = node.args[0];
  if (first === undefined || first.kind !== 'string') return 1;
  const steps = parseMiniSteps(first.value);
  const pitches = steps
    .map((step) => ({ ...step, midi: noteTokenToMidi(step.token) }))
    .filter((step) => step.midi !== null);
  const label = pitches.length > 0
    ? noteNumberToName(pitches[0]!.midi!)
    : 'note';
  const layerId = registerLayer(st, path, 'melody', label, null, gain);
  for (const step of pitches) {
    st.notes.push({
      midi: step.midi!,
      startCycle: st.offset + step.start,
      endCycle: st.offset + step.end,
      layerId,
    });
  }
  return 1;
};

const walkDrums = (
  node: CallNode,
  path: ReadonlyArray<number>,
  st: WalkState,
  gain: number | null,
): number => {
  const first = node.args[0];
  if (first === undefined || first.kind !== 'string') return 1;
  const steps = parseMiniSteps(first.value).filter(
    (step) => step.token !== '~' && step.token !== '-',
  );
  const sampleName = steps.length > 0 ? steps[0]!.token : 'sample';
  const layerId = registerLayer(st, path, 'drum', sampleName, sampleName, gain);
  for (const step of steps) {
    st.hits.push({
      startCycle: st.offset + step.start,
      endCycle: st.offset + step.end,
      layerId,
      sampleName: step.token,
    });
  }
  return 1;
};

/** Resolve a pitch token (`c4`, `f#3`) to a MIDI number, or null. */
const noteTokenToMidi = (token: string): number | null => {
  const base = token.replace(/\*[\d.]*$/u, '').trim();
  if (!base || base === '~' || base === '-') return null;
  const midi = strudelNoteToMidi(base);
  return Number.isNaN(midi) ? null : midi;
};

/**
 * Build the roll model of a score.
 */
export const extractRollModel = (score: string): RollModel => {
  if (!score || !score.trim()) return EMPTY_ROLL_MODEL;
  let ast: ScoreAST;
  try {
    ast = parseScore(score);
  } catch {
    return EMPTY_ROLL_MODEL;
  }
  const st: WalkState = {
    offset: 0,
    notes: [],
    hits: [],
    layers: new Map(),
    sections: [],
    sectionLayers: new Set(),
  };
  for (const node of ast.nodes) {
    walkNode(node, [], st, gainOf(argTextOf(node)));
  }
  // The layer order is the order of appearance — the draw order of the
  // drum lanes and the legend.
  const layers = [...st.layers.values()];
  const timing = scoreTimingFromAst(ast);
  return {
    notes: st.notes,
    hits: st.hits,
    layers,
    sections: st.sections,
    periodCycles: timing.periodCycles,
    timeScale: timing.timeScale,
  };
};
