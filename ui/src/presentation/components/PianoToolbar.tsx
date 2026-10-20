import { For, Show, createSignal, type JSX } from 'solid-js';
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
  pianoSlot,
  setPianoSlot,
  editorFocused,
  previewPillPayload,
  pianoSlotLabel,
  pianoSlotGlyph,
  transcribe,
  applyTranscription,
  cancelTranscription,
  transcribePreview,
  transcribeBpm,
  setTranscribeBpm,
  type PianoSlot,
} from '../state/pianoRecStore';
import type { PianoInstrument } from '~/domain/music/notes';

/**
 * PianoToolbar — REC + FOLLOW + slot selector + apply + preview + instrument.
 *
 * Rendered inline inside `.piano-toolbar` (next to the existing
 * `.piano-hint` text and optional MIDI status pill). The component
 * is intentionally dumb: it reads from `pianoRecStore` (a module-
 * level Solid signal bag) and calls its setters. The actual audio
 * routing lives in PianoKeyboard; this component owns only the UI
 * affordances.
 *
 * Seven affordances:
 *   1. REC toggle (magenta pulse when on) — writes pressed keys into
 *      the rec buffer.
 *   2. FOLLOW toggle (cyan when on) — independent of REC. When on,
 *      PianoKeyboard polls `AudioEngine.getActiveHaps()` every 50ms
 *      and lights up the piano keys whose MIDI numbers are currently
 *      in the scheduler. Audition / REC / FOLLOW compose orthogonally.
 *   3. Slot segmented control (wavecode-piano-rec-clarity) — three
 *      buttons: `↵ stack` (append at end of stack), `⟳ replace`
 *      (destructive replace of the whole score), `⌖ cursor` (insert
 *      at the editor cursor). `⌖ cursor` is disabled when the
 *      editor is not focused; tooltip explains how to enable.
 *   4. ↑ apply button — visible only when REC is on AND the buffer is
 *      non-empty. Calls `applyToScore()` which reads `pianoSlot()`
 *      and dispatches accordingly. After successful apply, the pill
 *      flashes "✓ Применено" for 1.5s before clearing (buffer is
 *      cleared → pill naturally hides).
 *   5. Preview-pill (wavecode-piano-rec-clarity) — "● REC: 5 нот:
 *      C4 E4 G4 E4 C4 → конец стека". Shows the user what will be
 *      committed and to which slot, BEFORE apply. Visible whenever
 *      the buffer is non-empty. Critical for the mobile BottomSheet
 *      case where the editor is hidden under the sheet.
 *   6. 🎼 transcribe + BPM input (wavecode-piano-transcribe) — when
 *      the buffer is non-empty, this button populates
 *      `transcribePreview` with a Strudel-score fragment derived from
 *      the buffer via the pure `pianoTranscribe` use-case. The preview
 *      panel (collapsible, mounted BELOW the toolbar row) renders the
 *      generated mini-notation + a Russian-language summary + Apply /
 *      Cancel buttons. Apply dispatches `replaceScore` and calls
 *      `evalScore(score)` to play immediately.
 *   7. Instrument selector — 4 inline buttons (△ ∿ ⊿ ⊓), amber when
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
  /** Retry handler rendered as a button inside the status pill when the
   *  Web MIDI permission was declined or the request timed out. Re-issuing
   *  `requestMIDIAccess()` after a denial re-prompts the user, so the
   *  previously unrecoverable state becomes actionable. */
  onRetryMidi?: (() => void) | undefined;
  /** Name of the most recently active MIDI input (e.g. "AKAI MPK").
   *  When set, rendered as a separate `<span class="piano-midi-source">`
   *  child of the MIDI status pill and reflected in the pill's
   *  `data-midi-source` attribute. The full string in `midiStatus`
   *  already contains the name; this prop exists to make the
   *  source a query-able DOM element (test selector + a11y). */
  midiSource?: string | undefined;
};

const INSTRUMENTS: ReadonlyArray<PianoInstrument> = [
  'piano', 'casio', 'guitar', 'synth',
  'triangle', 'sine', 'sawtooth', 'square',
];

const INSTRUMENT_LABEL: Record<PianoInstrument, string> = {
  piano:    'Piano',
  casio:    'Casio',
  guitar:   'Guitar',
  synth:    'Synth',
  triangle: '△',
  sine:     '∿',
  sawtooth: '⊿',
  square:   '⊓',
};

const INSTRUMENT_TITLE: Record<PianoInstrument, string> = {
  piano:    'Piano (Strudel sample — REC пишет s("piano"))',
  casio:    'Casio (Strudel sample — REC пишет s("casio"))',
  guitar:   'Guitar (Strudel sample — REC пишет s("guitar"))',
  synth:    'Synth (Strudel sample — REC пишет s("synth"))',
  triangle: 'Triangle oscillator (REC пишет s("triangle"))',
  sine:     'Sine oscillator (REC пишет s("sine"))',
  sawtooth: 'Sawtooth oscillator (REC пишет s("sawtooth"))',
  square:   'Square oscillator (REC пишет s("square"))',
};

