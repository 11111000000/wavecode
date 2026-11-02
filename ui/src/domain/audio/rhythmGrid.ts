/**
 * rhythmGrid — pure helpers that turn detected onsets into a
 * bar-aligned drum grid and a Strudel snippet.
 *
 * Why this module exists
 * ----------------------
 * The transient detector (`transient.ts`) answers "WHEN did a hit
 * happen" — it knows nothing about bars, steps or tempo. The step
 * grid (`domain/music/gridTypes.ts`) answers "WHERE does a hit sit
 * in the bar" but only for cells the user tapped by hand. The gap
 * between the two is exactly what a recorded rhythm needs: take a
 * list of millisecond timestamps and place them on the grid the rest
 * of the score lives on.
 *
 * The app's time convention (see `domain/presets.ts`):
 *   - 1 cycle = 1 bar = 4 beats
 *   - the transport's `cps` is cycles per second (default 0.5 →
 *     2 s per bar → 120 BPM)
 *   - a 16-step grid = 16th notes, so 4 steps per beat
 *
 * Everything below is pure: no Web APIs, no Solid, no Strudel
 * imports. The presentation layer supplies the timestamps and the
 * transport tempo; this module owns the arithmetic.
 *
 * Glossary:
 *   - step      = one 16th-note slot (16 per bar)
 *   - bar       = 16 steps = 1 cycle
 *   - row       = one of the four drum voices (bd / sd / hh / cp)
 *   - origin    = the timestamp of the FIRST hit — the take's downbeat
 */

import type { OnsetType, Transient } from './transient';

/** Steps per bar (16th notes). 16 steps = 4 beats = 1 cycle. */
export const RHYTHM_STEPS_PER_BAR = 16;

/**
 * The four drum rows, top to bottom. The same four voices as the
 * step grid (`domain/music/gridTypes.ts`) so a recorded rhythm and a
 * hand-tapped one live in the same vocabulary.
 */
export const RHYTHM_ROWS = ['bd', 'sd', 'hh', 'cp'] as const;

export type RhythmRow = (typeof RHYTHM_ROWS)[number];

/** Onset classification → drum row. The transient detector splits
 *  hits by spectral centroid; the grid keeps one row per voice. */
export const ONSET_TO_ROW: Readonly<Record<OnsetType, RhythmRow>> = {
  kick: 'bd',
  snare: 'sd',
  hat: 'hh',
  click: 'cp',
};

/** Drum row → Strudel sample name. The canonical `drums_*` names are
 *  used (not the bare `bd` aliases) so the emitted score reads the
 *  same as the bundled presets. */
export const ROW_TO_SAMPLE: Readonly<Record<RhythmRow, string>> = {
  bd: 'drums_bd',
  sd: 'drums_sd',
  hh: 'drums_hh',
  cp: 'drums_cp',
};

/** Transport tempo bounds. Below 0.05 cps a bar is 20 s long (the
 *  slider's own minimum is higher); above 10 cps a step is 6 ms
 *  (faster than the detector can resolve). Values outside the range
 *  are clamped rather than rejected — the transport is a slider, not
 *  a validated form field. */
export const MIN_CPS = 0.05;
export const MAX_CPS = 10;

export type RhythmGrid = {
  /** Four rows of `steps` cells; `true` = a hit on that step. */
  readonly rows: ReadonlyArray<ReadonlyArray<boolean>>;
  /** Steps per bar (16). */
  readonly stepsPerBar: number;
  /** How many whole bars the pattern spans (≥ 1). */
  readonly bars: number;
  /** Total steps in the pattern (`bars * stepsPerBar`). */
  readonly steps: number;
  /** Duration of one step in milliseconds (derived from the tempo). */
  readonly stepMs: number;
  /** Timestamp of the first hit — the pattern's downbeat. */
  readonly originMs: number;
  /** Hits that landed on a cell of their own. */
  readonly hitCount: number;
  /** Hits that shared a cell with an earlier hit (same voice, same
   *  step) — quantisation collapsed them into one. */
  readonly mergedHits: number;
};

/**
 * Duration of one step (a 16th note) at the given transport tempo.
 *
 * `cps` is cycles per second and one cycle is one bar of 16 steps:
 *
 *   stepMs = 1000 / (cps * 16)
 *
 * At the default 0.5 cps that is 125 ms — a 16th note at 120 BPM.
 */
export const stepMsForCps = (cps: number): number => {
  const safe = Number.isFinite(cps) && cps > 0
    ? Math.min(MAX_CPS, Math.max(MIN_CPS, cps))
    : 0.5;
  return 1000 / (safe * RHYTHM_STEPS_PER_BAR);
};

