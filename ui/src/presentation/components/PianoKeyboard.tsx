import { For, createSignal, onMount, onCleanup } from 'solid-js';
import {
  rangeNotes,
  noteNumberToName,
  isBlackKey,
  isInPianoRange,
  type NoteName,
  type PianoInstrument,
} from '~/domain/music/notes';
import {
  isMidiAvailable,
  requestMidiAccess,
  onNote,
} from '~/infrastructure/audio/MidiInput';
import { createPianoSynth, type PianoSynth } from '~/infrastructure/audio/PianoSynth';
import { unlockAudioContext } from '~/infrastructure/audio/LiveAudioEngine';
import {
  recEnabled,
  appendNote,
  updateLastNoteEnd,
  instrument,
} from '../state/pianoRecStore';
import { PianoToolbar } from './PianoToolbar';

/**
 * On-screen 2-octave piano (C3..B4). Tap to play. WebMIDI input
 * auto-binds when available (Chrome/Edge/Firefox desktop + Android).
 * iOS Safari: only on-screen.
 *
 * Audio path (post wavecode-piano-parallel-rec-instrument):
 *   - Each tap/release goes through `pianoSynth.noteOn / noteOff`,
 *     NOT through `evalScore(...)`. The synth is a raw Web Audio
 *     wrapper (oscillator + ADSR gain envelope) connected directly to
 *     `audioCtx.destination`. This bypasses the Strudel scheduler
 *     entirely — pressing a key on the piano does NOT stop/eval the
 *     main score, so they play in parallel without audible clicks.
 *
 * Visual feedback:
 *   - `activeNotes: Set<number>` drives the key highlight (.active
 *     class). Same single source of truth — both on-screen taps and
 *     WebMIDI events feed it.
 *   - MIDI status pill renders next to the rec-toggle in PianoToolbar.
 *
 * Rec-mode:
 *   - When `recEnabled()` is true, `playNote` calls `appendNote` (with
 *     endMs == startMs as a placeholder) and `stopNote` calls
 *     `updateLastNoteEnd(performance.now())` to fix the timestamp.
 *     The buffer is consumed by a future "commit to score" action via
 *     `flushRec()` — kept out of this component to preserve the
 *     "piano doesn't mutate score" invariant.
 *
 * Debounce:
 *   - 30ms trailing debounce on `noteOn` (module-scope timer) to
 *     coalesce rapid MIDI re-trigger events into a single press.
 *     Without it, a MIDI keyboard glaze can stack 30+ noteOn calls
 *     per second and overwhelm the Web Audio node graph.
 *
 * Sizing (width / height) is fully CSS-driven (see .piano-keys-inner
 * in components.css). Black-key `left` is `calc(var(--white-w) * n -
 * var(--black-w) / 2)`.
 */
const NOTEON_DEBOUNCE_MS = 30;

