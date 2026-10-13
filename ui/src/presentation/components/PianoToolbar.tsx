import { For, Show, type JSX } from 'solid-js';
import { RecordIcon } from '../icons';
import {
  recEnabled,
  toggleRec,
  followEnabled,
  toggleFollow,
  recBuffer,
  applyToScore,
  instrument,
  setInstrument,
} from '../state/pianoRecStore';
import type { PianoInstrument } from '~/domain/music/notes';

/**
 * PianoToolbar — REC + FOLLOW + apply + instrument selector for the piano.
 *
 * Rendered inline inside `.piano-toolbar` (next to the existing
 * `.piano-hint` text and optional MIDI status pill). The component
 * is intentionally dumb: it reads from `pianoRecStore` (a module-
 * level Solid signal bag) and calls its setters. The actual audio
 * routing lives in PianoKeyboard; this component owns only the UI
 * affordances.
 *
 * Four affordances (post wavecode-piano-modes-and-gain):
 *   1. REC toggle (magenta pulse when on) — writes pressed keys into
 *      the rec buffer.
 *   2. FOLLOW toggle (cyan when on) — independent of REC. When on,
 *      PianoKeyboard polls `AudioEngine.getActiveHaps()` every 50ms
 *      and lights up the piano keys whose MIDI numbers are currently
 *      in the scheduler. Audition / REC / FOLLOW compose orthogonally.
 *   3. ↑ apply button — visible only when REC is on AND the buffer is
 *      non-empty. Calls `applyToScore()` which commits the buffer to
 *      the editor via `dispatch(replaceScore)`.
 *   4. Instrument selector — 4 inline buttons (△ ∿ ⊿ ⊓), amber when
 *      active. Each label is a unicode glyph chosen for legibility at
 *      24px without external SVG.
 *
 * The MIDI status pill (when present) is rendered in the same row via
 * the `midiStatus` prop. PianoKeyboard owns the actual pill markup
 * (including the active-notes suffix) so the styling stays consistent
 * with the legacy version.
 */
export type PianoToolbarProps = {
  /** Optional MIDI status text (e.g. "MIDI: 1 device · 3 ноты").
   *  Under `exactOptionalPropertyTypes` the explicit `| undefined`
   *  is required so callers can pass `undefined` (e.g. when MIDI is
   *  unavailable). */
  midiStatus?: string | undefined;
  /** True if there's at least one active note — drives the green
   *  "has-active" pulse on the MIDI status pill. */
  midiActive?: boolean | undefined;
  /** Count of active notes — reflected in the data-active-count
   *  attribute of the MIDI status pill. */
  midiActiveCount?: number | undefined;
  /** Name of the most recently active MIDI input (e.g. "AKAI MPK").
   *  When set, rendered as a separate `<span class="piano-midi-source">`
   *  child of the MIDI status pill and reflected in the pill's
   *  `data-midi-source` attribute. The full string in `midiStatus`
   *  already contains the name; this prop exists to make the
   *  source a query-able DOM element (test selector + a11y). */
  midiSource?: string | undefined;
};

const INSTRUMENTS: ReadonlyArray<PianoInstrument> = ['triangle', 'sine', 'sawtooth', 'square'];

const instrumentGlyph = (inst: PianoInstrument): string => {
  switch (inst) {
    case 'triangle': return '△';
    case 'sine': return '∿';
    case 'sawtooth': return '⊿';
    case 'square': return '⊓';
    default: return inst;
  }
};

export const PianoToolbar = (props: PianoToolbarProps): JSX.Element => {
  const midiPillTone = (): 'ok' | 'pending' => {
    const s = props.midiStatus ?? '';
    return /^MIDI:\s+\d+\s+device/.test(s) ? 'ok' : 'pending';
  };

  const canApply = (): boolean => recEnabled() && recBuffer().length > 0;

  return (
    <div class="piano-toolbar-row">
      <button
        type="button"
        class="piano-rec-btn"
        data-active={recEnabled() ? 'true' : 'false'}
        onClick={() => toggleRec()}
        title={recEnabled() ? 'Rec ON — нажатия пишутся в score' : 'Rec OFF — играю параллельно'}
        aria-label="Запись"
        aria-pressed={recEnabled()}
      >
        <RecordIcon size={14} />
        REC
      </button>
      <button
        type="button"
        class="piano-follow-btn"
        data-active={followEnabled() ? 'true' : 'false'}
        onClick={() => toggleFollow()}
        title={followEnabled() ? 'FOLLOW ON — клавиши подсвечиваются от scheduler' : 'FOLLOW OFF — только мои нажатия'}
        aria-label="Подсветка от scheduler"
        aria-pressed={followEnabled()}
      >
        FOLLOW
      </button>
      <Show when={canApply()}>
        <button
          type="button"
          class="piano-apply-btn"
          onClick={() => applyToScore()}
          title="Применить записанные ноты к score"
          aria-label="Применить записанные ноты к score"
        >
          ↑ apply
        </button>
      </Show>
      <div class="piano-instrument-selector" role="group" aria-label="Инструмент">
        <For each={INSTRUMENTS}>
          {(inst) => (
            <button
              type="button"
              class="piano-inst-btn"
              data-active={instrument() === inst ? 'true' : 'false'}
              onClick={() => setInstrument(inst)}
              title={inst}
              aria-label={`Инструмент: ${inst}`}
            >
              {instrumentGlyph(inst)}
            </button>
          )}
        </For>
      </div>
      <Show when={props.midiStatus}>
        <span
          class={`piano-midi-status piano-midi-${midiPillTone()}${props.midiActive ? ' has-active' : ''}`}
          data-active-count={props.midiActiveCount ?? 0}
          data-midi-source={props.midiSource ?? ''}
          aria-live="polite"
        >
          {props.midiStatus}
          <Show when={props.midiSource}>
            {' · '}
            <span class="piano-midi-source">{props.midiSource}</span>
          </Show>
        </span>
      </Show>
    </div>
  );
};
