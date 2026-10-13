import { For, createSignal, onMount, onCleanup, Show } from 'solid-js';
import {
  rangeNotes,
  noteNumberToName,
  isBlackKey,
  isInPianoRange,
  type NoteName,
} from '~/domain/music/notes';
import {
  isMidiAvailable,
  requestMidiAccess,
  onNote,
} from '~/infrastructure/audio/MidiInput';
import { evalScore } from '../state/audioActions';
import { buildPianoSnippet } from './pianoSynth';

/**
 * On-screen 2-octave piano (C3..B4). Tap to play. WebMIDI input
 * auto-binds when available (Chrome/Edge/Firefox desktop + Android).
 * iOS Safari: only on-screen.
 *
 * Polyphony + note-off:
 *   - The component accumulates an `activeNotes: Set<number>` and calls
 *     `evalScore(buildPianoSnippet(set))` on every press/release. The
 *     snippet shapes itself around the held set:
 *       • 0 notes → SILENCE ('silence' literal — Strudel stays silent).
 *       • 1 note  → single voice `note("c4").s("triangle")...`.
 *       • 2+ notes → `stack(note("c4")…, note("e4")…, …)`.
 *   - evalScore is throttled to 30 ms via a trailing-edge setTimeout so
 *     fast trills (or a MIDI keyboard glaze) don't flood the eval queue
 *     with re-evaluations of effectively identical patterns.
 *   - Stopping the LAST held note sends SILENCE so ringing tails are
 *     cut instead of decaying naturally.
 *
 * Sizing (width / height) is fully CSS-driven (see .piano-keys-inner in
 * components.css with `--white-w` / `--black-w` / `--piano-h`). The only
 * dynamic inline value is the `left` of each black key, expressed via
 * `calc(var(--white-w) * <n> - var(--black-w) / 2)` so the @media query
 * override updates the layout without re-rendering.
 */
const EVAL_DEBOUNCE_MS = 30;

/** Russian pluralisation for "нота/ноты/нот". Fewer surprises when
 *  gluing into a localisation system later. Pure helper at module scope
 *  (no closures over component state). */
const formatActiveLabel = (count: number): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} нота`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ноты`;
  return `${count} нот`;
};

