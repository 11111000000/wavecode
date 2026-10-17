/**
 * pianoTranscribe — pure function turning a piano REC buffer into a
 * Strudel-score fragment via mini-notation.
 *
 * Inputs: a `ReadonlyArray<RecNote>` (midi + startMs + endMs from
 * `pianoRecStore.recBuffer`) and options `{ bpm, quantize, instrument }`.
 * Output: `{ score, summary }` where `score` is a Strudel score that
 * `replaceScore` + `evalScore(score)` can play immediately.
 *
 * Algorithm:
 *   1. Quantize each note's `startMs` to the nearest 1/16 grid
 *      (`60000 / bpm / 4` ms).
 *   2. Group notes by quantized time → columns. Notes in the same
 *      1/16 cell collapse to one chord.
 *   3. For each column: sort pitches low → high, dedupe (re-trigger
 *      within a cell). Single note → `c4`; ≥2 notes → `[c4 e4 g4]`.
 *   4. Wrap columns in Strudel mini-notation:
 *        - 1 column   → bare token (`note("c4")` or `note("[c4 e4 g4]")`)
 *        - N columns  → cat via `<>` (`note("<c4 [e4 g4] …>")`)
 *   5. Append `.s("<instrument>")` so the snippet uses the same
 *      timbre the user just played.
 *   6. Validate via the domain Strudel AST. If the parser surfaces
 *   no `CallNode`, fall back to `note("c4")` and report
 *   `summary.valid === false`.
 *
 * Pure: no side effects, no Solid, no Effect. The unit test file
 * covers ≥ 8 cases (empty, single, chord, sequence, quantize,
 * AST roundtrip, instrument, validation fallback).
 */

import { noteNumberToName, type PianoInstrument } from '~/domain/music/notes';
import { parseScore } from '~/domain/strudel';

/**
 * Minimum representation of a recorded note — mirrors
 * `pianoRecStore.RecNote` minus the `midi` alias (we keep the
 * domain field name `note` for clarity within the use-case module).
 * Kept structurally compatible so callers can map
 * `recBuffer.map((r) => ({ note: r.midi, startMs: r.startMs, endMs: r.endMs }))`.
 */
export type TranscribeNote = {
  readonly note: number;
  readonly startMs: number;
  readonly endMs: number;
};

export type TranscribeOptions = {
  /** Beats per minute. Used to derive the 1/16 grid width. */
  readonly bpm: number;
  /** Quantize resolution in divisions per cycle. Defaults to 16
   *  (= 1/16 notes). 8 and 4 are also supported for users who want
   *  coarser grids. */
  readonly quantize?: 16 | 8 | 4 | undefined;
  /** Strudel sample / waveform name appended as `.s("…")`. Required
   *  so the snippet plays the right timbre; defaults to "triangle"
   *  to match the pianoRecStore default instrument. */
  readonly instrument?: PianoInstrument | string | undefined;
};

export type TranscribeSummary = {
  /** Notes that survived the input filter (in-range, finite). */
  readonly notes: number;
  /** Distinct 1/16 cells occupied by the recording. */
  readonly columns: number;
  /** Beat count of the recording at the given BPM (rounded down). */
  readonly beats: number;
  /** True iff the generated score parses to a CallNode. False means
   *  the function fell back to `note("c4")`. */
  readonly valid: boolean;
};

export type TranscribeResult = {
  readonly score: string;
  readonly summary: TranscribeSummary;
};

/** Default BPM when the user hasn't supplied one. 120 BPM = 0.5 cps
 *  in Strudel terms (1 quarter per 2 cycles at the default 1-cycle-
 *  per-quarter rate). */
export const TRANSCRIBE_DEFAULT_BPM = 120;
/** Default quantize resolution. 16 = sixteenth-note grid; the most
 *  expressive choice that still groups accidental jitter. */
export const TRANSCRIBE_DEFAULT_QUANTIZE = 16 as const;
/** Default instrument passthrough. Matches pianoRecStore default
 *  (triangle wave — audible without a sample-bank lookup). */
