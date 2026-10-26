import {
  Show, createSignal, onMount, onCleanup, createEffect, createMemo, batch,
  type JSX,
} from 'solid-js';
import { Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import {
  defaultMidiBounds,
  type MidiBounds,
  type CycleBounds,
} from '~/domain/music/noteEvents';
import { playheadPhase } from '~/domain/music/scoreTimeline';
import {
  EMPTY_ROLL_MODEL,
  extractRollModel,
  layerColor,
  rollCycleBounds,
  type RollLayer,
  type RollModel,
} from '~/domain/music/rollModel';
import type { NoteEvent } from '~/domain/midi/encoder';
import { evalScore } from '../state/audioActions';

/**
 * <Pianoroll /> — DAW-style score visualiser + editor.
 *
 * Visual:
 *   X axis: time, in the score's own `cycle` units (1 cycle = 1 bar).
 *           Shows ONE repetition of the pattern: bar 0 is the pattern's
 *           first bar, the axis ends one bar after the last one.
 *   Y axis: pitch, in MIDI numbers. Auto-fits, padded ±2 semitones.
 *
 * Playhead:
 *   The scheduler counts ABSOLUTE cycles (it keeps counting while the
 *   pattern repeats). The roll draws the score's own bars, so the
 *   position is converted before it is drawn: divide by the score's
 *   global time scale (`.slow(f)` makes the pattern advance slower)
 *   and wrap at the length of one repetition (`~/domain/music/
 *   scoreTimeline.ts`). Without that conversion the playhead is
 *   pinned to the first bar while the music plays on — the bug this
 *   component's playhead was born with.
 *
 * Interactivity:
 *   - Click on empty area      → fire `onChange(note("..."))` to add
 *                                 the nearest note at the click coords.
 *   - Click on an existing note → no-op in click handler (drag takes
 *                                 over if user moves the pointer).
 *   - Shift+click on a note     → delete it.
 *   - Drag a note               → move it to the cursor coords and
 *                                 write a fresh score (release fires
 *                                 `onChange`).
 *   - Wheel up/down             → pan Y axis (vertical scroll of piano
 *                                 rows); Ctrl+wheel → zoom
 *                                 (multiplies `pixelsPerSemitone`).
 *   - Shift+wheel               → pan X axis (horizontal scroll of cycle
 *                                 lanes).
 *
 * Architecture:
 *   - Canvas (HTML5, NOT SVG) for performance even with the dense
 *     Creep preset (160+ note events).
 *   - RAF loop drives the playhead — same pattern as StepGrid, but
 *     reading `getCyclePosition()` (absolute) instead of
 *     `getCycleProgress()` (fraction inside the current cycle).
 *   - Re-parse `score` is DEBOUNCED 350ms (matches VisualizerPanel's
 *     COMPILE_DEBOUNCE_MS). Click/drag edits do NOT debounce — they
 *     immediately overwrite via `onChange`.
 *
 * Props (read/write contract):
 *   - `score`:        Strudel score text. Re-parsed on change.
 *   - `onChange`:     Called when the user adds / moves / deletes a
 *                     note. Caller dispatches `replaceScore` and
 *                     (optionally) re-evaluates.
 *   - `onEval`:       Optional callback fired AFTER `onChange` for
 *                     additions/deletions so the parent can hot-swap
 *                     the scheduler without a full reload. Mirrors
 *                     StepGrid's `scheduleGridEdit` flow.
 */
export type PianorollProps = {
  readonly score: string;
  readonly onChange: (newScore: string) => void;
  readonly onEval?: ((newScore: string) => void) | undefined;
  readonly height?: number | undefined;
};

const NOTE_HEIGHT_PX = 14;
const LANE_BG_PAD_LEFT = 56;   // labels area (semitone name)
const LANE_BG_PAD_RIGHT = 8;
const RULER_HEIGHT_PX = 24;    // two lines: the section names + the cycles
const DRUM_LANE_PX = 13;       // the height of one drum lane
const MIN_PITCH_PX = 96;       // the pitch area never shrinks below this
const COMPILE_DEBOUNCE_MS = 350;

// =============================================================================
//  Palette — derived from a stable hash so the same s("…") always gets the
//  same colour across panels (visualiser ribbon palette matches).
// =============================================================================

const COLORS = {
  bg: '#0a0a0e',
  grid: 'rgba(255,255,255,0.06)',
  gridStrong: 'rgba(255,255,255,0.18)',
  rulerBg: 'rgba(255,255,255,0.04)',
  rulerText: 'rgba(255,255,255,0.45)',
  noteDefault: 'hsl(174 80% 60%)',
  noteHover: 'hsl(174 95% 75%)',
  noteHoverOverlay: 'rgba(255,255,255,0.35)',
  noteSelected: 'hsl(42 95% 65%)',
  notePlayhead: 'hsl(0 90% 65%)',
  playhead: 'rgba(255,80,80,0.85)',
  label: 'rgba(255,255,255,0.55)',
  labelBlack: 'rgba(255,255,255,0.25)',
  // The song's form: alternating section bands, a brighter band under
  // the playhead, and a hairline between the sections.
  sectionBand: 'rgba(255,255,255,0.035)',
  sectionBandAlt: 'rgba(255,255,255,0.012)',
  sectionBandActive: 'rgba(120,190,255,0.10)',
  sectionEdge: 'rgba(255,255,255,0.22)',
  sectionText: 'rgba(255,255,255,0.72)',
  drumLaneAlt: 'rgba(255,255,255,0.02)',
};

/**
 * How loud a layer looks. The score's own `.gain(...)` is the mix
 * level of the layer — a quiet hi-hat should LOOK quieter than the
 * kick, otherwise the roll flattens the arrangement it is supposed
 * to reveal.
 */
const alphaForGain = (gain: number | null): number => {
  if (gain === null || !Number.isFinite(gain)) return 1;
  return Math.max(0.45, Math.min(1, 0.45 + gain));
};

const SAMPLE_PALETTE: ReadonlyArray<string> = [
  'hsl(174 80% 60%)',  // cyan
  'hsl(42 95% 60%)',   // gold
  'hsl(330 85% 65%)',  // magenta
  'hsl(96 75% 60%)',   // lime
  'hsl(15 90% 60%)',   // orange
  'hsl(220 75% 65%)',  // sky
  'hsl(60 90% 60%)',   // yellow
  'hsl(290 70% 65%)',  // purple
];

/**
 * Stable hash → palette index. Same input always returns the same
 * colour, so the same `s("triangle")` row gets the same hue every
 * time the user opens the panel.
 */
const stableHash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
};