export function PianoKeyboard() {
  const [activeNotes, setActiveNotes] = createSignal<ReadonlySet<number>>(new Set());
  const [midiAvailable, setMidiAvailable] = createSignal(false);
  const [midiInputs, setMidiInputs] = createSignal<ReadonlyArray<string>>([]);

  // White keys: get their index in the white-key sequence (for layout).
  const notes = rangeNotes();
  const whiteNotes = notes.filter((n) => !isBlackKey(n));
  const whiteIndex = (midi: number): number =>
    whiteNotes.findIndex((n) => n === midi);

  // Debounce state — ref-equivalents in Solid are module-scope because
  // signals would re-render on every change. We want the timer/handle
  // to be invisible to the JSX tree.
  let pendingEvalTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleEval = (): void => {
    if (pendingEvalTimer !== null) clearTimeout(pendingEvalTimer);
    pendingEvalTimer = setTimeout(() => {
      pendingEvalTimer = null;
      void evalScore(buildPianoSnippet(activeNotes()));
    }, EVAL_DEBOUNCE_MS);
  };

  const playNote = (midi: number): void => {
    if (!isInPianoRange(midi)) return;
    const current = activeNotes();
    if (current.has(midi)) {
      // Already pressed (e.g. MIDI key re-trigger without note-off).
      // Re-eval anyway so the synth stays in sync with the held set.
      scheduleEval();
      return;
    }
    const next = new Set(current);
    next.add(midi);
    setActiveNotes(next);
    scheduleEval();
  };

  const stopNote = (midi: number): void => {
    if (!isInPianoRange(midi)) return;
    const current = activeNotes();
    if (!current.has(midi)) return; // already released
    const next = new Set(current);
    next.delete(midi);
    setActiveNotes(next);
    scheduleEval();
  };

  onCleanup(() => {
    if (pendingEvalTimer !== null) {
      clearTimeout(pendingEvalTimer);
      pendingEvalTimer = null;
    }
  });

  // WebMIDI: request access on mount (silently no-op on iOS).
  onMount(() => {
    if (!isMidiAvailable()) return;
    setMidiAvailable(true);
    let unsub: (() => void) | null = null;
    void requestMidiAccess().then((access) => {
      if (!access) return;
      setMidiInputs(
        Array.from(access.inputs.values()).map((i) => i.name ?? 'Unknown device'),
      );
      unsub = onNote(access, (e) => {
        if (e.type === 'noteOn') playNote(e.note);
        else stopNote(e.note);
      });
    });
    onCleanup(() => {
      if (unsub) unsub();
    });
  });

  // Active-note count for the MIDI status pill. Same `activeNotes()`
  // signal that drives the key highlight — single source of truth for
  // on-screen taps + WebMIDI events. `activeCount()` is a derived
  // value; Solid recomputes it lazily so there's no re-render storm
  // when MIDI keyboards fire 50 events/sec.
  const activeCount = (): number => activeNotes().size;
  const hasActive = (): boolean => activeCount() > 0;

  return (
    <div class="piano-wrap" role="group" aria-label="Piano keyboard C3 to B4">
      <div class="piano-toolbar">
        <span class="piano-hint">2 octaves (C3–B4) — tap or use MIDI keyboard</span>
        <Show when={midiAvailable()}>
          <span
            class={`piano-midi-status piano-midi-${midiInputs().length > 0 ? 'ok' : 'pending'}${hasActive() ? ' has-active' : ''}`}
            data-active-count={activeCount()}
            aria-live="polite"
          >
            {midiInputs().length > 0
              ? `MIDI: ${midiInputs().length} device${midiInputs().length === 1 ? '' : 's'}${hasActive() ? ` · ${formatActiveLabel(activeCount())}` : ''}`
              : 'MIDI: no device'}
          </span>
        </Show>
      </div>
      <div class="piano-keys">
        <div class="piano-keys-inner">
          <For each={whiteNotes}>
            {(midi) => {
              const active = (): boolean => activeNotes().has(midi);
              return (
                <button
                  type="button"
                  class={`piano-key white${active() ? ' active' : ''}`}
                  aria-label={noteNumberToName(midi) as NoteName}
                  aria-pressed={active()}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    playNote(midi);
                  }}
                  onPointerUp={() => stopNote(midi)}
                  onPointerLeave={() => activeNotes().has(midi) && stopNote(midi)}
                >
                  {whiteIndex(midi) % 7 === 0 && (
                    <span class="piano-key-label">{noteNumberToName(midi)}</span>
                  )}
                </button>
              );
            }}
          </For>
          {/* Black keys overlaid absolute. `left` is the only dynamic
           *  inline value — expressed as calc() with CSS variables so
           *  the @media (max-width: 720px) override updates the layout
           *  without re-rendering or re-reading computed styles. */}
          <For each={notes}>
            {(midi) => {
              if (!isBlackKey(midi)) return null;
              const wIdx = whiteIndex(midi - 1);
              if (wIdx < 0) return null;
              const boundary = wIdx + 1;
              const left = `calc((var(--white-w) * ${boundary}) - (var(--black-w) / 2))`;
              const active = (): boolean => activeNotes().has(midi);
              return (
                <button
                  type="button"
                  class={`piano-key black${active() ? ' active' : ''}`}
                  style={{ left }}
                  aria-label={noteNumberToName(midi) as NoteName}
                  aria-pressed={active()}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    playNote(midi);
                  }}
                  onPointerUp={() => stopNote(midi)}
                  onPointerLeave={() => activeNotes().has(midi) && stopNote(midi)}
                >
                  <span class="piano-key-label">{noteNumberToName(midi)}</span>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