export const TRANSCRIBE_DEFAULT_INSTRUMENT = 'triangle';

/** Compute grid width in ms for the given BPM and quantize. Throws
 *  if `bpm <= 0` (the caller should never pass a non-positive BPM,
 *  but the guard keeps us safe against future wiring bugs).
 *
 *  Convention: `quantize` is "divisions per quarter note" (the same
 *  convention Strudel uses for `<1/4>`, `<1/8>`, `<1/16>`). So:
 *    - `quantize: 4`  → 1/4-note grid → 60000 / bpm ms at 120 bpm = 500 ms
 *    - `quantize: 8`  → 1/8-note grid → 250 ms at 120 bpm
 *    - `quantize: 16` → 1/16-note grid → 125 ms at 120 bpm
 *  In general: `gridMs = (60000 / bpm) * 4 / quantize = 240000 / bpm / quantize`. */
const gridMsFor = (bpm: number, quantize: number): number => {
  if (!(bpm > 0)) {
    throw new Error(`pianoTranscribe: bpm must be > 0 (got ${bpm})`);
  }
  if (!(quantize > 0)) {
    throw new Error(`pianoTranscribe: quantize must be > 0 (got ${quantize})`);
  }
  return (240000 / bpm) / quantize;
};

/** Round `ms` to the nearest multiple of `gridMs`. */
const quantizeMs = (ms: number, gridMs: number): number =>
  Math.round(ms / gridMs) * gridMs;

/** Format a sorted, deduped MIDI column as a mini-notation token.
 *  Single note → `c4`; chord → `[c4 e4 g4]`. Order is ascending
 *  pitch (so the chord reads root → middle → top from left to
 *  right; standard music notation). */
const formatColumn = (midiList: ReadonlyArray<number>): string => {
  // Sort ascending, dedupe via Set (re-trigger within a 1/16 cell
  // collapses to a single pitch; the recorder already coalesces
  // such cases via the 30ms debounce, but the SET guard is the
  // last line of defense).
  const unique = Array.from(new Set(midiList)).sort((a, b) => a - b);
  const names = unique.map((m) => noteNumberToName(m).toLowerCase());
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `[${names.join(' ')}]`;
};

/**
 * Pure: convert a `RecNote`-shaped buffer to a Strudel-score fragment.
 *
 * @param notes  The recorded notes (midi + startMs + endMs).
 * @param options  `{ bpm, quantize?, instrument? }`.
 * @returns  `{ score, summary }`. Empty buffer → `{ score: '',
 *           summary: { notes: 0, columns: 0, beats: 0, valid: true } }`.
 *
 * Validation: the function ALWAYS returns a string. If the AST
 * parser surfaces no `CallNode` for our generated score, we fall
 * back to `note("c4")` and set `summary.valid = false` — this is
 * defensive against future parser regressions; in practice the
 * generator always produces a valid score.
 */
