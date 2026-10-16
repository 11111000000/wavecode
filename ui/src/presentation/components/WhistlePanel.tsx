import { For, Show, type JSX } from 'solid-js';
import {
  whistleListening,
  whistleState,
  whistleError,
  whistlePreviewNotes,
  whistleCurrentHz,
  whistleSlot,
  whistleInstrument,
  whistleEditorFocused,
  toggleWhistleSlot,
  startWhistle,
  stopWhistle,
  freezePreview,
  clearPreview,
  applyToScore,
  setWhistleInstrument,
  whistleSlotLabel,
  whistleSlotGlyph,
  previewPillPayload,
  type WhistleSlot,
} from '../state/whistleStore';

/**
 * WhistlePanel — inline live-transcription toolbar.
 *
 * Rendered next to (or below) `MiniNotationToolbar` inside `ScorePanel`.
 * Reads everything from `whistleStore` and routes user actions back
 * through it; no infrastructure imports here.
 *
 * Six affordances:
 *   1. Mic toggle (`🎙` button) — starts/stops the detector. Label
 *      reflects detector phase (idle / requesting-mic / streaming /
 *      errored) so the user understands why nothing happens.
 *   2. Live Hz meter — tiny SVG arc that fills as `currentHz()` rises
 *      into the audible whistle range (~200-1500Hz). Mirrors the
 *      Visualizer's affordance-language but stays compact (24×24).
 *   3. Slot segmented control — `↵ stack` / `⟳ replace` / `⌖ cursor`.
 *      `⌖ cursor` is disabled when the editor isn't focused; tooltip
 *      tells the user to tap into the editor first. Mirrors
 *      PianoToolbar's slot selector exactly so users with two
 *      mental-models (piano + mic) don't have to relearn the verbs.
 *   4. Instrument selector — same 8 options as the piano (piano/...
 *      triangle/sine/sawtooth/square). The committed snippet uses
 *      `s("${instrument}")`.
 *   5. Freeze / Clear / Apply row:
 *      - `❄ freeze` — forces the open note to close (commits any
 *        sustained note into the preview).
 *      - `⌫ clear` — drops the preview buffer.
 *      - `↑ apply` — visible only when preview is non-empty. Calls
 *        `applyToScore()` which dispatches via the active slot.
 *   6. Preview-pill — "● 5 нот: c4 e4 g4 e4 c4 → конец стека".
 *      Same shape as PianoToolbar's preview pill — keeps mobile
 *      BottomSheet parity.
 *
 * The MIDI-status / native error messaging is rendered inline (no
 * toasts) so the user can read what failed (mic-permission-timeout
 * is a common case; we emit the message verbatim).
 */

const INSTRUMENTS: ReadonlyArray<string> = [
  'piano', 'casio', 'guitar', 'synth',
  'triangle', 'sine', 'sawtooth', 'square',
];

const INSTRUMENT_LABEL: Record<string, string> = {
  piano:    'Piano',
  casio:    'Casio',
  guitar:   'Guitar',
  synth:    'Synth',
  triangle: '△',
  sine:     '∿',
  sawtooth: '⊿',
  square:   '⊓',
};

const SLOTS: ReadonlyArray<{
  readonly id: WhistleSlot;
  readonly ariaLabel: string;
  readonly titleEnabled: string;
  readonly titleDisabled: string | undefined;
}> = [
  {
    id: 'append-stack',
    ariaLabel: 'Слот: конец стека — дописать как слой',
    titleEnabled: 'Записать в конец стека',
    titleDisabled: undefined,
  },
  {
    id: 'replace-score',
    ariaLabel: 'Слот: заменить весь score',
    titleEnabled: 'Заменить весь score — destructive',
    titleDisabled: undefined,
  },
  {
    id: 'at-cursor',
    ariaLabel: 'Слот: вставить в позицию курсора',
    titleEnabled: 'Вставить в курсор',
    titleDisabled: 'Курсор недоступен — кликните в редактор',
  },
];

const STATE_LABEL: Record<string, string> = {
  idle:             '🎙 Listen',
  'requesting-mic': '…запрос микрофона',
  'starting-audio': '…старт аудио',
  streaming:        '● Слушаю',
  stopping:         '…стоп',
  errored:          '✕ ошибка',
};