const colorForChannel = (channel: number, sampleName?: string | undefined): string => {
  if (sampleName !== undefined && sampleName.length > 0) {
    return SAMPLE_PALETTE[stableHash(sampleName) % SAMPLE_PALETTE.length]!;
  }
  // Default melodic notes share the cyan palette.
  void channel;
  return COLORS.noteDefault;
};

// =============================================================================
//  Coordinate projection — pure functions, easy to unit-test.
// =============================================================================

const midiToY = (midi: number, bounds: MidiBounds, h: number): number => {
  const range = Math.max(1, bounds.hi - bounds.lo);
  // High midi = top (small y), low midi = bottom (large y).
  return (bounds.hi - midi) / range * h;
};

/**
 * Cycle → X projection. Mirrors the drawing maths exactly (the label
 * gutter on the left, the right pad, the zoom factor) — a helper that
 * disagrees with the canvas is a trap for whoever tunes the view.
 */
const cycleToX = (
  cycle: number,
  bounds: CycleBounds,
  w: number,
  panX: number,
  zoomX: number,
): number => {
  const span = Math.max(1, bounds.hi - bounds.lo);
  const pxPerCycle = (w - LANE_BG_PAD_LEFT - LANE_BG_PAD_RIGHT) / span * zoomX;
  return LANE_BG_PAD_LEFT + (cycle - bounds.lo) * pxPerCycle + panX;
};

const midiName = (midi: number): string => {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
  return `${names[pc]}${oct}`;
};

const isBlackKey = (midi: number): boolean => {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
};

// =============================================================================
//  Score-mutation helpers — applied locally; the component doesn't know
//  the AST. We rebuild the score by re-using `eval/extract` if needed,
//  but for now we keep mutations minimal: append a fresh `note(...)` to
//  the end, or splice into the existing top-level stack/cat.
// =============================================================================