export const pianoTranscribe = (
  notes: ReadonlyArray<TranscribeNote>,
  options: TranscribeOptions,
): TranscribeResult => {
  const bpm = options.bpm;
  const quantize = options.quantize ?? TRANSCRIBE_DEFAULT_QUANTIZE;
  const instrument = options.instrument ?? TRANSCRIBE_DEFAULT_INSTRUMENT;

  if (notes.length === 0) {
    return {
      score: '',
      summary: { notes: 0, columns: 0, beats: 0, valid: true },
    };
  }

  const gridMs = gridMsFor(bpm, quantize);

  // Filter out invalid MIDI values (NaN, negative, > 127) — the
  // buffer is supposed to be clean but we guard against future
  // MIDI-127+ ranges from a hypothetical extended keyboard.
  const validNotes = notes.filter(
    (n) => Number.isFinite(n.note) && n.note >= 0 && n.note <= 127,
  );
  if (validNotes.length === 0) {
    return {
      score: '',
      summary: { notes: 0, columns: 0, beats: 0, valid: true },
    };
  }

  // Group by quantized start time. Map preserves insertion order
  // (V8 spec); we iterate in the order notes were recorded (i.e.
  // ascending startMs after quantize). Quantize rounds to the
  // nearest grid cell — small jitter from human timing or
  // audio-engine latency (< gridMs/2) collapses into the cell.
  const columnsByStart = new Map<number, number[]>();
  for (const note of validNotes) {
    const qStart = quantizeMs(note.startMs, gridMs);
    const list = columnsByStart.get(qStart);
    if (list === undefined) {
      columnsByStart.set(qStart, [note.note]);
    } else {
      list.push(note.note);
    }
  }

  // Sort columns by start time (ascending). Map iteration order in
  // V8 is insertion order, but insertion order itself is determined
  // by the order notes were recorded, which is already sorted by
  // startMs in our buffer (the recorder appends in chronological
  // order). Sorting here is defensive against out-of-order inputs
  // (e.g. tests or future MIDI-from-MIDI-file replay).
  const sortedColumns = Array.from(columnsByStart.entries()).sort(
    (a, b) => a[0] - b[0],
  );
  const tokens = sortedColumns
    .map(([, midis]) => formatColumn(midis))
    .filter((t) => t !== '');

  if (tokens.length === 0) {
    return {
      score: '',
      summary: { notes: validNotes.length, columns: 0, beats: 0, valid: true },
    };
  }

  // Single column → no cat wrapper (avoids the noise of
  // `<c4>` for a single note). Multiple columns → wrap in `<>`
  // so each column plays for one full Strudel cycle; the user
  // tunes cps to taste. Preview panel surfaces the relationship
  // `cps ≈ bpm / 60` for the recording tempo.
  const mini =
    tokens.length === 1
      ? tokens[0]!
      : `<${tokens.join(' ')}>`;

  const score = `note("${mini}").s("${instrument}")`;

  // Validate via the domain AST parser (wavecode-strudel-ast).
  // The parser never throws on malformed input — it falls back to
  // `OtherNode` — so the validation here is purely structural:
  // "did we get at least one CallNode at the top level?" If not,
  // something went wrong (likely a future parser regression);
  // surface a safe fallback + `valid: false` for the caller.
  const ast = parseScore(score);
  const hasCall = ast.nodes.some((n) => n.kind === 'call');
  if (!hasCall) {
    return {
      score: 'note("c4")',
      summary: {
        notes: validNotes.length,
        columns: sortedColumns.length,
        beats: Math.floor((sortedColumns.length * gridMs) / (60000 / bpm)),
        valid: false,
      },
    };
  }

  return {
    score,
    summary: {
      notes: validNotes.length,
      columns: sortedColumns.length,
      // Beat count = total grid span / quarter-note duration.
      // The first column starts at quantized time 0 (not the
      // first note's startMs — quantize may round to an earlier
      // cell, but the user expects rhythm from column 0). Use
      // the last column's quantized start as the end.
      beats: Math.max(
        1,
        Math.floor(
          (sortedColumns[sortedColumns.length - 1]![0] + gridMs) /
            (60000 / bpm),
        ),
      ),
      valid: true,
    },
  };
};

/**
 * Convenience: human-readable summary line for the toolbar.
 * `«16 нот → 4 столбцов, 1 бит»` or `«4 ноты → 4 столбца, 1 бит»`
 * (pluralization matches the existing Russian-language convention
 * in PianoToolbar.tsx).
 */
export const formatTranscribeSummary = (s: TranscribeSummary): string => {
  const noteWord = pluralRu(s.notes, 'нота', 'ноты', 'нот');
  const colWord = pluralRu(s.columns, 'столбец', 'столбца', 'столбцов');
  const beatWord = pluralRu(s.beats, 'бит', 'бита', 'битов');
  return `${s.notes} ${noteWord} → ${s.columns} ${colWord}, ${s.beats} ${beatWord}`;
};

/** Tiny Russian-pluralisation helper (kept local so we don't pull
 *  in `plural-ru` etc. for one call site). Mirrors the convention
 *  in `PianoToolbar.formatActiveLabel`. */
const pluralRu = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};