/** Russian pluralisation for "нота/ноты/нот". */
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

  const notes = rangeNotes();
  const whiteNotes = notes.filter((n) => !isBlackKey(n));
  const whiteIndex = (midi: number): number =>
    whiteNotes.findIndex((n) => n === midi);

  // pianoSynth is created lazily on the first note-on — needs a user
  // gesture to unlock the AudioContext. Held as a closure-scope let so
  // re-renders don't accidentally null it out.
  let pianoSynth: PianoSynth | null = null;
  /** Map<midi, voiceId> — for noteOff routing. */
  const voiceMap = new Map<number, number>();
  /** Set<midi> → noteOn requests still inside the 30ms coalesce window. */
  const pendingNoteOns = new Set<number>();
  /** Trailing-edge debounce timer. */
  let pendingNoteOnTimer: ReturnType<typeof setTimeout> | null = null;

  const ensureSynth = (): PianoSynth => {
    if (pianoSynth !== null) return pianoSynth;
    const ctx = unlockAudioContext();
    pianoSynth = createPianoSynth(ctx);
    return pianoSynth;
  };

  /** Apply the most recent value of `pendingNoteOns` to the synth. */
  const flushNoteOns = (): void => {
    pendingNoteOnTimer = null;
    if (pendingNoteOns.size === 0) return;
    const synth = ensureSynth();
    const currentInst = instrument();
    for (const midi of pendingNoteOns) {
      if (voiceMap.has(midi)) continue; // already pressed (re-trigger inside window)
      const voiceId = synth.noteOn(midi, currentInst);
      voiceMap.set(midi, voiceId);
      if (recEnabled()) {
        const now = performance.now();
        appendNote(midi, now, now);
      }
    }
    pendingNoteOns.clear();
  };

  const playNote = (midi: number): void => {
    if (!isInPianoRange(midi)) return;
    if (voiceMap.has(midi) || pendingNoteOns.has(midi)) return; // already in flight
    pendingNoteOns.add(midi);
    if (pendingNoteOnTimer !== null) clearTimeout(pendingNoteOnTimer);
    pendingNoteOnTimer = setTimeout(flushNoteOns, NOTEON_DEBOUNCE_MS);
    // Update visual feedback immediately — UI is allowed to be optimistic
    // even before the synth actually starts (avoids 30ms input lag).
    const next = new Set(activeNotes());
    next.add(midi);
    setActiveNotes(next);
  };

  const stopNote = (midi: number): void => {
    if (!isInPianoRange(midi)) return;
    // Cancel a pending noteOn if the key was pressed and released
    // within the 30ms window — without this, flushNoteOns would
    // start a new voice for a key the user already let go of.
    if (pendingNoteOns.delete(midi)) {
      // No synth noteOn yet happened — nothing to stop on audio side.
      const current = activeNotes();
      if (current.has(midi)) {
        const next = new Set(current);
        next.delete(midi);
        setActiveNotes(next);
      }
      return;
    }
    const voiceId = voiceMap.get(midi);
    if (voiceId === undefined) return;
    if (pianoSynth !== null) pianoSynth.noteOff(voiceId);
    voiceMap.delete(midi);
    if (recEnabled()) {
      updateLastNoteEnd(performance.now());
    }
    const current = activeNotes();
    if (!current.has(midi)) return;
    const next = new Set(current);
    next.delete(midi);
    setActiveNotes(next);
  };

  onCleanup(() => {
    if (pendingNoteOnTimer !== null) {
      clearTimeout(pendingNoteOnTimer);
      pendingNoteOnTimer = null;
    }
    flushNoteOns();
    if (pianoSynth !== null) {
      pianoSynth.dispose();
      pianoSynth = null;
    }
    voiceMap.clear();
    pendingNoteOns.clear();
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

  const activeCount = (): number => activeNotes().size;
  const hasActive = (): boolean => activeCount() > 0;
  const midiStatus = (): string | undefined => {
    if (!midiAvailable()) return undefined;
    if (midiInputs().length === 0) return 'MIDI: no device';
    const n = midiInputs().length;
    const tail = hasActive() ? ` · ${formatActiveLabel(activeCount())}` : '';
    return `MIDI: ${n} device${n === 1 ? '' : 's'}${tail}`;
  };

  // Silence "PianoInstrument imported but only used as a type" lint.
  // The type is consumed by `flushNoteOns` (the currentInst signal
  // is `PianoInstrument`), so the import is real — this anchor just
  // documents the dependency for any future reader.
  const _typeAnchor: PianoInstrument = instrument();
  void _typeAnchor;

  return (
    <div class="piano-wrap" role="group" aria-label="Piano keyboard C3 to B4">
      <div class="piano-toolbar">
        <span class="piano-hint">2 octaves (C3–B4) — tap or use MIDI keyboard</span>
        <PianoToolbar
          midiStatus={midiStatus()}
          midiActive={hasActive()}
          midiActiveCount={activeCount()}
        />
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