const SLOTS: ReadonlyArray<{
  readonly id: PianoSlot;
  readonly ariaLabel: string;
  readonly titleEnabled: string;
  readonly titleDisabled: string | undefined;
}> = [
  {
    id: 'append-stack',
    ariaLabel: 'Слот: конец стека — дописать как слой в существующий stack',
    titleEnabled: 'Записать в конец стека — будет дописано как новый слой',
    titleDisabled: undefined,
  },
  {
    id: 'replace-score',
    ariaLabel: 'Слот: заменить score — перезаписать весь score целиком (⌘Z для отмены)',
    titleEnabled: 'Заменит весь score. ⌘Z для отмены',
    titleDisabled: undefined,
  },
  {
    id: 'at-cursor',
    ariaLabel: 'Слот: в позицию курсора — вставить в редактор там, где стоит курсор',
    titleEnabled: 'Вставить в позицию курсора в редакторе',
    titleDisabled: 'Тапните в редактор чтобы ставить ноты в курсор',
  },
];

const instrumentGlyph = (inst: PianoInstrument): string => INSTRUMENT_LABEL[inst];

/** Duration of the "✓ Применено" pill flash after a successful apply. */
const APPLY_FLASH_MS = 1500;

export const PianoToolbar = (props: PianoToolbarProps): JSX.Element => {
  const midiPillTone = (): 'ok' | 'pending' => {
    const s = props.midiStatus ?? '';
    return /^MIDI:\s+\d+\s+device/.test(s) ? 'ok' : 'pending';
  };

  const canApply = (): boolean => recEnabled() && recBuffer().length > 0;
  const canTranscribe = (): boolean => recBuffer().length > 0;
  const preview = (): ReturnType<typeof transcribePreview> => transcribePreview();

  // Apply-flash state — local to the toolbar, fires only on a successful
  // commit. The flash lasts 1.5s and persists even after the buffer
  // is cleared (otherwise the user would never see "Применено" —
  // the pill would hide as soon as the buffer empties).
  const [applyFlash, setApplyFlash] = createSignal(false);
  const [appliedCount, setAppliedCount] = createSignal(0);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  const handleApply = (): void => {
    const bufLen = recBuffer().length;
    applyToScore();
    // applyToScore cleared the buffer only on success. Show flash only
    // when something actually got committed.
    if (recBuffer().length < bufLen) {
      setAppliedCount(bufLen);
      setApplyFlash(true);
      if (flashTimer !== null) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        setApplyFlash(false);
        flashTimer = null;
      }, APPLY_FLASH_MS);
    }
  };

  const pillPayload = (): ReturnType<typeof previewPillPayload> => previewPillPayload();

  return (
    <>
      <style>{`
.piano-transcribe-preview {
  margin-top: var(--space-2xs);
  padding: var(--space-2xs) var(--space-sm);
  background: var(--surface-2);
  border: 1px solid var(--primary);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  max-width: 100%;
  overflow: hidden;
}
.piano-transcribe-preview__row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.piano-transcribe-preview__score {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--space-2xs) var(--space-xs);
  background: var(--surface-1);
  border-radius: var(--radius-sm);
  color: var(--fg);
  font-size: var(--fs-2xs);
  overflow-x: auto;
  white-space: nowrap;
}
.piano-transcribe-preview__summary {
  color: var(--fg-dim);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.piano-transcribe-preview__hint {
  color: var(--fg-dim);
  font-size: var(--fs-2xs);
  opacity: 0.8;
}
.piano-transcribe-preview__apply,
.piano-transcribe-preview__cancel {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--space-sm);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: color var(--dur-xs) var(--ease), background var(--dur-xs) var(--ease);
}
.piano-transcribe-preview__apply {
  color: var(--ok);
  border-color: var(--ok);
}
.piano-transcribe-preview__apply:hover {
  background: var(--ok);
  color: var(--fg-inverse);
}
.piano-transcribe-preview__cancel {
  color: var(--fg-dim);
}
.piano-transcribe-preview__cancel:hover {
  color: var(--warn);
  border-color: var(--warn);
}
.piano-transcribe-preview[data-valid='false'] .piano-transcribe-preview__score {
  color: var(--warn);
  border: 1px solid var(--warn);
}
`}</style>
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
      <div class="piano-slot-selector" role="group" aria-label="Куда применить записанные ноты">
        <For each={SLOTS}>
          {(slot) => {
            const isActive = (): boolean => pianoSlot() === slot.id;
            const isDisabled = (): boolean =>
              slot.id === 'at-cursor' && !editorFocused();
            const title = (): string => {
              if (isDisabled() && slot.titleDisabled !== undefined) {
                return slot.titleDisabled;
              }
              return slot.titleEnabled;
            };
            return (
              <button
                type="button"
                class="piano-slot-btn"
                data-slot={slot.id}
                data-active={isActive() ? 'true' : 'false'}
                disabled={isDisabled()}
                title={title()}
                aria-label={slot.ariaLabel}
                aria-pressed={isActive()}
                onClick={() => setPianoSlot(slot.id)}
              >
                {pianoSlotGlyph(slot.id)}
              </button>
            );
          }}
        </For>
      </div>
      <Show when={canApply()}>
        <button
          type="button"
          class="piano-apply-btn"
          onClick={handleApply}
          title="Применить записанные ноты к score"
          aria-label="Применить записанные ноты к score"
        >
          ↑ apply
        </button>
      </Show>
      <Show when={canTranscribe()}>
        <label
          class="piano-transcribe-bpm"
          title="BPM для транскрипции (определяет сетку 1/16)"
        >
          <span class="piano-transcribe-bpm__label">BPM</span>
          <input
            type="number"
            class="piano-transcribe-bpm__input"
            min="30"
            max="300"
            step="1"
            value={transcribeBpm()}
            onInput={(e) => {
              const next = Number.parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(next) && next > 0) setTranscribeBpm(next);
            }}
            aria-label="BPM для транскрипции"
          />
        </label>
        <button
          type="button"
          class="piano-transcribe-btn"
          data-active={preview() !== null ? 'true' : 'false'}
          onClick={() => transcribe(transcribeBpm())}
          title="Транскрибировать записанные ноты в Strudel-score"
          aria-label="Транскрибировать записанные ноты в Strudel-score"
          aria-pressed={preview() !== null}
        >
          🎼 transcribe
        </button>
      </Show>
      <Show when={applyFlash() || (recEnabled() && pillPayload() !== null)}>
        <Show
          when={applyFlash()}
          fallback={
            <Show when={pillPayload()}>
              {(payload) => (
                <span
                  class="piano-rec-pill"
                  data-active={recEnabled() ? 'true' : 'false'}
                  data-slot={payload().slot}
                  aria-live="polite"
                >
                  <span class="piano-rec-pill__dot" aria-hidden="true" />
                  <span class="piano-rec-pill__count">
                    REC: {payload().count} н{payload().count === 1 ? 'ота' : 'от'}
                  </span>
                  <span class="piano-rec-pill__notes">
                    {payload().firstNames.join(' ')}
                    {payload().overflow > 0 ? ` +${payload().overflow}` : ''}
                  </span>
                  <span class="piano-rec-pill__arrow" aria-hidden="true">
                    →
                  </span>
                  <span class="piano-rec-pill__slot">{pianoSlotLabel(payload().slot)}</span>
                </span>
              )}
            </Show>
          }
        >
          <span
            class="piano-rec-pill piano-rec-pill--applied"
            data-applied="true"
            aria-live="polite"
          >
            ✓ Применено → {appliedCount()} н{appliedCount() === 1 ? 'ота' : 'от'}
          </span>
        </Show>
      </Show>
      <div class="piano-instrument-selector" role="group" aria-label="Инструмент пианино">
        <For each={INSTRUMENTS}>
          {(inst) => (
            <button
              type="button"
              class="piano-inst-btn"
              data-active={instrument() === inst ? 'true' : 'false'}
              data-instrument={inst}
              onClick={() => setInstrument(inst)}
              title={INSTRUMENT_TITLE[inst]}
              aria-label={`Инструмент: ${INSTRUMENT_LABEL[inst]}`}
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
          <Show when={props.onRetryMidi}>
            {(retry) => (
              <button
                type="button"
                class="piano-midi-retry"
                onClick={() => retry()}
                title="Запросить доступ к MIDI ещё раз"
              >
                ↻
              </button>
            )}
          </Show>
        </span>
      </Show>
    </div>
    <Show when={preview()}>
      {(p) => (
        <div
          class="piano-transcribe-preview"
          data-valid={p().summary.valid ? 'true' : 'false'}
          data-bpm={p().bpm}
          aria-live="polite"
        >
          <div class="piano-transcribe-preview__row">
            <code class="piano-transcribe-preview__score">{p().score}</code>
            <span class="piano-transcribe-preview__summary">{p().summaryText}</span>
          </div>
          <div class="piano-transcribe-preview__row">
            <span class="piano-transcribe-preview__hint">
              cps ≈ {(p().bpm / 60).toFixed(2)} для темпа записи · .s("{p().instrument}")
            </span>
            <button
              type="button"
              class="piano-transcribe-preview__apply"
              onClick={() => applyTranscription()}
              title="Заменить score этой транскрипцией"
              aria-label="Применить транскрипцию"
            >
              ✓ Apply
            </button>
            <button
              type="button"
              class="piano-transcribe-preview__cancel"
              onClick={() => cancelTranscription()}
              title="Отменить транскрипцию"
              aria-label="Отменить транскрипцию"
            >
              ✗ Cancel
            </button>
          </div>
        </div>
      )}
    </Show>
    </>
  );
};