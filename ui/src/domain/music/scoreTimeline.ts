/**
 * ScoreTimeline — the coordinate system the piano roll draws in.
 *
 * The roll shows ONE repetition of the score along the X axis, laid
 * out in the score's own ("nominal") cycle coordinates: the note
 * events extracted from the score text, one bar per `cat` section.
 *
 * Two facts about the score are needed to place a playhead on that
 * axis, and neither is available from the note events alone:
 *
 *   1. `periodCycles` — how many bars one repetition of the pattern
 *      lasts. The pattern is cyclic in Strudel (a `cat` of N
 *      sections repeats forever), so the playhead has to wrap at the
 *      period instead of running off the right edge.
 *
 *   2. `timeScale` — the global `.slow(f)` / `.fast(f)` factor. A
 *      slowed pattern advances slower on the scheduler clock, so the
 *      playhead must advance slower on the drawn axis too, or it
 *      would drift away from the notes it is supposed to mark.
 *
 * Everything here is pure: no Solid, no Effect, no DOM.
 *
 * The score's own coordinates are the ones the note events already
 * use, so the playhead and the notes share one coordinate system by
 * construction — the playhead cannot drift out of the drawing area
 * and cannot point at a bar that does not exist.
 */

import type { NoteEvent } from '~/domain/midi/encoder';
import {
  argText,
  parseScore,
  type Arg,
  type ScoreAST,
  type ScoreNode,
} from '~/domain/strudel';
import {
  extractNoteEventsFromAst,
  isMelodyFn,
  splitTopLevelCommas,
  type CycleBounds,
} from './noteEvents';

export type ScoreTimeline = {
  /** Note events in the score's own (nominal) cycle coordinates. */
  readonly events: ReadonlyArray<NoteEvent>;
  /** One repetition of the pattern, in drawn bars (≥ 1). */
  readonly periodCycles: number;
  /** Global `.slow()` / `.fast()` factor (1 = the score runs 1:1). */
  readonly timeScale: number;
};

export const EMPTY_TIMELINE: ScoreTimeline = {
  events: [],
  periodCycles: 1,
  timeScale: 1,
};

/**
 * Length of one `cat` section, in drawn bars.
 *
 * The extractor places every `cat` item one bar apart
 * (`CAT_CYCLE_STEP = 1`), so the drawn model is "one bar per section"
 * — the period of a `cat` with N items is N bars, and the same N
 * decides where the playhead wraps.
 *
 * A `cat` can be written two ways and both have to count the same:
 *
 *   cat(a, b, c)          → three args, three sections
 *   cat([a, b, c])        → one arg holding a bracketed list, three
 *                           sections (the extractor splits the list by
 *                           top-level commas — same split here)
 */
const catPeriod = (node: ScoreNode): number => {
  if (node.kind !== 'call') return 1;
  let sections = 0;
  for (const arg of node.args) {
    const text = argText(arg);
    if (!text) continue;
    let body = text.trim();
    if (body.startsWith('[') && body.endsWith(']')) {
      body = body.slice(1, -1);
    }
    sections += Math.max(1, splitTopLevelCommas(body).length);
  }
  return Math.max(1, sections);
};

const periodOfArg = (arg: Arg): number => {
  const text = argText(arg);
  if (!text) return 0;
  let ast: ScoreAST;
  try {
    ast = parseScore(text);
  } catch {
    return 0;
  }
  let period = 0;
  for (const node of ast.nodes) {
    period = Math.max(period, periodOfNode(node));
  }
  return period;
};

const periodOfNode = (node: ScoreNode): number => {
  if (node.kind === 'stack') {
    let period = 0;
    for (const arg of node.args) {
      period = Math.max(period, periodOfArg(arg));
    }
    return period;
  }
  if (node.kind === 'call') {
    const lc = node.name.toLowerCase();
    if (lc === 'cat') return catPeriod(node);
    if (isMelodyFn(node.name)) return 1;
    // `s(...)` (one bar of samples) and any modifier wrapper
    // (`slow(...)`, `gain(...)`, ...) inherit the span of their args.
    let period = 0;
    for (const arg of node.args) {
      period = Math.max(period, periodOfArg(arg));
    }
    return period;
  }
  return 0;
};

/**
 * Global time scale of the score.
 *
 * `cat([...]).slow(1.3)` parses into a `cat` node plus a sibling
 * `slow` node (the tokenizer splits the method chain), and
 * `slow(1.3, cat([...]))` parses into a single `slow` node whose
 * first argument is the factor. Both shapes are covered here: any
 * `slow` / `fast` call at the top level of the score scales the whole
 * pattern.
 *
 * A `slow` nested inside a `stack` branch is NOT counted — it scales
 * that branch only, and the drawn model does not stretch it either.
 */
const timeScaleOfAst = (ast: ScoreAST): number => {
  let scale = 1;
  for (const node of ast.nodes) {
    if (node.kind !== 'call') continue;
    const lc = node.name.toLowerCase();
    if (lc !== 'slow' && lc !== 'fast') continue;
    const numeric = node.args.find((a) => a.kind === 'number');
    if (numeric === undefined) continue;
    const value = Number(numeric.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    scale *= lc === 'slow' ? value : 1 / value;
  }
  return scale;
};

/**
 * Build the timeline of a score: its note events, the length of one
 * pattern repetition, and its global time scale.
 */
export const extractScoreTimeline = (score: string): ScoreTimeline => {
  if (!score || !score.trim()) return EMPTY_TIMELINE;
  let ast: ScoreAST;
  try {
    ast = parseScore(score);
  } catch {
    return EMPTY_TIMELINE;
  }
  const events = extractNoteEventsFromAst(ast);
  let periodCycles = 1;
  for (const node of ast.nodes) {
    periodCycles = Math.max(periodCycles, periodOfNode(node));
  }
  return {
    events,
    periodCycles,
    timeScale: timeScaleOfAst(ast),
  };
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
export const timelineCycleBounds = (timeline: ScoreTimeline): CycleBounds => {
  if (timeline.events.length === 0) return { lo: 0, hi: 16 };
  const period = Math.max(1, Math.round(timeline.periodCycles));
  return { lo: 0, hi: Math.max(period + 1, 4) };
};

/**
 * Position of the playhead inside the pattern, in drawn bars.
 *
 * `absoluteCycle` is the scheduler's own cycle counter (see
 * `AudioEngine.getCyclePosition`) — it grows monotonically while the
 * pattern repeats. Dividing by the time scale converts scheduler
 * cycles into the score's own bars (a pattern slowed by 1.3 advances
 * 1/1.3 of a bar per scheduler cycle), and the modulo wraps at the
 * period of one repetition.
 */
export const playheadPhase = (
  absoluteCycle: number,
  timeScale: number,
  periodCycles: number,
): number => {
  if (!Number.isFinite(absoluteCycle) || absoluteCycle <= 0) return 0;
  const scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
  const period = Number.isFinite(periodCycles) && periodCycles > 0 ? periodCycles : 1;
  const phase = (absoluteCycle / scale) % period;
  return phase < 0 ? phase + period : phase;
};
