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
 * Six affordances:
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
 *   6. Instrument selector — 4 inline buttons (△ ∿ ⊿ ⊓), amber when
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

const instrumentGlyph = (inst: PianoInstrument): string => {
  switch (inst) {
    case 'triangle': return '△';
    case 'sine': return '∿';
    case 'sawtooth': return '⊿';
    case 'square': return '⊓';
    default: return inst;
  }
};

/** Duration of the "✓ Применено" pill flash after a successful apply. */
const APPLY_FLASH_MS = 1500;

export const PianoToolbar = (props: PianoToolbarProps): JSX.Element => {
  const midiPillTone = (): 'ok' | 'pending' => {
    const s = props.midiStatus ?? '';
    return /^MIDI:\s+\d+\s+device/.test(s) ? 'ok' : 'pending';
  };

  const canApply = (): boolean => recEnabled() && recBuffer().length > 0;

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