/**
 * Place the hits on the grid.
 *
 * The FIRST hit is the origin — it sits on step 0 (the downbeat of
 * the first bar) and every other hit is placed by its distance from
 * it. A hit therefore lands on the nearest step: the error is at
 * most half a step (62 ms at 120 BPM), which is the best a fixed
 * grid can do and exactly what "on the grid" means.
 *
 * The pattern spans whole bars: the last hit's bar is rounded up, so
 * the emitted snippet always has a whole number of bars and the
 * pattern lines up with the rest of the score bar for bar.
 *
 * Returns `null` for an empty hit list — the caller decides what an
 * empty rhythm means (nothing to commit).
 */
export const quantizeHitsToGrid = (
  transients: ReadonlyArray<Transient>,
  opts: {
    /** Duration of one step in ms. */
    readonly stepMs: number;
    /** Steps per bar; defaults to 16. */
    readonly stepsPerBar?: number;
  },
): RhythmGrid | null => {
  if (transients.length === 0) return null;
  const stepsPerBar = opts.stepsPerBar ?? RHYTHM_STEPS_PER_BAR;
  const stepMs = opts.stepMs > 0 ? opts.stepMs : stepMsForCps(0.5);

  // The origin is the EARLIEST hit, not the first in the array: the
  // buffer is append-only but a caller may hand over a re-sorted
  // list, and a "downbeat" that moves would move every step with it.
  let originMs = Infinity;
  for (const t of transients) {
    if (t.startMs < originMs) originMs = t.startMs;
  }
  if (!Number.isFinite(originMs)) return null;

  // First pass: where does each hit land?
  const placed: Array<{ readonly row: RhythmRow; readonly step: number }> = [];
  let maxStep = 0;
  for (const t of transients) {
    const raw = Math.round((t.startMs - originMs) / stepMs);
    const step = Math.max(0, raw);
    if (step > maxStep) maxStep = step;
    placed.push({ row: ONSET_TO_ROW[t.type], step });
  }

  const bars = Math.max(1, Math.ceil((maxStep + 1) / stepsPerBar));
  const steps = bars * stepsPerBar;
  const rows: boolean[][] = RHYTHM_ROWS.map(() => new Array<boolean>(steps).fill(false));

  let hitCount = 0;
  let mergedHits = 0;
  for (const p of placed) {
    const rowIndex = RHYTHM_ROWS.indexOf(p.row);
    const row = rows[rowIndex]!;
    if (row[p.step] === true) {
      mergedHits += 1;
      continue;
    }
    row[p.step] = true;
    hitCount += 1;
  }

  return {
    rows,
    stepsPerBar,
    bars,
    steps,
    stepMs,
    originMs,
    hitCount,
    mergedHits,
  };
};

/**
 * Render a grid as a Strudel snippet.
 *
 * One `s("…")` layer per drum voice that has hits, each row a
 * sequence of `steps` tokens (16 per bar, so one token = one 16th
 * note at the transport's tempo). A layer is omitted when the voice
 * is silent — an all-`~` row is noise in the score.
 *
 *   grid with bd on steps 0 and 8, sd on step 4, one bar
 *     → stack(
 *         s("drums_bd ~ ~ ~ ~ ~ ~ ~ drums_bd ~ ~ ~ ~ ~ ~ ~"),
 *         s("~ ~ ~ ~ drums_sd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~")
 *       )
 *
 * No `setCpm` is emitted: the pattern must play at the TRANSPORT's
 * tempo, otherwise the recorded rhythm would drift against the rest
 * of the score it was just spliced into.
 */
export const rhythmGridToSnippet = (grid: RhythmGrid): string | null => {
  const layers: string[] = [];
  for (let r = 0; r < grid.rows.length; r += 1) {
    const cells = grid.rows[r]!;
    if (!cells.some((on) => on)) continue;
    const sample = ROW_TO_SAMPLE[RHYTHM_ROWS[r]!]!;
    const tokens = cells.map((on) => (on ? sample : '~'));
    layers.push(`s("${tokens.join(' ')}")`);
  }
  if (layers.length === 0) return null;
  if (layers.length === 1) return layers[0]!;
  return `stack(\n  ${layers.join(',\n  ')}\n)`;
};

/**
 * Estimate the tempo the user tapped at, in BPM.
 *
 * The median inter-onset interval is treated as ONE beat (the usual
 * reading of a tapped pulse) and converted to BPM. Returns `null`
 * when there is not enough material to say anything.
 *
 * This is INFORMATION for the panel ("you tapped ~100 BPM, the grid
 * is 120 BPM"), not a decision input: the pattern is always placed on
 * the transport's grid.
 */
export const estimateTapTempoBpm = (
  transients: ReadonlyArray<Transient>,
): number | null => {
  if (transients.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < transients.length; i += 1) {
    const ioi = transients[i]!.startMs - transients[i - 1]!.startMs;
    if (ioi >= 30) intervals.push(ioi);
  }
  if (intervals.length === 0) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
  if (medianMs <= 0) return null;
  return 60000 / medianMs;
};
