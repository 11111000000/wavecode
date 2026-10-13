import { For, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { Effect } from 'effect';
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
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import {
  recEnabled,
  appendNote,
  updateLastNoteEnd,
  followEnabled,
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
 *     The buffer is consumed by the `↑ apply` toolbar button via
 *     `applyToScore()` in pianoRecStore — kept out of this component
 *     to preserve the "piano doesn't mutate score" invariant.
 *
 * Debounce:
 *   - 30ms trailing debounce on `noteOn` (module-scope timer) to
 *     coalesce rapid MIDI re-trigger events into a single press.
 *     Without it, a MIDI keyboard glaze can stack 30+ noteOn calls
 *     per second and overwhelm the Web Audio node graph.
 *
 * Variants (wavecode-piano-rec-clarity):
 *   - `sheet` (default) — used inside the BottomSheet on mobile.
 *     Renders `.piano-wrap.piano-wrap--sheet`. Vertical sheet layout.
 *   - `inline` — used inside the ScorePanel collapsible header on
 *     desktop. Renders `.piano-wrap.piano-wrap--inline` and the CSS
 *     tightens the layout to fit a ~200px-tall strip next to the
 *     editor. Functionality is identical.
 *
 * Sizing (width / height) is fully CSS-driven (see .piano-keys-inner
 * in components.css). Black-key `left` is `calc(var(--white-w) * n -
 * var(--black-w) / 2)`.
 */
const NOTEON_DEBOUNCE_MS = 30;
/** FOLLOW mode poll cadence (ms). 20Hz → ~2ms/sec CPU. */
const FOLLOW_POLL_MS = 50;

/** Display variant — affects CSS class only, audio/state paths are identical. */
export type PianoKeyboardVariant = 'inline' | 'sheet';

export type PianoKeyboardProps = {
  readonly variant?: PianoKeyboardVariant | undefined;
};

/** Russian pluralisation for "нота/ноты/нот". */
const formatActiveLabel = (count: number): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} нота`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ноты`;
  return `${count} нот`;
};

