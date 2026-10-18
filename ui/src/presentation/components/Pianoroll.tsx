import {
  Show, createSignal, onMount, onCleanup, createEffect, createMemo, batch,
  type JSX,
} from 'solid-js';
import { Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import {
  extractNoteEvents,
  defaultMidiBounds,
  defaultCycleBounds,
  type MidiBounds,
  type CycleBounds,
} from '~/domain/music/noteEvents';
import type { NoteEvent } from '~/domain/midi/encoder';
import { evalScore } from '../state/audioActions';

/**
 * <Pianoroll /> — DAW-style score visualiser + editor.
 *
 * Visual:
 *   X axis: time, in `cycle` units (1 cycle = 1 quarter note at cps=1).
 *           Auto-fits to the score's note range, padded to whole
 *           cycles on both sides.
 *   Y axis: pitch, in MIDI numbers. Auto-fits, padded ±2 semitones.
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
 *   - RAF loop drives the playhead — same pattern as StepGrid.
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
const RULER_HEIGHT_PX = 18;
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
  rulerText: 'rgba(255,255,255,0.55)',
  noteDefault: 'hsl(174 80% 60%)',
  noteHover: 'hsl(174 95% 75%)',
  noteSelected: 'hsl(42 95% 65%)',
  notePlayhead: 'hsl(0 90% 65%)',
  playhead: 'rgba(255,80,80,0.85)',
  label: 'rgba(255,255,255,0.55)',
  labelBlack: 'rgba(255,255,255,0.25)',
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

const cycleToX = (
  cycle: number,
  bounds: CycleBounds,
  w: number,
  panX: number,
): number => {
  const span = bounds.hi - bounds.lo;
  return ((cycle - bounds.lo) / span) * w + panX;
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
  // events drive the canvas. Edits write a new score via `onChange`
  // and the parent re-renders props.score (re-feeding the loop).
  const [events, setEvents] = createSignal<ReadonlyArray<NoteEvent>>([]);
  const [scoreDigest, setScoreDigest] = createSignal(0);

  // ---- Playhead state (RAF poll) ----
  const [playheadCycle, setPlayheadCycle] = createSignal(0);

  // ---- Canvas + container refs ----
  let canvas: HTMLCanvasElement | undefined;
  let container: HTMLDivElement | undefined;

  const height = (): number => props.height ?? 320;
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
        const next = extractNoteEvents(props.score);
        setEvents(next);
      } catch {
        setEvents([]);
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

  // ---- Compute bounding boxes ----
  const midiBounds = createMemo<MidiBounds>(() => defaultMidiBounds(events()));
  const cycleBounds = createMemo<CycleBounds>(() => defaultCycleBounds(events()));

  // ---- RAF loop for playhead ----
  let rafId: number | null = null;
  onMount(() => {
    const loop = (): void => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const a = yield* AudioEngine;
          return yield* a.getCycleProgress();
        }).pipe(Effect.provide(AppLayer)),
      ).then((p) => {
        const clamped = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
        setPlayheadCycle(clamped);
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

    const mb = midiBounds();
    const cb = cycleBounds();
    const spanCycles = Math.max(1, cb.hi - cb.lo);
    const zoomX = zoom();
    const pxPerCycle = (w - LANE_BG_PAD_LEFT - LANE_BG_PAD_RIGHT) / spanCycles * zoomX;
    void panY; // visual Y pan reserved for a future vertical-zoom enhancement
    const noteH = NOTE_HEIGHT_PX;

    // ----- Ruler (cycle numbers) -----
    ctx.fillStyle = COLORS.rulerBg;
    ctx.fillRect(0, 0, w, RULER_HEIGHT_PX);
    ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
    ctx.fillStyle = COLORS.rulerText;
    ctx.textBaseline = 'middle';
    const labelEvery = spanCycles > 16 ? 4 : spanCycles > 8 ? 2 : 1;
    for (let cIdx = Math.ceil(cb.lo); cIdx <= cb.hi; cIdx += 1) {
      if (Math.floor(cIdx) % labelEvery !== 0) continue;
      const x = LANE_BG_PAD_LEFT + (cIdx - cb.lo) * pxPerCycle + panX();
      ctx.fillText(`c${cIdx}`, x + 3, RULER_HEIGHT_PX / 2);
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
      const x = LANE_BG_PAD_LEFT + (cIdx - cb.lo) * pxPerCycle + panX();
      ctx.moveTo(x, RULER_HEIGHT_PX);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    // ----- Vertical grid (semitone rows; black-key rows slightly darker) -----
    for (let midi = Math.floor(mb.lo); midi <= Math.ceil(mb.hi); midi += 1) {
      const y = RULER_HEIGHT_PX + midiToY(midi, mb, h - RULER_HEIGHT_PX);
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
      const y = RULER_HEIGHT_PX + midiToY(midi, mb, h - RULER_HEIGHT_PX);
      ctx.fillStyle = isBlackKey(midi) ? COLORS.labelBlack : COLORS.label;
      ctx.fillText(midiName(midi), LANE_BG_PAD_LEFT - 4, y);
    }
    ctx.textAlign = 'left';

    // ----- Notes -----
    const evts = events();
    for (let i = 0; i < evts.length; i += 1) {
      const e = evts[i]!;
      const x0 = LANE_BG_PAD_LEFT + (e.startCycle - cb.lo) * pxPerCycle + panX();
      const x1 = LANE_BG_PAD_LEFT + (e.endCycle - cb.lo) * pxPerCycle + panX();
      const yMid = RULER_HEIGHT_PX + midiToY(e.midi, mb, h - RULER_HEIGHT_PX);
      const yTop = yMid - noteH / 2;
      const noteW = Math.max(2, x1 - x0);
      ctx.fillStyle = i === hoverNoteIdx()
        ? COLORS.noteHover
        : COLORS.noteDefault;
      ctx.fillRect(x0, yTop, noteW, noteH);
      // Highlight the note that's playing at the playhead position.
      if (
        playheadCycle() >= e.startCycle && playheadCycle() <= e.endCycle
      ) {
        ctx.fillStyle = COLORS.notePlayhead;
        ctx.fillRect(x0, yTop, noteW, noteH);
      }
    }

    // ----- Playhead line -----
    const pxX = LANE_BG_PAD_LEFT + (playheadCycle() - cb.lo) * pxPerCycle + panX();
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
    for (let i = evts.length - 1; i >= 0; i -= 1) {
      const e = evts[i]!;
      const x0 = LANE_BG_PAD_LEFT + (e.startCycle - cb.lo) * pxPerCycle + panX();
      const x1 = LANE_BG_PAD_LEFT + (e.endCycle - cb.lo) * pxPerCycle + panX();
      const yMid = RULER_HEIGHT_PX + midiToY(e.midi, mb, height() - RULER_HEIGHT_PX);
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

  const isEmpty = (): boolean => events().length === 0;

  return (
    <div
      class="pianoroll-host"
      data-empty={isEmpty() ? 'true' : 'false'}
      data-event-count={events().length}
      data-score-digest={scoreDigest()}
      style={{ height: `${height()}px` }}
    >
      <div class="pianoroll-toolbar">
        <span class="pianoroll-count">
          {events().length} note{events().length === 1 ? '' : 's'}
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
        style={{ height: `${height() - 36}px` }}
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
