import { For, Show, type JSX } from 'solid-js';
import {
  whistleListening,
  whistleState,
  whistleError,
  whistlePreviewNotes,
  whistleCurrentHz,
  whistleCurrentRms,
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
 * Rendered inside `ScorePanel` once the user expands the `▼ Whistle`
 * toggle. Mirrors PianoToolbar's affordance language so users with
 * the on-screen piano + this panel see consistent controls.
 *
 * Six affordances:
 *   1. Mic toggle (`🎙` button) — starts/stops the detector. Label
 *      reflects detector phase (idle / requesting-mic / streaming /
 *      errored) so the user understands why nothing happens.
 *   2. Dual meter — RMS bar (the mic is hearing sound) + Hz label
 *      (the detected pitch). RMS is the "is this working" indicator;
 *      Hz is the "what pitch is it reading" indicator. A user
 *      humming without pitch sees RMS fill but Hz stay 0 — that
 *      tells them mic is live but their input is non-tonal.
 *   3. Slot segmented control — `↵ stack` / `⟳ replace` / `⌖ cursor`.
 *      `⌖ cursor` is disabled when the editor isn't focused; tooltip
 *      tells the user to tap into the editor first. Each slot has a
 *      full sentence in `title=` so the destructive/non-destructive
 *      distinction is clear.
 *   4. Instrument selector — same 8 options as the piano.
 *   5. Freeze / Clear / Apply row:
 *      - `❄ freeze` — forces the open note to close (commits any
 *        sustained note into the preview).
 *      - `⌫ clear` — drops the preview buffer.
 *      - `↑ apply` — visible only when preview is non-empty. Calls
 *        `applyToScore()` which dispatches via the active slot.
 *   6. Preview-pill — "● 5 нот: c4 e4 g4 e4 c4 → конец стека".
 *
 * Error pill:
 *   When `getUserMedia` rejects (PermissionDenied / NotAllowedError),
 *   the browser doesn't render a "how to fix" UI; we surface the
 *   raw error string + a "open browser settings" hint with the
 *   correct per-browser link to the mic-permission page.
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
    ariaLabel: 'Слот: дописать в конец стека — безопасный, не разрушает score',
    titleEnabled: '↵ stack — дописать в конец существующего stack(...) (или обернуть оба).',
    titleDisabled: undefined,
  },
  {
    id: 'replace-score',
    ariaLabel: 'Слот: заменить весь score — destructive, отменяется undo',
    titleEnabled: '⟳ replace — заменить весь score на новый snippet. Отменяется через Ctrl+Z.',
    titleDisabled: undefined,
  },
  {
    id: 'at-cursor',
    ariaLabel: 'Слот: вставить в позицию курсора — нужен фокус в редакторе',
    titleEnabled: '⌖ cursor — вставить snippet в текущую позицию курсора в редакторе.',
    titleDisabled: '⌖ cursor — сначала кликните в редактор (нужен фокус).',
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

/**
 * Returns a per-browser link to the mic-permission page, or `null`
 * when we can't infer the browser. The link is shown alongside the
 * error-pill so the user can unblock themselves in one click.
 *
 * Chromium / Edge / Brave: `chrome://settings/content/microphone`
 * Firefox:                 `about:preferences#privacy-microphone`
 * Safari:                  no public URL — the user has to dig into
 *                           Safari → Settings → Websites → Microphone.
 */
const micPermissionUrl = (): string | null => {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua) || /OPR\//.test(ua) || /Chrome\//.test(ua) || /Brave\//.test(ua)) {
    return 'chrome://settings/content/microphone';
  }
  if (/Firefox\//.test(ua)) {
    return 'about:preferences#privacy-microphone';
  }
  return null;
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

  const isMicPermissionError = (): boolean => {
    const err = whistleError();
    if (err === null) return false;
    return /denied|permission|notallowed|mic-permission/i.test(err);
  };

  return (
    <div class="whistle-panel" data-state={whistleState()}>
      <div class="whistle-row whistle-row-primary">
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
        <span class="whistle-hz-readout" aria-live="polite">
          {(() => {
            const hz = whistleCurrentHz();
            const rms = whistleCurrentRms();
            if (whistleState() === 'streaming' && rms < 0.005) {
              return 'тихо — свисти громче';
            }
            if (hz === null) return '— Hz';
            return `${Math.round(hz)} Hz`;
          })()}
        </span>
      </div>

      <div class="whistle-slot-row" role="group" aria-label="Куда применить">
        <span class="whistle-row-label">→</span>
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
        <span class="whistle-row-label">s(</span>
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
        <span class="whistle-row-label">)</span>
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
          <Show when={isMicPermissionError()}>
            <span class="whistle-error-hint">
              {' '}—{' '}
              {(() => {
                const url = micPermissionUrl();
                if (url === null) {
                  return 'разрешите доступ к микрофону в настройках браузера';
                }
                return (
                  <>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      class="whistle-error-link"
                    >
                      разрешите в настройках браузера
                    </a>
                    <span class="whistle-error-paste-hint">
                      {' '}(откройте эту ссылку вручную — браузер не открывает chrome:// автоматически)
                    </span>
                  </>
                );
              })()}
            </span>
          </Show>
        </span>
      </Show>
    </div>
  );
}

/**
 * Dual meter: two stacked bars in the SVG.
 *   - Outer bar (background): fixed full width, low opacity.
 *   - Inner bar (foreground): width proportional to `whistleCurrentRms()`.
 *     This is the "is the mic hearing sound" indicator — it fills
 *     whenever the input is above the silence floor, regardless of
 *     whether pitchy can lock a pitch.
 *
 * Pitch read-out (Hz) is rendered as a text label next to the
 * button in the parent component, not in the SVG.
 */
function WhistleMeter(): JSX.Element {
  const MIN_HZ = 100;
  const MAX_HZ = 1500;
  const hzLevel = (): number => {
    const hz = whistleCurrentHz();
    if (hz === null) return 0;
    return Math.max(0, Math.min(1, (hz - MIN_HZ) / (MAX_HZ - MIN_HZ)));
  };
  // RMS mapped 0..0.3 → 0..1 (clip to 1); 0.3 ≈ loud speech
  const rmsLevel = (): number => {
    const r = whistleCurrentRms();
    return Math.max(0, Math.min(1, r / 0.3));
  };
  return (
    <svg
      class="whistle-meter"
      width="44"
      height="14"
      viewBox="0 0 44 14"
      aria-hidden="true"
      data-listening={whistleListening()}
    >
      {/* RMS bar — top row */}
      <rect x="0" y="1" width="44" height="3" rx="1" fill="currentColor" opacity="0.18" />
      <rect
        x="0"
        y="1"
        width={44 * rmsLevel()}
        height="3"
        rx="1"
        fill="currentColor"
        opacity="0.7"
      />
      {/* Hz bar — bottom row */}
      <rect x="0" y="9" width="44" height="3" rx="1" fill="currentColor" opacity="0.18" />
      <rect
        x="0"
        y="9"
        width={44 * hzLevel()}
        height="3"
        rx="1"
        fill="currentColor"
      />
    </svg>
  );
}