export function PianoKeyboard(props: PianoKeyboardProps = {}) {
  const [activeNotes, setActiveNotes] = createSignal<ReadonlySet<number>>(new Set());
  const [midiAvailable, setMidiAvailable] = createSignal(false);
  const [midiInputs, setMidiInputs] = createSignal<ReadonlyArray<string>>([]);
  // Most-recently-active MIDI input name. Populated by the first MIDI
  // noteOn we see in a given session, replaced by a different device's
  // noteOn if that device takes over, and cleared when the LAST held
  // note is released. On-screen taps don't change this — they share
  // the same `activeNotes` set but have no device identity.
  const [activeMidiSource, setActiveMidiSource] = createSignal<string | null>(null);
  // FOLLOW mode: the set of MIDI numbers the Strudel scheduler is
  // currently sounding. Refreshed via a 50ms timer that calls
  // AudioEngine.getActiveHaps() while followEnabled() is true.
  // Unioned with `activeNotes()` for the key's `active` class and
  // reflected in the `data-source` attribute (none/pressed/follow/both).
  const [liveHaps, setLiveHaps] = createSignal<ReadonlySet<number>>(new Set());

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

  const playNote = (midi: number, source?: string): void => {
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
    if (source !== undefined) setActiveMidiSource(source);
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
    if (!current.has(midi)) return; // already released
    const willBeEmpty = current.size === 1;
    const next = new Set(current);
    next.delete(midi);
    setActiveNotes(next);
    // When the last held note goes away, drop the device attribution
    // too — the next press (MIDI or on-screen) re-establishes it. This
    // keeps the pill idle state tidy: "MIDI: N devices" rather than
    // a stale "AKAI MPK" lingering after the user lifts their hands.
    if (willBeEmpty) setActiveMidiSource(null);
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
    // FOLLOW mode cleanup: the setInterval handle is cleared by
    // `setFollow(false)` inside `onMount` — but if the user navigates
    // away with the toggle still on, we still need a safety net. The
    // cleanup below mirrors the toggle-off path.
    if (followPollTimer !== null) {
      clearInterval(followPollTimer);
      followPollTimer = null;
    }
  });

  // FOLLOW polling (post wavecode-piano-modes-and-gain): every
  // FOLLOW_POLL_MS ms, ask the AudioEngine which MIDI notes are
  // sounding in the scheduler right now. Reactive: it turns on/off
  // with `followEnabled` without unmounting the component. The poll
  // handle is module-scope so we can stop it from any handler.
  let followPollTimer: ReturnType<typeof setInterval> | null = null;
  const startFollowPoll = (): void => {
    if (followPollTimer !== null) return;
    followPollTimer = setInterval(() => {
      // Defensive: if the toggle flipped off mid-tick, stop on the
      // next iteration. This avoids leaked timers when toggling
      // rapidly.
      if (!followEnabled()) {
        if (followPollTimer !== null) {
          clearInterval(followPollTimer);
          followPollTimer = null;
        }
        setLiveHaps(new Set<number>());
        return;
      }
      void Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* AudioEngine;
          const haps = yield* engine.getActiveHaps();
          const next = new Set<number>();
          for (const h of haps) {
            if (Number.isFinite(h.midi)) next.add(h.midi);
          }
          setLiveHaps(next);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, FOLLOW_POLL_MS);
  };
  /** Stop the FOLLOW poll AND clear liveHaps so keys un-highlight. */
  const stopFollowPoll = (): void => {
    if (followPollTimer !== null) {
      clearInterval(followPollTimer);
      followPollTimer = null;
    }
    setLiveHaps(new Set<number>());
  };

  // Reactive FOLLOW mode controller: whenever the user flips
  // `followEnabled`, start/stop the poll accordingly. Mount-time is
  // `false` → no poll until the user explicitly opts in.
  createEffect(() => {
    if (followEnabled()) startFollowPoll();
    else stopFollowPoll();
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
        if (e.type === 'noteOn') playNote(e.note, e.source);
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
    <div
      class={`piano-wrap piano-wrap--${props.variant ?? 'sheet'}`}
      role="group"
      aria-label="Piano keyboard C3 to B4"
      data-variant={props.variant ?? 'sheet'}
    >
      {/* Scoped style for the device-name chip in the status pill.
       *  Lives here (not in components.css) because it's a tiny
       *  presentation tweak tied 1:1 to the adjacent markup — moving
       *  it to a global stylesheet would force readers to jump files.
       *  Same colour family as the green `has-active` state but in
       *  regular weight + italic to read as "label, not number". */}
      <style>{`
.piano-midi-source {
  font-style: italic;
  font-weight: normal;
  opacity: 0.85;
  text-transform: none;
  letter-spacing: normal;
  margin-left: 2px;
}
`}</style>
      <div class="piano-toolbar">
        <span class="piano-hint">2 octaves (C3–B4) — tap or use MIDI keyboard</span>
        <PianoToolbar
          midiStatus={midiStatus()}
          midiActive={hasActive()}
          midiActiveCount={activeCount()}
          midiSource={activeMidiSource() ?? undefined}
        />
      </div>
      <div class="piano-keys">
        <div class="piano-keys-inner">
          <For each={whiteNotes}>
            {(midi) => {
              const active = (): boolean => activeNotes().has(midi);
              const followed = (): boolean => liveHaps().has(midi);
              const dataSource = (): 'pressed' | 'follow' | 'both' | 'none' => {
                const p = active();
                const f = followed();
                if (p && f) return 'both';
                if (p) return 'pressed';
                if (f) return 'follow';
                return 'none';
              };
              return (
                <button
                  type="button"
                  class={`piano-key white${active() ? ' active' : ''}${followed() ? ' followed' : ''}`}
                  data-source={dataSource()}
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
              const followed = (): boolean => liveHaps().has(midi);
              const dataSource = (): 'pressed' | 'follow' | 'both' | 'none' => {
                const p = active();
                const f = followed();
                if (p && f) return 'both';
                if (p) return 'pressed';
                if (f) return 'follow';
                return 'none';
              };
              return (
                <button
                  type="button"
                  class={`piano-key black${active() ? ' active' : ''}${followed() ? ' followed' : ''}`}
                  data-source={dataSource()}
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