/**
 * Insert / replace / remove a `note(...)` row in the score, keeping
 * the rest of the score untouched. Returns the new score.
 *
 * Strategy (best-effort):
 *   - If the score has a top-level `stack(...)`, SPLICE the new note
 *     inside it (preserving existing layers). Splice is at the END
 *     (after the last existing layer) for additions; for deletions,
 *     we scan the stack args and remove the one matching the
 *     `matchSource` text.
 *   - If the score has no top-level stack, wrap it in `stack(
 *     <existing>, note(...) )` (or for deletion just rebuild without
 *     the matched row).
 *   - If the score is empty, return `note("...")` directly.
 *
 * `matchSource` is the verbatim text of a top-level stack arg that
 * the parent identified as the target. Used for moves and deletes
 * (positional click on a specific note row).
 */
export const applyNoteEdit = (
  score: string,
  intent:
    | { readonly kind: 'add'; readonly snippet: string }
    | { readonly kind: 'delete'; readonly matchSource: string }
    | {
      readonly kind: 'move';
      readonly matchSource: string;
      readonly snippet: string;
    },
): string => {
  if (intent.kind === 'add' && score.trim() === '') return intent.snippet;
  const hasTopStack = /^stack\s*\(/mu.test(score);
  if (!hasTopStack) {
    if (intent.kind === 'add') {
      const trimmed = score.trim();
      if (trimmed === '') return intent.snippet;
      return `stack(\n  ${trimmed},\n  ${intent.snippet}\n)`;
    }
    if (intent.kind === 'delete') {
      // Strip the matched row by line. Crude but defensive.
      const lines = score.split('\n');
      const filtered = lines.filter((l) => l.trim() !== intent.matchSource.trim());
      return filtered.join('\n').trim();
    }
    if (intent.kind === 'move') {
      const replaced = score.replace(intent.matchSource, intent.snippet);
      return replaced;
    }
  }
  // Top-level stack case: splice inside the closing paren.
  const openIdx = score.indexOf('stack(');
  const closeIdx = score.lastIndexOf(')');
  if (openIdx < 0 || closeIdx <= openIdx) {
    // Couldn't find a balanced stack — bail to wrap.
    return score + (intent.kind === 'add' ? `\nstack(\n  ${intent.snippet}\n)` : '');
  }
  const inner = score.slice(openIdx + 'stack('.length, closeIdx);
  if (intent.kind === 'add') {
    const head = inner.trimEnd();
    const needsComma = head !== '' && !head.trimEnd().endsWith(',');
    return `stack(${head}${needsComma ? ',' : ''}\n  ${intent.snippet}\n${inner.includes('\n') ? '' : ' '}})`;
  }
  if (intent.kind === 'delete') {
    // Replace the matched source (with surrounding whitespace + comma).
    const escaped = intent.matchSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const regex = new RegExp(`\\s*,?\\s*${escaped}\\s*,?\\s*`, 'u');
    const stripped = inner.replace(regex, ',\n').replace(/,\s*,/gu, ',');
    return `stack(${stripped.trim()})`;
  }
  // move: replace the matched source.
  const replaced = inner.replace(intent.matchSource, intent.snippet);
  return `stack(${replaced})`;
};

/**
 * Build a `note("c4")` (or `note("<c4 e4>")`) string for a single pitch
 * at a given cycle position. For now we emit a single-note mini — full
 * chord / sequence support is in scope but the MVP uses single-note
 * patterns (matches what pianoroll users expect when clicking).
 */
export const noteSnippet = (midi: number, startCycle: number, endCycle: number): string => {
  const lc = (() => {
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'] as const;
    return `${names[pc]}${oct}`;
  })();
  void startCycle;
  void endCycle;
  return `note("${lc}")`;
};

/**
 * The `Pianoroll` component.
 *
 * See the file header for the full interaction contract.
 */
export function Pianoroll(props: PianorollProps): JSX.Element {
  // ---- Tunable view state (zoom / pan) ----
  const [zoom, setZoom] = createSignal(1);
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  const [hoverNoteIdx, setHoverNoteIdx] = createSignal<number | null>(null);

  // ---- Reactive score state ----
  // The Pianoroll re-parses `props.score` debounced; the parsed
  // timeline drives the canvas. Edits write a new score via `onChange`
  // and the parent re-renders props.score (re-feeding the loop).
  //
  // The timeline carries more than the note events: the length of one
  // pattern repetition and the score's global time scale. Both are
  // needed to place the playhead — see `~/domain/music/scoreTimeline.ts`.
  const [roll, setRoll] = createSignal<RollModel>(EMPTY_ROLL_MODEL);
  const [scoreDigest, setScoreDigest] = createSignal(0);

  /**
   * The pitched events of the roll — the model's notes, projected onto
   * the shape the rest of the component expects.
   */
  const events = createMemo<ReadonlyArray<NoteEvent>>(() =>
    roll().notes.map((n) => ({
      midi: n.midi,
      startCycle: n.startCycle,
      endCycle: n.endCycle,
      velocity: 100,
      channel: 1,
    })),
  );

  // ---- Playhead state (RAF poll) ----
  const [playheadCycle, setPlayheadCycle] = createSignal(0);

  // ---- Canvas + container refs ----
  let canvas: HTMLCanvasElement | undefined;
  let container: HTMLDivElement | undefined;

  /**
   * The roll fills the space the layout gives it.
   *
   * A fixed height was clipped by the score column (the chat panel
   * docks below it), so the lowest pitches — the bass line — fell out
   * of sight. The canvas measures its own box instead, and a
   * ResizeObserver redraws when the layout changes.
   */
  const height = (): number => {
    if (props.height !== undefined) return props.height;
    return container?.clientHeight ?? 320;
  };
  const width = (): number => container?.clientWidth ?? 600;

  // ---- Debounced re-parse ----
  let parseTimer: number | undefined;
  createEffect(() => {
    const score = props.score;
    void score; // intentional: any change → re-parse
    if (parseTimer !== undefined) window.clearTimeout(parseTimer);
    parseTimer = window.setTimeout(() => {
      // Re-parse on next tick so a parent-driven score mutation
      // (from our own onChange) doesn't trigger a recursive loop.
      try {
        setRoll(extractRollModel(props.score));
      } catch {
        setRoll(EMPTY_ROLL_MODEL);
      }
    }, COMPILE_DEBOUNCE_MS);
  });
  createEffect(() => {
    // Increment digest when score string changes; signals downstream
    // that the parsed `events()` array is current.
    setScoreDigest((d) => d + 1);
  });
  onCleanup(() => {
    if (parseTimer !== undefined) window.clearTimeout(parseTimer);
  });

  // The canvas has no reactive size: redraw when the layout gives the
  // roll a different box. The observer only fires on a REAL size
  // change — the draw writes the canvas' own width/height attributes,
  // and reacting to those would be a feedback loop.
  const [sizeTick, setSizeTick] = createSignal(0);
  let resizeObserver: ResizeObserver | null = null;
  let lastSize = '';
  onMount(() => {
    if (typeof ResizeObserver === 'undefined' || container === undefined) return;
    resizeObserver = new ResizeObserver(() => {
      const size = `${container?.clientWidth ?? 0}x${container?.clientHeight ?? 0}`;
      if (size === lastSize) return;
      lastSize = size;
      setSizeTick((n) => n + 1);
    });
    resizeObserver.observe(container);
  });
  onCleanup(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  /** The drum layers of the score, in draw order. */
  const drumLayers = (): ReadonlyArray<RollLayer> =>
    roll().layers.filter((l) => l.kind === 'drum');

  /**
   * The vertical layout of the roll.
   *
   * The drum lanes sit UNDER THE RULER, not at the bottom: the bottom
   * of the roll is where the chat panel docks, and a lane hidden
   * behind a panel is a lane that does not exist. The top of the
   * canvas is always visible.
   */
  const rollLayout = (): {
    readonly drumTop: number;
    readonly drumBandH: number;
    readonly pitchTop: number;
    readonly pitchH: number;
  } => {
    const h = height();
    const lanes = drumLayers();
    // The drum band may not eat the pitch area: a squeezed roll keeps
    // its pitches, the lanes get thinner.
    const room = Math.max(0, h - RULER_HEIGHT_PX - MIN_PITCH_PX);
    const drumBandH = lanes.length === 0
      ? 0
      : Math.max(0, Math.min(DRUM_LANE_PX * lanes.length, h * 0.32, room));
    const pitchTop = RULER_HEIGHT_PX + drumBandH;
    return { drumTop: RULER_HEIGHT_PX, drumBandH, pitchTop, pitchH: h - pitchTop };
  };

  // ---- Compute bounding boxes ----
  const midiBounds = createMemo<MidiBounds>(() => defaultMidiBounds(events()));
  const cycleBounds = createMemo<CycleBounds>(() => rollCycleBounds(roll()));

  // ---- RAF loop for playhead ----
  let rafId: number | null = null;
  onMount(() => {
    const loop = (): void => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const a = yield* AudioEngine;
          return yield* a.getCyclePosition();
        }).pipe(Effect.provide(AppLayer)),
      ).then((p) => {
        // The scheduler counts absolute cycles; the roll draws the
        // score's own bars, so the position has to be converted into
        // the pattern's phase (time scale + period) — see
        // `playheadPhase`.
        const model = roll();
        setPlayheadCycle(playheadPhase(p, model.timeScale, model.periodCycles));
      }).catch(() => { /* keep last value on engine error */ });
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    onCleanup(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    });
  });

  // ---- Draw routine ----
  const draw = (): void => {
    const c = canvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = width();
    const h = height();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) {
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    const model = roll();
    const mb = midiBounds();
    const cb = cycleBounds();
    const spanCycles = Math.max(1, cb.hi - cb.lo);
    const zoomX = zoom();
    const pxPerCycle = (w - LANE_BG_PAD_LEFT - LANE_BG_PAD_RIGHT) / spanCycles * zoomX;
    void panY; // visual Y pan reserved for a future vertical-zoom enhancement
    const noteH = NOTE_HEIGHT_PX;
    const phase = playheadCycle();

    // The drum lanes live under the ruler, the pitches below them: a
    // `s("...")` row is a rhythm, not a pitch, and squeezing it into
    // the MIDI rows would make both unreadable.
    const layout = rollLayout();
    const lanes = model.layers.filter((l) => l.kind === 'drum');
    const pitchTop = layout.pitchTop;
    const pitchH = layout.pitchH;

    const xOf = (cycle: number): number =>
      LANE_BG_PAD_LEFT + (cycle - cb.lo) * pxPerCycle + panX();

    // ----- Section bands (the song's form) -----
    // Alternating shades make the `cat` sections visible at a glance;
    // the section under the playhead is brighter — "we are HERE".
    for (const section of model.sections) {
      const x0 = xOf(section.startCycle);
      const bw = Math.max(1, xOf(section.endCycle) - x0);
      ctx.fillStyle = section.index % 2 === 0
        ? COLORS.sectionBand
        : COLORS.sectionBandAlt;
      ctx.fillRect(x0, RULER_HEIGHT_PX, bw, h - RULER_HEIGHT_PX);
      if (phase >= section.startCycle && phase < section.endCycle) {
        ctx.fillStyle = COLORS.sectionBandActive;
        ctx.fillRect(x0, RULER_HEIGHT_PX, bw, h - RULER_HEIGHT_PX);
      }
    }
    // Section separators.
    ctx.strokeStyle = COLORS.sectionEdge;
    ctx.beginPath();
    for (const section of model.sections) {
      const x = xOf(section.startCycle);
      ctx.moveTo(x, RULER_HEIGHT_PX);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    // ----- Ruler (section names + cycle numbers) -----
    ctx.fillStyle = COLORS.rulerBg;
    ctx.fillRect(0, 0, w, RULER_HEIGHT_PX);
    ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
    ctx.textBaseline = 'middle';
    const labelEvery = spanCycles > 16 ? 4 : spanCycles > 8 ? 2 : 1;
    for (let cIdx = Math.ceil(cb.lo); cIdx <= cb.hi; cIdx += 1) {
      if (Math.floor(cIdx) % labelEvery !== 0) continue;
      const x = xOf(cIdx);
      ctx.fillStyle = COLORS.rulerText;
      ctx.fillText(`c${cIdx}`, x + 3, RULER_HEIGHT_PX - 6);
    }
    // The section names sit on the top line of the ruler.
    ctx.fillStyle = COLORS.sectionText;
    for (const section of model.sections) {
      const x = xOf(section.startCycle);
      ctx.fillText(`S${section.index + 1}`, x + 3, 6);
    }
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT_PX);
    ctx.lineTo(w, RULER_HEIGHT_PX);
    ctx.stroke();

    // ----- Horizontal grid (cycle lines) -----
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    for (let cIdx = Math.ceil(cb.lo); cIdx <= cb.hi; cIdx += 1) {
      const x = xOf(cIdx);
      ctx.moveTo(x, RULER_HEIGHT_PX);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    // ----- Vertical grid (semitone rows; black-key rows slightly darker) -----
    for (let midi = Math.floor(mb.lo); midi <= Math.ceil(mb.hi); midi += 1) {
      const y = pitchTop + midiToY(midi, mb, pitchH);
      ctx.strokeStyle = isBlackKey(midi) ? COLORS.labelBlack : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(LANE_BG_PAD_LEFT, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // ----- Side labels (semitone names) -----
    ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let midi = Math.floor(mb.lo); midi <= Math.ceil(mb.hi); midi += 1) {
      const y = pitchTop + midiToY(midi, mb, pitchH);
      ctx.fillStyle = isBlackKey(midi) ? COLORS.labelBlack : COLORS.label;
      ctx.fillText(midiName(midi), LANE_BG_PAD_LEFT - 4, y);
    }
    ctx.textAlign = 'left';

    // ----- Notes (one colour per layer of the arrangement) -----
    const layerById = new Map(model.layers.map((l) => [l.id, l]));
    const notes = model.notes;
    for (let i = 0; i < notes.length; i += 1) {
      const e = notes[i]!;
      const layer = layerById.get(e.layerId);
      const x0 = xOf(e.startCycle);
      const x1 = xOf(e.endCycle);
      const yMid = pitchTop + midiToY(e.midi, mb, pitchH);
      const yTop = yMid - noteH / 2;
      const noteW = Math.max(2, x1 - x0);
      // A quiet layer is drawn quieter — the score's own mix, visible.
      ctx.globalAlpha = layer === undefined ? 1 : alphaForGain(layer.gain);
      ctx.fillStyle = layer === undefined ? COLORS.noteDefault : layerColor(layer);
      ctx.fillRect(x0, yTop, noteW, noteH);
      ctx.globalAlpha = 1;
      if (i === hoverNoteIdx()) {
        ctx.fillStyle = COLORS.noteHoverOverlay;
        ctx.fillRect(x0, yTop, noteW, noteH);
      }
      // Highlight the note that's playing at the playhead position.
      if (phase >= e.startCycle && phase < e.endCycle) {
        ctx.fillStyle = COLORS.notePlayhead;
        ctx.fillRect(x0, yTop, noteW, noteH);
      }
    }

    // ----- Drum lanes (between the ruler and the pitches) -----
    if (lanes.length > 0) {
      const bandTop = layout.drumTop;
      const laneH = layout.drumBandH / lanes.length;
      ctx.strokeStyle = COLORS.gridStrong;
      ctx.beginPath();
      ctx.moveTo(0, bandTop);
      ctx.lineTo(w, bandTop);
      ctx.stroke();
      ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      lanes.forEach((layer, index) => {
        const y = bandTop + index * laneH;
        if (index % 2 === 1) {
          ctx.fillStyle = COLORS.drumLaneAlt;
          ctx.fillRect(LANE_BG_PAD_LEFT, y, w - LANE_BG_PAD_LEFT, laneH);
        }
        // The lane's name: the sample without its `drums_` prefix.
        ctx.fillStyle = layerColor(layer);
        ctx.fillText(
          layer.sampleName?.replace(/^drums_/u, '') ?? layer.label,
          LANE_BG_PAD_LEFT - 4,
          y + laneH / 2,
        );
        const hitH = Math.max(3, laneH - 4);
        for (const hit of model.hits) {
          if (hit.layerId !== layer.id) continue;
          const hx0 = xOf(hit.startCycle);
          const hw = Math.max(2, xOf(hit.endCycle) - hx0);
          ctx.globalAlpha = alphaForGain(layer.gain);
          ctx.fillStyle = layerColor(layer);
          ctx.fillRect(hx0, y + 2, hw, hitH);
          ctx.globalAlpha = 1;
          if (phase >= hit.startCycle && phase < hit.endCycle) {
            ctx.fillStyle = COLORS.notePlayhead;
            ctx.fillRect(hx0, y + 2, hw, hitH);
          }
        }
      });
      ctx.textAlign = 'left';
    }

    // ----- Playhead line -----
    const pxX = xOf(phase);
    ctx.strokeStyle = COLORS.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pxX, RULER_HEIGHT_PX);
    ctx.lineTo(pxX, h);
    ctx.stroke();
    ctx.lineWidth = 1;
  };

  // Re-draw on any state change. Solid runs createEffects synchronously
  // and `createEffect` chains signal reads → `draw` re-runs.
  createEffect(() => {
    // Touch every signal so this effect re-runs on any change.
    void events();
    void zoom();
    void panX();
    void panY();
    void playheadCycle();
    void hoverNoteIdx();
    void width();
    void height();
    void sizeTick();
    draw();
  });

  // ---- Mouse / wheel handlers ----
  type DragState =
    | { readonly kind: 'none' }
    | { readonly kind: 'pan'; readonly startX: number; readonly startY: number; readonly startPanX: number; readonly startPanY: number }
    | { readonly kind: 'note'; readonly idx: number; readonly startX: number; readonly startY: number; readonly origEvent: NoteEvent };
  let drag: DragState = { kind: 'none' };

  const clientToCycle = (cx: number): number => {
    const w = width();
    const cb = cycleBounds();
    const spanCycles = Math.max(1, cb.hi - cb.lo);
    const pxPerCycle = (w - LANE_BG_PAD_LEFT - LANE_BG_PAD_RIGHT) / spanCycles * zoom();
    return ((cx - LANE_BG_PAD_LEFT - panX()) / pxPerCycle) + cb.lo;
  };
  const clientToMidi = (cy: number): number => {
    const h = height();
    const mb = midiBounds();
    const frac = (cy - RULER_HEIGHT_PX) / (h - RULER_HEIGHT_PX);
    return Math.round(mb.hi - frac * (mb.hi - mb.lo));
  };

  const findNoteAt = (cx: number, cy: number): { readonly idx: number; readonly event: NoteEvent } | null => {
    const evts = events();
    const mb = midiBounds();
    const cb = cycleBounds();
    const w = width();
    const spanCycles = Math.max(1, cb.hi - cb.lo);
    const pxPerCycle = (w - LANE_BG_PAD_LEFT - LANE_BG_PAD_RIGHT) / spanCycles * zoom();
    const noteH = NOTE_HEIGHT_PX;
    const layout = rollLayout();
    for (let i = evts.length - 1; i >= 0; i -= 1) {
      const e = evts[i]!;
      const x0 = LANE_BG_PAD_LEFT + (e.startCycle - cb.lo) * pxPerCycle + panX();
      const x1 = LANE_BG_PAD_LEFT + (e.endCycle - cb.lo) * pxPerCycle + panX();
      const yMid = layout.pitchTop + midiToY(e.midi, mb, layout.pitchH);
      if (
        cx >= x0 && cx <= x1
        && cy >= yMid - noteH / 2 && cy <= yMid + noteH / 2
      ) {
        return { idx: i, event: e };
      }
    }
    return null;
  };

  const handleClick = (e: MouseEvent): void => {
    // Only fires when no drag occurred.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const hit = findNoteAt(cx, cy);
    if (hit !== null && e.shiftKey) {
      e.preventDefault();
      const snippet = `note("${midiName(hit.event.midi).toLowerCase()}")`;
      const newScore = applyNoteEdit(props.score, {
        kind: 'delete',
        matchSource: snippet,
      });
      props.onChange(newScore);
      const cb = props.onEval;
      if (cb !== undefined) cb(newScore);
      else void evalScore(newScore);
      return;
    }
    if (hit === null && cy > RULER_HEIGHT_PX) {
      // Click on empty area → add a note at the cursor coords.
      const cycle = clientToCycle(cx);
      const midi = clientToMidi(cy);
      const snippet = `note("${midiName(midi).toLowerCase()}")`;
      const newScore = applyNoteEdit(props.score, { kind: 'add', snippet });
      props.onChange(newScore);
      const cb = props.onEval;
      if (cb !== undefined) cb(newScore);
      else void evalScore(newScore);
      void cycle;
    }
  };

  const handleMouseDown = (e: MouseEvent): void => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (e.button === 1 || e.button === 2 || e.altKey) {
      // Pan with middle-click, right-click, or Alt+drag.
      e.preventDefault();
      drag = {
        kind: 'pan',
        startX: cx,
        startY: cy,
        startPanX: panX(),
        startPanY: panY(),
      };
      return;
    }
    const hit = findNoteAt(cx, cy);
    if (hit !== null) {
      drag = {
        kind: 'note',
        idx: hit.idx,
        startX: cx,
        startY: cy,
        origEvent: hit.event,
      };
    }
  };

  const handleMouseMove = (e: MouseEvent): void => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (drag.kind === 'none') {
      const hit = findNoteAt(cx, cy);
      setHoverNoteIdx(hit?.idx ?? null);
      return;
    }
    if (drag.kind === 'pan') {
      const dragPan = drag;
      const dx = cx - dragPan.startX;
      const dy = cy - dragPan.startY;
      batch(() => {
        setPanX(dragPan.startPanX + dx);
        setPanY(dragPan.startPanY + dy);
      });
      return;
    }
    if (drag.kind === 'note') {
      // Hover-track the moved note under the cursor but don't write
      // to the score until mouseup.
      const newMidi = clientToMidi(cy);
      const newCycle = clientToCycle(cx);
      const orig = drag.origEvent;
      if (Number.isFinite(newMidi) && newMidi >= 0 && newMidi <= 127) {
        // Visually track: not implemented in MVP (would mutate
        // events() reactively). We DO write the score on release.
        void orig;
        void newCycle;
      }
    }
  };

  const handleMouseUp = (e: MouseEvent): void => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cy = e.clientY - rect.top;
    void e;
    if (drag.kind === 'note') {
      const newMidi = clientToMidi(cy);
      const origMidi = drag.origEvent.midi;
      if (
        Number.isFinite(newMidi)
        && newMidi >= 0
        && newMidi <= 127
        && newMidi !== origMidi
      ) {
        const snippet = `note("${midiName(newMidi).toLowerCase()}")`;
        const oldSnippet = `note("${midiName(origMidi).toLowerCase()}")`;
        const newScore = applyNoteEdit(props.score, {
          kind: 'move',
          matchSource: oldSnippet,
          snippet,
        });
        props.onChange(newScore);
        const cb = props.onEval;
        if (cb !== undefined) cb(newScore);
        else void evalScore(newScore);
      }
    }
    drag = { kind: 'none' };
  };

  const handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom — multiplier 1.1 per wheel notch.
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setZoom((z) => Math.max(0.25, Math.min(8, z * factor)));
      return;
    }
    if (e.shiftKey) {
      // Shift+wheel → pan horizontally along time.
      setPanX((x) => x - e.deltaY * 0.5);
      return;
    }
    // Plain wheel → pan vertically along pitch.
    setPanY((y) => y - e.deltaY * 0.2);
  };

  const isEmpty = (): boolean => events().length === 0 && roll().hits.length === 0;

  return (
    <div
      class="pianoroll-host"
      data-empty={isEmpty() ? 'true' : 'false'}
      data-event-count={events().length}
      data-score-digest={scoreDigest()}
      data-playhead-cycle={playheadCycle().toFixed(4)}
      data-period-cycles={roll().periodCycles}
      data-section-count={roll().sections.length}
      data-layer-count={roll().layers.length}
      data-hit-count={roll().hits.length}
      style={props.height === undefined ? undefined : { height: `${props.height}px` }}
    >
      <div class="pianoroll-toolbar">
        <span class="pianoroll-count">
          {events().length} note{events().length === 1 ? '' : 's'}
          {roll().hits.length > 0 ? ` · ${roll().hits.length} hit${roll().hits.length === 1 ? '' : 's'}` : ''}
          {` · ${roll().layers.length} layer${roll().layers.length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          class="pianoroll-zoom-btn"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.25, z * 0.8))}
        >
          −
        </button>
        <span class="pianoroll-zoom-value">{zoom().toFixed(2)}×</span>
        <button
          type="button"
          class="pianoroll-zoom-btn"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
        >
          +
        </button>
        <button
          type="button"
          class="pianoroll-zoom-btn"
          aria-label="Reset zoom"
          onClick={() => batch(() => { setZoom(1); setPanX(0); setPanY(0); })}
        >
          ⌂ reset
        </button>
      </div>
      <div
        class="pianoroll-canvas-wrap"
        ref={container}
      >
        <canvas
          ref={canvas}
          class="pianoroll-canvas"
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            drag = { kind: 'none' };
            setHoverNoteIdx(null);
          }}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          data-testid="pianoroll-canvas"
          aria-label="Piano roll — click to add notes, drag to move, Shift+click to delete"
        />
        <Show when={isEmpty()}>
          <div class="pianoroll-empty" aria-hidden="true">
            <p>Edit a <code>note(...)</code> to see events here</p>
            <p>Click to add · Drag to move · Shift+click to delete · Ctrl+wheel to zoom</p>
          </div>
        </Show>
      </div>
    </div>
  );
}

/** Helpers re-exported for tests (re-exports from noteEvents). */
export {
  extractNoteEvents,
  defaultMidiBounds,
  defaultCycleBounds,
} from '~/domain/music/noteEvents';
export type { MidiBounds, CycleBounds } from '~/domain/music/noteEvents';
export const _internal = {
  midiToY,
  cycleToX,
  midiName,
  isBlackKey,
  colorForChannel,
  stableHash,
  COMPILE_DEBOUNCE_MS,
};
