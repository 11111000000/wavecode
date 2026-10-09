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
import { singleNoteSnippet } from '~/domain/music/notes';

const PIANO_WHITE_W = 80;
const PIANO_BLACK_W = 50;
const PIANO_HEIGHT_DESKTOP = 220;
const PIANO_HEIGHT_MOBILE = 180;

/**
 * On-screen 2-octave piano (C3..B4). Tap to play. WebMIDI input
 * auto-binds when available (Chrome/Edge/Firefox desktop + Android).
 * iOS Safari: only on-screen.
 */
export function PianoKeyboard() {
  const [activeNotes, setActiveNotes] = createSignal<ReadonlySet<number>>(new Set());
  const [midiAvailable, setMidiAvailable] = createSignal(false);
  const [midiInputs, setMidiInputs] = createSignal<ReadonlyArray<string>>([]);

  // White keys: get their index in the white-key sequence (for layout).
  const notes = rangeNotes();
  const whiteNotes = notes.filter((n) => !isBlackKey(n));
  const whiteIndex = (midi: number): number =>
    whiteNotes.findIndex((n) => n === midi);

  const playNote = (midi: number): void => {
    if (!isInPianoRange(midi)) return;
    const next = new Set(activeNotes());
    next.add(midi);
    setActiveNotes(next);
    const name = noteNumberToName(midi);
    void evalScore(singleNoteSnippet(name));
  };

  const stopNote = (midi: number): void => {
    if (!isInPianoRange(midi)) return;
    const next = new Set(activeNotes());
    next.delete(midi);
    setActiveNotes(next);
  };

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

  // CSS: responsive key sizes via @media (set in index.css).
  // Here we use viewport detection for inline-style to keep logic in one file.
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== 'undefined' && window.innerWidth <= 720,
  );
  const keyHeight = (): number => (isMobile() ? PIANO_HEIGHT_MOBILE : PIANO_HEIGHT_DESKTOP);

  onMount(() => {
    const onResize = () => { setIsMobile(window.innerWidth <= 720); };
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });

  return (
    <div class="piano-wrap" role="group" aria-label="Piano keyboard C3 to B4">
      <div class="piano-toolbar">
        <span class="piano-hint">2 octaves (C3–B4) — tap or use MIDI keyboard</span>
        <Show when={midiAvailable()}>
          <span class={`piano-midi-status piano-midi-${midiInputs().length > 0 ? 'ok' : 'pending'}`}>
            {midiInputs().length > 0
              ? `🎹 MIDI: ${midiInputs().length} device${midiInputs().length === 1 ? '' : 's'}`
              : '🎹 MIDI: no device'}
          </span>
        </Show>
      </div>
      <div
        class="piano-keys"
        style={{
          height: `${keyHeight()}px`,
          width: `${whiteNotes.length * (isMobile() ? 50 : PIANO_WHITE_W)}px`,
          position: 'relative',
        }}
      >
        <For each={whiteNotes}>
          {(midi) => {
            const active = (): boolean => activeNotes().has(midi);
            return (
              <button
                type="button"
                class={`piano-key white${active() ? ' active' : ''}`}
                style={{
                  width: `${isMobile() ? 50 : PIANO_WHITE_W}px`,
                  height: `${keyHeight()}px`,
                }}
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
        {/* Black keys overlaid absolute */}
        <For each={notes}>
          {(midi) => {
            if (!isBlackKey(midi)) return null;
            const wIdx = whiteIndex(midi - 1);
            if (wIdx < 0) return null;
            const wW = isMobile() ? 50 : PIANO_WHITE_W;
            const bW = isMobile() ? 32 : PIANO_BLACK_W;
            const left = (wIdx + 1) * wW - bW / 2;
            const active = (): boolean => activeNotes().has(midi);
            return (
              <button
                type="button"
                class={`piano-key black${active() ? ' active' : ''}`}
                style={{
                  width: `${bW}px`,
                  height: `${keyHeight() * 0.62}px`,
                  left: `${left}px`,
                }}
                aria-label={noteNumberToName(midi) as NoteName}
                aria-pressed={active()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  playNote(midi);
                }}
                onPointerUp={() => stopNote(midi)}
                onPointerLeave={() => activeNotes().has(midi) && stopNote(midi)}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}
