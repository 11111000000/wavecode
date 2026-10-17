import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import type { AudioNote } from '~/domain/audio/micCapture';
import type { Transient, OnsetType } from '~/domain/audio/transient';

/**
 * PianoRollPreview — horizontal timeline of what the user just played.
 *
 * Visual:
 *   X axis: time (auto-scaled window of the most recent ~3 s of onsets).
 *   Y axis: pitch in semitones (lowest detected → bottom; highest → top).
 *
 * Renders two layers inside a relative-positioned container:
 *   1. Sustain notes — absolute-positioned rectangles. X-width proportional
 *      to `durationMs`, Y-position computed from MIDI number, fill colour
 *      keyed to pitch class (cycle through 12 hues so adjacent notes differ).
 *   2. Drums — short coloured bars pinned to the bottom row. Each onset
 *      type maps to a colour (kick=red, snare=yellow, hat=cyan, clap=
 *      orange). They occupy a fixed bottom band regardless of pitch.
 *
 * Selection: parent passes a list of selected note ids. A click on a note
 * fires `onSelect(id)`. Multi-selection is up to the parent.
 *
 * Hover: native `title` attribute per note/drum so jsdom renders the
 * text without needing actual mouse-over DOM events. CSS-styled tooltips
 * are bonus if the parent enables `.mic-ux-roll-tooltip` siblings.
 *
 * Empty state: thin grey bar with "no notes yet" centred.
 */

const TIME_WINDOW_MS = 3000;
/** Note ids that have no `id` field (AudioNote has only audio props).
 *  We synthesize an id from `(startMs, midi)` which is unique per session
 *  because startMs increments monotonically. */
const noteId = (n: AudioNote, idx: number): string => `n-${n.startMs}-${n.midi}-${idx}`;
const drumId = (t: Transient, idx: number): string => `d-${t.startMs}-${t.type}-${idx}`;

const DRUM_COLOR: Record<OnsetType, string> = {
  kick: 'rgb(251, 113, 133)',   // err red
  snare: 'rgb(251, 191, 36)',   // warm yellow
  hat: 'rgb(94, 234, 212)',     // cyan
  click: 'rgb(251, 146, 60)',   // orange
};

const DRUM_LABEL: Record<OnsetType, string> = {
  kick: 'bd',
  snare: 'sd',
  hat: 'hh',
  click: 'cp',
};

/** Map a MIDI number to a pitch-class hue. 12 evenly-distributed hues
 *  so neighbours on the staff get distinct colours. We deliberately
 *  avoid a rainbow ramp (looks gimmicky) and stick to a primary/cyan/
 *  warm/magenta cycle. */
const pitchClassColor = (midi: number): string => {
  const cls = ((midi % 12) + 12) % 12;
  const palette = [
    'var(--primary)',  // C
    'var(--primary)',  // C#
    'var(--cyan)',     // D
    'var(--cyan)',     // D#
    'var(--warm)',     // E
    'var(--ok)',       // F
    'var(--ok)',       // F#
    'var(--magenta)',  // G
    'var(--magenta)',  // G#
    'var(--err)',      // A
    'var(--err)',      // A#
    'var(--primary)',  // B
  ] as const;
  return palette[cls]!;
};

const midiToName = (midi: number): string => {
  const cls = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
  return `${names[cls]}${oct}`;
};

export type PianoRollPreviewProps = {
  readonly notes: ReadonlyArray<AudioNote>;
  readonly transients: ReadonlyArray<Transient>;
  readonly selection?: ReadonlyArray<string> | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
  readonly height?: number | undefined;
};

