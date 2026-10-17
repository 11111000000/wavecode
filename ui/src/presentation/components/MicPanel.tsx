import { For, Show, type JSX } from 'solid-js';
import {
  micListening,
  micState,
  micError,
  micPreviewNotes,
  micCurrentHz,
  micCurrentRms,
  micSlot,
  micInstrument,
  micEditorFocused,
  toggleMicSlot,
  startMic,
  stopMic,
  freezePreview,
  clearPreview,
  applyToScore,
  setMicInstrument,
  micSlotLabel,
  micSlotGlyph,
  previewPillPayload,
  type MicSlot,
} from '../state/micStore';

/**
 * MicPanel — inline live-transcription toolbar.
 *
 * Rendered inside `ScorePanel` once the user expands the `▼ Mic`
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
  readonly id: MicSlot;
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

export function MicPanel(): JSX.Element {
  const onToggleMic = (): void => {
    if (micListening()) stopMic();
    else startMic();
  };

  const slotTitle = (slot: MicSlot): string => {
    if (slot !== 'at-cursor') {
      return SLOTS.find((s) => s.id === slot)?.titleEnabled ?? '';
    }
    return micEditorFocused()
      ? (SLOTS.find((s) => s.id === slot)?.titleEnabled ?? '')
      : (SLOTS.find((s) => s.id === slot)?.titleDisabled ?? '');
  };

  const isMicPermissionError = (): boolean => {
    const err = micError();
    if (err === null) return false;
    return /denied|permission|notallowed|mic-permission/i.test(err);
  };

  return (
    <div class="mic-panel" data-state={micState()}>
      <div class="mic-row mic-row-primary">
        <button
          type="button"
          class="mic-mic-btn"
          data-listening={micListening()}
          aria-pressed={micListening()}
          aria-label={micListening() ? 'Остановить прослушивание микрофона' : 'Начать прослушивание микрофона'}
          title={micListening() ? 'Остановить' : 'Свистни в микрофон → транскрипция в Strudel'}
          onClick={onToggleMic}
        >
          <span class="mic-mic-label">{STATE_LABEL[micState()] ?? '🎙'}</span>
          <MicMeter />
        </button>
        <span class="mic-hz-readout" aria-live="polite">
          {(() => {
            const hz = micCurrentHz();
            const rms = micCurrentRms();
            if (micState() === 'streaming' && rms < 0.005) {
              return 'тихо — свисти громче';
            }
            if (hz === null) return '— Hz';
            return `${Math.round(hz)} Hz`;
          })()}
        </span>
      </div>

      <div class="mic-slot-row" role="group" aria-label="Куда применить">
        <span class="mic-row-label">→</span>
        <For each={SLOTS}>
          {(s) => {
            const isActive = (): boolean => micSlot() === s.id;
            const isDisabled = (): boolean =>
              s.id === 'at-cursor' && !micEditorFocused();
            return (
              <button
                type="button"
                class="mic-slot-btn"
                data-slot={s.id}
                data-active={isActive()}
                data-disabled={isDisabled()}
                aria-label={s.ariaLabel}
                title={slotTitle(s.id)}
                disabled={isDisabled()}
                onClick={() => toggleMicSlot()}
              >
                {micSlotGlyph(s.id)}
              </button>
            );
          }}
        </For>
        <span class="mic-slot-label">{micSlotLabel(micSlot())}</span>
      </div>

      <div class="mic-instrument-row" role="group" aria-label="Инструмент">
        <span class="mic-row-label">s(</span>
        <For each={INSTRUMENTS}>
          {(inst) => (
            <button
              type="button"
              class="mic-inst-btn"
              data-active={micInstrument() === inst}
              aria-label={`Instrument: ${inst}`}
              title={`Инструмент: ${INSTRUMENT_LABEL[inst] ?? inst}`}
              onClick={() => setMicInstrument(inst)}
            >
              {INSTRUMENT_LABEL[inst] ?? inst}
            </button>
          )}
        </For>
        <span class="mic-row-label">)</span>
      </div>

      <div class="mic-action-row">
        <button
          type="button"
          class="mic-action-btn"
          data-action="freeze"
          aria-label="Закрыть текущую ноту"
          title="Закрыть текущую ноту (если тянете долго)"
          disabled={!micListening()}
          onClick={() => freezePreview()}
        >
          ❄ freeze
        </button>
        <button
          type="button"
          class="mic-action-btn"
          data-action="clear"
          aria-label="Очистить preview"
          title="Очистить буфер транскрипции"
          disabled={micPreviewNotes().length === 0}
          onClick={() => clearPreview()}
        >
          ⌫ clear
        </button>
        <button
          type="button"
          class="mic-action-btn mic-apply-btn"
          data-action="apply"
          aria-label="Применить preview в редактор"
          title="Применить preview через активный слот"
          disabled={micPreviewNotes().length === 0}
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
              class="mic-preview-pill"
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

      <Show when={micError() !== null}>
        <span class="mic-error-pill" role="alert">
          ✕ {micError()}
          <Show when={isMicPermissionError()}>
            <span class="mic-error-hint">
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
                      class="mic-error-link"
                    >
                      разрешите в настройках браузера
                    </a>
                    <span class="mic-error-paste-hint">
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
 *   - Inner bar (foreground): width proportional to `micCurrentRms()`.
 *     This is the "is the mic hearing sound" indicator — it fills
 *     whenever the input is above the silence floor, regardless of
 *     whether pitchy can lock a pitch.
 *
 * Pitch read-out (Hz) is rendered as a text label next to the
 * button in the parent component, not in the SVG.
 */
function MicMeter(): JSX.Element {
  const MIN_HZ = 100;
  const MAX_HZ = 1500;
  const hzLevel = (): number => {
    const hz = micCurrentHz();
    if (hz === null) return 0;
    return Math.max(0, Math.min(1, (hz - MIN_HZ) / (MAX_HZ - MIN_HZ)));
  };
  // RMS mapped 0..0.3 → 0..1 (clip to 1); 0.3 ≈ loud speech
  const rmsLevel = (): number => {
    const r = micCurrentRms();
    return Math.max(0, Math.min(1, r / 0.3));
  };
  return (
    <svg
      class="mic-meter"
      width="44"
      height="14"
      viewBox="0 0 44 14"
      aria-hidden="true"
      data-listening={micListening()}
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
