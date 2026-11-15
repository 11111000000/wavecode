import { For, Show, createSignal, type JSX } from 'solid-js';
import {
  micListening,
  micError,
  micSlot,
  micInstrument,
  micPreviewNotes,
  micTransients,
  micEditorFocused,
  micDetectionActive,
  previewPillPayload,
  startMic,
  stopMic,
  clearPreview,
  applyToScore,
  setMicInstrument,
  setMicSlot,
  type MicSlot,
} from '../state/micStore';
import { evalScore, stopAudio } from '../state/audioActions';
import { openKindSheet } from '../state/uiState';
import { micSnippetFromBuffers } from '~/domain/audio/micSnippet';
import { MELODIC_SOUNDS, DRUMS_ONLY_ID } from '~/domain/sounds';
import { PianoRollPreview } from './PianoRollPreview';
import { MicMeter } from './MicMeter';
import { primeMicAudioContext } from '~/infrastructure/audio/micAudioContext';

/**
 * MicPanel — UX-redesigned inline live-transcription toolbar.
 *
 * 4-row mobile-first layout (5 columns on desktop via CSS grid):
 *
 *   row 1 — status pill · instrument selector · slot selector
 *   row 2 — big START/STOP CTA · big APPLY CTA · small reset · small preview
 *   row 3 — Live timeline (PianoRollPreview) — empty state OR recent notes/drums
 *   row 4 — RMS meter (MicMeter) — bar + onset spikes + Hz/RMS read-out
 *
 * Empty state (when nothing's been recorded AND mic isn't listening):
 * a single centered "Tap START and sing / tap / hum." hint with a
 * toggleable "Learn more" paragraph. No demo button — wavecode already
 * has a whole library of ready presets on the landing screen; the mic
 * is a pure INPUT control, not a showcase.
 *
 * The slot selector has exactly two targets: append to the end of the
 * current `stack(...)`, or insert at the editor cursor. "Replace all"
 * was removed — overwriting the whole score is too destructive for a
 * one-tap control (the user can always delete text by hand).
 *
 * What lives here vs. in the store:
 *   - The CTA handlers (start/stop, apply, clear, preview) are thin
 *     one-liners delegating to the store. No Web Audio here.
 *   - The Preview toggle and "Add to score" BOTH build their snippet
 *     through `micSnippetFromBuffers` (domain) so what you hear in
 *     preview is byte-for-byte what lands in the editor.
 *
 * Error pill: when `getUserMedia` rejects, we surface the raw error
 * string + a per-browser link to the mic-permission page. Same logic
 * as the legacy panel — we keep the recovery path intact because
 * mic permission issues are the #1 reason this feature doesn't work
 * on first try.
 */

/**
 * The instrument options of the mic panel.
 *
 * The list comes from the sound catalogue (`domain/sounds.ts`) — the
 * set of names superdough REALLY has. The old hard-coded trio
 * ('piano' / 'synth' / 'drums') was mostly fiction: `synth` and
 * `drums` were never registered, so choosing them committed a snippet
 * that threw `sound synth not found!` on playback. `piano` was
 * registered only as `piano_a4` (a single sample), so it played two
 * octaves above the written note.
 *
 * `drums` stays as the last entry, but it is the PSEUDO instrument
 * "drums only": the note layer is dropped and only the tapped hits
 * are committed.
 */
const INSTRUMENTS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly glyph: string;
}> = [
  ...MELODIC_SOUNDS.map((s) => ({ id: s.id, label: s.label, glyph: s.glyph })),
  { id: DRUMS_ONLY_ID, label: 'Только барабаны', glyph: '🥁' },
];

const SLOTS: ReadonlyArray<{
  readonly id: MicSlot;
  readonly label: string;
  readonly ariaLabel: string;
}> = [
  {
    id: 'append-stack',
    label: 'В конец',
    ariaLabel: 'Дописать записанный фрагмент в конец текущего стека',
  },
  {
    id: 'at-cursor',
    label: 'В курсор',
    ariaLabel: 'Вставить записанный фрагмент в позицию курсора',
  },
];