export function PianoRollPreview(props: PianoRollPreviewProps): JSX.Element {
  const containerHeight = (): number => props.height ?? 60;

  /** Time window: most-recent `now` is the max startMs across both
   *  arrays (or 0 if empty). Window = [now - TIME_WINDOW_MS, now]. */
  const timeWindow = createMemo<{ from: number; to: number }>(() => {
    const lastNoteMs = props.notes.reduce((m, n) => Math.max(m, n.startMs), 0);
    const lastDrumMs = props.transients.reduce((m, t) => Math.max(m, t.startMs), 0);
    const now = Math.max(lastNoteMs, lastDrumMs, performance.now?.() ?? 0);
    return { from: now - TIME_WINDOW_MS, to: now };
  });

  /** Sustain notes — Y position computed per-note by mapping its MIDI
   *  number onto the available Y range. Lowest detected note → bottom,
   *  highest → top. */
  const noteBoxes = createMemo<ReadonlyArray<{
    readonly id: string;
    readonly x: number;     // percent
    readonly width: number; // percent
    readonly y: number;     // percent (0 = top)
    readonly height: number;
    readonly color: string;
    readonly label: string;
    readonly selected: boolean;
  }>>(() => {
    if (props.notes.length === 0) return [];
    const win = timeWindow();
    const span = Math.max(1, win.to - win.from);
    const midis = props.notes.map((n) => n.midi);
    const minMidi = Math.min(...midis);
    const maxMidi = Math.max(...midis);
    const range = Math.max(1, maxMidi - minMidi);

    const selection = props.selection ?? [];
    return props.notes.map((n, idx) => {
      const id = noteId(n, idx);
      const durPct = Math.min(100, (n.durationMs / span) * 100);
      const xPct = Math.max(0, Math.min(100 - durPct, ((n.startMs - win.from) / span) * 100));
      const yPct = ((n.midi - minMidi) / range) * 100;
      // Notes get ~10px minimum height so very short ones stay clickable.
      const heightPct = Math.max(12, 100 / Math.max(props.notes.length, 6));
      const label = `${midiToName(n.midi)}${n.vibratoCents > 0 ? ` ±${n.vibratoCents}¢` : ''} · ${Math.round(n.durationMs)}ms`;
      return {
        id,
        x: xPct,
        width: durPct,
        y: 100 - yPct - heightPct,
        height: heightPct,
        color: pitchClassColor(n.midi),
        label,
        selected: selection.includes(id),
      };
    });
  });

  const drumBoxes = createMemo<ReadonlyArray<{
    readonly id: string;
    readonly x: number;
    readonly color: string;
    readonly label: string;
  }>>(() => {
    if (props.transients.length === 0) return [];
    const win = timeWindow();
    const span = Math.max(1, win.to - win.from);
    return props.transients.map((t, idx) => {
      const id = drumId(t, idx);
      const xPct = Math.max(0, Math.min(96, ((t.startMs - win.from) / span) * 100));
      return {
        id,
        x: xPct,
        color: DRUM_COLOR[t.type],
        label: `${DRUM_LABEL[t.type]} · ${Math.round(t.amplitude * 100)}%`,
      };
    });
  });

  /** Tooltip text shown on the empty state. */
  const isEmpty = (): boolean => props.notes.length === 0 && props.transients.length === 0;

  // Local hover signal — drives the floating tooltip near the cursor.
  // Kept simple (only one tooltip at a time) since the panel is small.
  const [hoverBox, setHoverBox] = createSignal<{
    readonly id: string;
    readonly label: string;
    readonly xPct: number;
  } | null>(null);

  return (
    <div
      class="mic-ux-piano-roll"
      style={{ height: `${containerHeight()}px` }}
      data-empty={isEmpty() ? 'true' : 'false'}
      data-note-count={props.notes.length}
      data-drum-count={props.transients.length}
      role="img"
      aria-label={`Piano roll preview: ${props.notes.length} note${props.notes.length === 1 ? '' : 's'}, ${props.transients.length} onset${props.transients.length === 1 ? '' : 's'}`}
    >
      <Show when={isEmpty()}>
        <div class="mic-ux-piano-roll-empty" aria-hidden="true">
          no notes yet
        </div>
      </Show>

      <For each={drumBoxes()}>
        {(d) => (
          <>
            <div
              class="mic-ux-piano-roll-drum"
              data-drum-id={d.id}
              data-drum-type={props.transients.find((t) => d.id.startsWith(`d-${t.startMs}-${t.type}`))?.type}
              style={{
                left: `${d.x}%`,
                width: '8px',
                height: '8px',
                background: d.color,
              }}
              title={d.label}
              onClick={(): void => {
                const cb = props.onSelect;
                if (cb !== undefined) cb(d.id);
              }}
              onMouseEnter={(): void => { setHoverBox({ id: d.id, label: d.label, xPct: d.x }); }}
              onMouseLeave={(): void => { setHoverBox(null); }}
              role="button"
              tabindex={0}
            />
            <Show when={hoverBox()?.id === d.id}>
              <div
                class="mic-ux-roll-tooltip"
                style={{
                  left: `${(hoverBox()?.xPct ?? 0) + 1}%`,
                  bottom: '12px',
                }}
              >
                {hoverBox()?.label ?? ''}
              </div>
            </Show>
          </>
        )}
      </For>

      <For each={noteBoxes()}>
        {(n) => (
          <>
            <div
              class="mic-ux-piano-roll-note"
              data-note-id={n.id}
              data-midi={props.notes.find((p) => n.id.startsWith(`n-${p.startMs}-${p.midi}-`))?.midi}
              data-selected={n.selected ? 'true' : 'false'}
              style={{
                left: `${n.x}%`,
                width: `${Math.max(2, n.width)}%`,
                top: `${n.y}%`,
                height: `${n.height}%`,
                background: n.color,
                opacity: n.selected ? 1 : 0.85,
              }}
              title={n.label}
              onClick={(): void => {
                const cb = props.onSelect;
                if (cb !== undefined) cb(n.id);
              }}
              onMouseEnter={(): void => { setHoverBox({ id: n.id, label: n.label, xPct: n.x }); }}
              onMouseLeave={(): void => { setHoverBox(null); }}
              role="button"
              tabindex={0}
            />
            <Show when={hoverBox()?.id === n.id}>
              <div
                class="mic-ux-roll-tooltip"
                style={{
                  left: `${(hoverBox()?.xPct ?? 0) + 1}%`,
                  top: '4px',
                }}
              >
                {hoverBox()?.label ?? ''}
              </div>
            </Show>
          </>
        )}
      </For>
    </div>
  );
}