export function WhistlePanel(): JSX.Element {
  const onToggleMic = (): void => {
    if (whistleListening()) stopWhistle();
    else startWhistle();
  };

  const slotTitle = (slot: WhistleSlot): string => {
    if (slot !== 'at-cursor') {
      return SLOTS.find((s) => s.id === slot)?.titleEnabled ?? '';
    }
    return whistleEditorFocused()
      ? (SLOTS.find((s) => s.id === slot)?.titleEnabled ?? '')
      : (SLOTS.find((s) => s.id === slot)?.titleDisabled ?? '');
  };

  return (
    <div class="whistle-panel" data-state={whistleState()}>
      <button
        type="button"
        class="whistle-mic-btn"
        data-listening={whistleListening()}
        aria-pressed={whistleListening()}
        aria-label={whistleListening() ? 'Остановить прослушивание микрофона' : 'Начать прослушивание микрофона'}
        title={whistleListening() ? 'Остановить' : 'Свистни в микрофон → транскрипция в Strudel'}
        onClick={onToggleMic}
      >
        <span class="whistle-mic-label">{STATE_LABEL[whistleState()] ?? '🎙'}</span>
        <WhistleMeter />
      </button>

      <div class="whistle-slot-row" role="group" aria-label="Куда применить">
        <For each={SLOTS}>
          {(s) => {
            const isActive = (): boolean => whistleSlot() === s.id;
            const isDisabled = (): boolean =>
              s.id === 'at-cursor' && !whistleEditorFocused();
            return (
              <button
                type="button"
                class="whistle-slot-btn"
                data-slot={s.id}
                data-active={isActive()}
                data-disabled={isDisabled()}
                aria-label={s.ariaLabel}
                title={slotTitle(s.id)}
                disabled={isDisabled()}
                onClick={() => toggleWhistleSlot()}
              >
                {whistleSlotGlyph(s.id)}
              </button>
            );
          }}
        </For>
        <span class="whistle-slot-label">{whistleSlotLabel(whistleSlot())}</span>
      </div>

      <div class="whistle-instrument-row" role="group" aria-label="Инструмент">
        <For each={INSTRUMENTS}>
          {(inst) => (
            <button
              type="button"
              class="whistle-inst-btn"
              data-active={whistleInstrument() === inst}
              aria-label={`Instrument: ${inst}`}
              title={`Инструмент: ${INSTRUMENT_LABEL[inst] ?? inst}`}
              onClick={() => setWhistleInstrument(inst)}
            >
              {INSTRUMENT_LABEL[inst] ?? inst}
            </button>
          )}
        </For>
      </div>

      <div class="whistle-action-row">
        <button
          type="button"
          class="whistle-action-btn"
          data-action="freeze"
          aria-label="Закрыть текущую ноту"
          title="Закрыть текущую ноту (если тянете долго)"
          disabled={!whistleListening()}
          onClick={() => freezePreview()}
        >
          ❄ freeze
        </button>
        <button
          type="button"
          class="whistle-action-btn"
          data-action="clear"
          aria-label="Очистить preview"
          title="Очистить буфер транскрипции"
          disabled={whistlePreviewNotes().length === 0}
          onClick={() => clearPreview()}
        >
          ⌫ clear
        </button>
        <button
          type="button"
          class="whistle-action-btn whistle-apply-btn"
          data-action="apply"
          aria-label="Применить preview в редактор"
          title="Применить preview через активный слот"
          disabled={whistlePreviewNotes().length === 0}
          onClick={() => applyToScore()}
        >
          ↑ apply
        </button>
      </div>

      <Show when={previewPillPayload() !== null}>
        {(() => {
          const p = previewPillPayload();
          if (p === null) return null;
          return (
            <span
              class="whistle-preview-pill"
              data-count={p.count}
              data-slot={p.slot}
              aria-label={`Preview: ${p.count} нот, целевой слот: ${p.slotLabel}`}
            >
              ● {p.count} нот: {p.firstNames.join(' ')}
              {p.overflow > 0 ? ` +${p.overflow}` : ''} → {p.slotLabel}
            </span>
          );
        })()}
      </Show>

      <Show when={whistleError() !== null}>
        <span class="whistle-error-pill" role="alert">
          ✕ {whistleError()}
        </span>
      </Show>
    </div>
  );
}

/**
 * Compact Hz meter — SVG arc, height proportional to current Hz on
 * the [100, 1500] range. Reads `whistleCurrentHz()` (set by
 * `onWhistleFrame` in the store). 24×24; matches the existing
 * Visualizer pill affordance-language so the user learns one motif.
 */
function WhistleMeter(): JSX.Element {
  const MIN_HZ = 100;
  const MAX_HZ = 1500;
  const level = (): number => {
    const hz = whistleCurrentHz();
    if (hz === null) return 0;
    const clamped = Math.max(MIN_HZ, Math.min(MAX_HZ, hz));
    return (clamped - MIN_HZ) / (MAX_HZ - MIN_HZ);
  };
  // Bar fills left-to-right; height 4px.
  return (
    <svg
      class="whistle-meter"
      width="40"
      height="6"
      viewBox="0 0 40 6"
      aria-hidden="true"
      data-listening={whistleListening()}
    >
      <rect x="0" y="2" width="40" height="2" rx="1" fill="currentColor" opacity="0.18" />
      <rect x="0" y="2" width={40 * level()} height="2" rx="1" fill="currentColor" />
    </svg>
  );
}