/** Per-browser link to the mic-permission page. null = no public URL
 *  (Safari), in which case the UI shows "разрешите в настройках
 *  браузера" with no link. */
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
  const [showHelp, setShowHelp] = createSignal(false);
  const [previewing, setPreviewing] = createSignal(false);

  /** Empty state shows when there's nothing to record, nothing to
   *  show, and nothing went wrong. As soon as the user starts the
   *  mic OR records a note OR hits an error, we drop into the full
   *  layout so they can see the meter / fix the error. */
  const isEmpty = (): boolean =>
    !micListening()
    && micPreviewNotes().length === 0
    && micTransients().length === 0
    && micError() === null;

  const isMicPermissionError = (): boolean => {
    const err = micError();
    if (err === null) return false;
    return /denied|permission|notallowed|mic-permission/i.test(err);
  };

  const onToggleMic = (): void => {
    if (micListening()) {
      stopMic();
      return;
    }
    // The pitch analyser needs an AudioContext, and on iOS it only
    // runs if it was created AND started inside this tap — a context
    // created after the microphone prompt stays suspended and the
    // analyser reads zeroes. See `micAudioContext.ts`.
    primeMicAudioContext();
    startMic();
  };

  /** Preview toggle: when ON, the recorded snippet plays through the
   *  running audio engine; when OFF, the engine stops. The snippet is
   *  built via the same domain function `applyToScore` uses, so the
   *  preview is exactly what would land in the editor. */
  const onTogglePreview = (): void => {
    const next = !previewing();
    setPreviewing(next);
    if (next) {
      const snippet = micSnippetFromBuffers(
        micPreviewNotes(),
        micTransients(),
        { instrument: micInstrument() },
      );
      if (snippet !== null) {
        void evalScore(snippet);
      }
    } else {
      void stopAudio();
    }
  };

  const slotTitle = (slot: MicSlot): string => {
    if (slot !== 'at-cursor') return `→ ${SLOTS.find((s) => s.id === slot)?.label ?? ''}`;
    return micEditorFocused()
      ? '⌖ вставить в позицию курсора'
      : '⌖ курсор — сначала щёлкните в редакторе';
  };

  return (
    <div
      class="mic-ux-panel"
      data-state={micDetectionActive()}
      data-listening={micListening()}
      data-empty={isEmpty() ? 'true' : 'false'}
    >
      {/* Permission-denied banner — surfaced ABOVE the controls so
          the user understands why START is a no-op. Previously lived
          as a small inline pill at the bottom of the panel; users
          hit it after pressing START, missed the pill, and gave up.
          Now it's the first thing they see when getUserMedia rejects
          the request (browser shows its own prompt only on a fresh
          gesture; on repeat sessions with remembered-denied state
          the panel needs to spell out the recovery path). */}
      <Show when={micError() !== null && isMicPermissionError()}>
        <div class="mic-permission-banner" role="alert">
          <span class="mic-permission-banner__icon" aria-hidden="true">🎤</span>
          <div class="mic-permission-banner__body">
            <p class="mic-permission-banner__title">Браузер блокирует микрофон</p>
            <p class="mic-permission-banner__msg">{micError()}</p>
            <Show when={micPermissionUrl() === null} fallback={<PermissionHint />}>
              <p class="mic-permission-banner__hint">
                Откройте настройки браузера и разрешите доступ к микрофону для этого сайта.
              </p>
            </Show>
          </div>
        </div>
      </Show>

      {/* Empty-state hint — a compact banner, not a full replacement.
          The controls below are ALWAYS visible so the user always has
          a way to start recording. */}
      <Show when={isEmpty()}>
        <EmptyState
          showHelp={showHelp()}
          onToggleHelp={() => setShowHelp(!showHelp())}
        />
      </Show>

      <div class="mic-ux-row-status">
        <PreviewPill />
        <InstrumentSelector />
        <SlotSelect slotTitle={slotTitle} />
      </div>

      <div class="mic-ux-row-cta mic-ux-row-cta--multi">
        <button
          type="button"
          class="mic-ux-cta"
          data-cta="start"
          data-listening={micListening()}
          aria-pressed={micListening()}
          aria-label={micListening() ? 'Остановить микрофон' : 'Включить микрофон'}
          title={micListening() ? 'Прекратить запись' : 'Начать запись — разрешите доступ к микрофону'}
          onClick={onToggleMic}
        >
          <span>{micListening() ? '■ СТОП' : '◆ СТАРТ'}</span>
        </button>
        <button
          type="button"
          class="mic-ux-cta"
          data-cta="apply"
          aria-label="Применить записанный фрагмент к партитуре"
          title="Применить через активный слот"
          disabled={micPreviewNotes().length === 0 && micTransients().length === 0}
          onClick={() => applyToScore()}
        >
          <span>⌃ В партитуру</span>
        </button>
        <button
          type="button"
          class="mic-ux-cta-sm"
          data-cta="reset"
          aria-label="Сбросить предпрослушивание"
          title="Очистить предпрослушивание (Ctrl+Z не работает — буфер локальный)"
          disabled={micPreviewNotes().length === 0 && micTransients().length === 0}
          onClick={() => clearPreview()}
        >
          + сброс
        </button>
        <button
          type="button"
          class="mic-ux-preview-toggle"
          data-cta="preview"
          data-active={previewing() ? 'true' : 'false'}
          aria-pressed={previewing()}
          aria-label={previewing() ? 'Остановить предпрослушивание' : 'Проиграть записанный фрагмент'}
          title={previewing() ? 'Остановить' : 'Услышать записанный фрагмент в текущем звуке'}
          disabled={micPreviewNotes().length === 0 && micTransients().length === 0}
          onClick={onTogglePreview}
        >
          {previewing() ? '■ стоп превью' : '👁 превью'}
        </button>
        <button
          type="button"
          class="mic-ux-cta-sm"
          data-cta="gesture"
          aria-label="Открыть панель управления жестами"
          title="Управляйте музыкой руками — камера включается только по запросу"
          onClick={() => openKindSheet('gesture', 'half')}
        >
          ✋ руки
        </button>
      </div>

      <div class="mic-ux-row-roll">
        <div class="mic-ux-roll-header">Живая лента</div>
        <PianoRollPreview
          notes={micPreviewNotes()}
          transients={micTransients()}
        />
      </div>

      <MicMeter />

      {/* Inline non-permission error pill — kept for non-permission
          failures (e.g., `getUserMedia` timeout, AudioContext issues)
          so the existing narrow feedback path stays intact. */}
      <Show when={micError() !== null && !isMicPermissionError()}>
        <span class="mic-error-pill" role="alert">
          ✕ {micError()}
        </span>
      </Show>
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────

const PreviewPill = (): JSX.Element => {
  const payload = (): ReturnType<typeof previewPillPayload> => previewPillPayload();
  const isPillEmpty = (): boolean => payload() === null;
  return (
    <span
      class="mic-ux-pill"
      data-empty={isPillEmpty() ? 'true' : 'false'}
      data-detection={micDetectionActive()}
      aria-live="polite"
    >
      {(() => {
        const p = payload();
        if (p === null) return 'нет превью';
        const overflow = p.overflow > 0 ? ` +${p.overflow}` : '';
        const pruned = p.pruned > 0 ? ` [+${p.pruned}]` : '';
        return `● ${p.firstNames.join(' ')}${overflow}${pruned}`;
      })()}
    </span>
  );
};

/**
 * The instrument picker.
 *
 * A native <select> rather than a row of buttons: the catalogue has
 * 15 melodic sounds plus the drums-only mode, and 16 buttons do not
 * fit a 360 px phone. The OS picker sheet is the one control that
 * behaves well on a phone.
 */
const InstrumentSelector = (): JSX.Element => (
  <label class="mic-ux-inst-selector" aria-label="Инструмент">
    <span class="mic-ux-inst-glyph" aria-hidden="true">
      {INSTRUMENTS.find((i) => i.id === micInstrument())?.glyph ?? '♪'}
    </span>
    <select
      class="mic-ux-inst-select"
      value={micInstrument()}
      onChange={(e) => { setMicInstrument(e.currentTarget.value); }}
    >
      <For each={INSTRUMENTS}>
        {(inst) => (
          <option value={inst.id} data-instrument={inst.id}>
            {inst.label}
          </option>
        )}
      </For>
    </select>
  </label>
);

const SlotSelect = (props: {
  readonly slotTitle: (slot: MicSlot) => string;
}): JSX.Element => (
  <label class="mic-ux-slot-select-wrap" aria-label="Слот">
    <select
      class="mic-ux-slot-select"
      data-slot={micSlot()}
      data-active-slot={micSlot()}
      title={props.slotTitle(micSlot())}
      onChange={(e): void => {
        const v = e.currentTarget.value;
        if (v === 'append-stack' || v === 'at-cursor') {
          setMicSlot(v);
        }
      }}
    >
      <For each={SLOTS}>
        {(s) => {
          const disabled = (): boolean => s.id === 'at-cursor' && !micEditorFocused();
          return (
            <option
              value={s.id}
              disabled={disabled()}
              aria-label={s.ariaLabel}
              title={disabled() ? 'Вставка по курсору требует фокуса в редакторе' : s.ariaLabel}
            >
              {s.label}
            </option>
          );
        }}
      </For>
    </select>
  </label>
);

const EmptyState = (props: {
  readonly showHelp: boolean;
  readonly onToggleHelp: () => void;
}): JSX.Element => (
  <div class="mic-ux-empty" role="region" aria-label="О микрофоне">
    <div class="mic-ux-empty-title">Нажмите START и спойте, постучите или напойте.</div>
    <div class="mic-ux-empty-sub">
      Попробуйте барабан, битбокс или мелодию.
    </div>
    <div class="mic-ux-empty-actions">
      <button
        type="button"
        class="mic-ux-empty-help"
        aria-expanded={props.showHelp}
        aria-label="Показать или скрыть подсказку"
        title="Показать или скрыть подсказку"
        onClick={(): void => { props.onToggleHelp(); }}
      >
        {props.showHelp ? '− скрыть подсказку' : '+ подробнее'}
      </button>
    </div>
    <Show when={props.showHelp}>
      <p class="mic-ux-empty-help-text">
        Микрофон одновременно распознаёт два: sustained pitch (голос или свист
        превращаются в MIDI-ноты) и перкуссионные атаки (стук по столу или
        хлоп превращаются в удар). Оба видны на живой шкале над индикатором;
        нажми «⌃ В партитуру», чтобы вставить их в выбранный слот.
      </p>
    </Show>
  </div>
);

/** Inline permission hint rendered when the browser has a public URL
 *  for the mic-permission page (Chromium-family + Firefox). Safari
 *  has no public URL — see the parent <Show> fallback for that path. */
const PermissionHint = (): JSX.Element => (
  <>
    <a
      href={micPermissionUrl() ?? '#'}
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