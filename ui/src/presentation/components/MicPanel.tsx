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
import { PianoRollPreview } from './PianoRollPreview';
import { MicMeter } from './MicMeter';

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
 * a single centered "Tap START and sing / tap / hum." block with a
 * demo button + a toggleable "Learn more" paragraph. The user can
 * audition what the feature does without first figuring out how to
 * grant mic permission.
 *
 * What lives here vs. in the store:
 *   - The CTA handlers (start/stop, apply, clear, preview) are thin
 *     one-liners delegating to the store. No Web Audio here.
 *   - All reactive reads (`micListening`, `previewPillPayload`, ...)
 *     come from the adapter, not the underlying `micStore`. The
 *     adapter is the contract that survives the WS-A domain merge.
 *
 * Error pill: when `getUserMedia` rejects, we surface the raw error
 * string + a per-browser link to the mic-permission page. Same logic
 * as the legacy panel — we keep the recovery path intact because
 * mic permission issues are the #1 reason this feature doesn't work
 * on first try.
 */

const INSTRUMENTS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly glyph: string;
}> = [
  { id: 'piano',  label: 'Piano',     glyph: '🎹' },
  { id: 'synth',  label: 'Synth',     glyph: '🎚' },
  { id: 'drums',  label: 'Drum kit',  glyph: '🥁' },
];

const SLOTS: ReadonlyArray<{
  readonly id: MicSlot;
  readonly label: string;
  readonly ariaLabel: string;
}> = [
  {
    id: 'append-stack',
    label: 'Add to end',
    ariaLabel: 'Append the recorded snippet to the end of the existing stack',
  },
  {
    id: 'replace-score',
    label: 'Replace all',
    ariaLabel: 'Replace the whole score with the recorded snippet (Ctrl+Z to undo)',
  },
  {
    id: 'at-cursor',
    label: 'At cursor',
    ariaLabel: 'Insert the recorded snippet at the cursor position in the editor',
  },
];

/** Short Strudel snippet for the demo button. We pick a 4-on-the-
 *  floor kick because (a) it works without a long warm-up, (b) it's
 *  audible on the default sample bank (drums_bd), and (c) it mirrors
 *  what the user will hear when they actually tap a real mic. */
const DEMO_SNIPPET = 's("drums_bd*4").gain(0.6)';

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
    if (micListening()) stopMic();
    else startMic();
  };

  const onPlayDemo = (): void => {
    void evalScore(DEMO_SNIPPET);
  };

  /** Preview toggle: when ON, the recorded snippet plays through the
   *  running audio engine; when OFF, the engine stops. The snippet
   *  itself isn't rebuilt on buffer updates (that's a follow-up
   *  feature) — the user clicks again to replay after a new take. */
  const onTogglePreview = (): void => {
    const next = !previewing();
    setPreviewing(next);
    if (next) {
      // Build a minimal snippet inline. We don't dispatch — this
      // bypasses the editor entirely and only plays through the
      // audio engine (so the user can hear what they're about to
      // apply without committing it to the score).
      const notes = micPreviewNotes();
      const transients = micTransients();
      const snippet = buildDemoSnippet(notes, transients, micInstrument());
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
      ? '⌖ insert at cursor'
      : '⌖ cursor — focus the editor first';
  };

  return (
    <div
      class="mic-ux-panel"
      data-state={micDetectionActive()}
      data-listening={micListening()}
      data-empty={isEmpty() ? 'true' : 'false'}
    >
      {/* Empty-state hint — a compact banner, not a full replacement.
          The controls below are ALWAYS visible so the user always has
          a way to start recording. */}
      <Show when={isEmpty()}>
        <EmptyState
          showHelp={showHelp()}
          onToggleHelp={() => setShowHelp(!showHelp())}
          onPlayDemo={onPlayDemo}
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
          aria-label={micListening() ? 'Stop the mic' : 'Start the mic'}
          title={micListening() ? 'Stop listening' : 'Start listening — grant mic permission'}
          onClick={onToggleMic}
        >
          <span>{micListening() ? '■ STOP' : '◆ START'}</span>
        </button>
        <button
          type="button"
          class="mic-ux-cta"
          data-cta="apply"
          aria-label="Apply the recorded snippet to the score"
          title="Apply preview via the active slot"
          disabled={micPreviewNotes().length === 0 && micTransients().length === 0}
          onClick={() => applyToScore()}
        >
          <span>⌃ Add to score</span>
        </button>
        <button
          type="button"
          class="mic-ux-cta-sm"
          data-cta="reset"
          aria-label="Reset the preview buffer"
          title="Clear the preview (Ctrl+Z doesn't apply — preview is local)"
          disabled={micPreviewNotes().length === 0 && micTransients().length === 0}
          onClick={() => clearPreview()}
        >
          + reset
        </button>
        <button
          type="button"
          class="mic-ux-preview-toggle"
          data-cta="preview"
          data-active={previewing() ? 'true' : 'false'}
          aria-pressed={previewing()}
          aria-label={previewing() ? 'Stop preview playback' : 'Play the recorded snippet'}
          title={previewing() ? 'Stop preview' : 'Hear the recorded snippet in the running audio'}
          disabled={micPreviewNotes().length === 0 && micTransients().length === 0}
          onClick={onTogglePreview}
        >
          {previewing() ? '■ stop preview' : '👁 preview'}
        </button>
      </div>

      <div class="mic-ux-row-roll">
        <div class="mic-ux-roll-header">Live timeline</div>
        <PianoRollPreview
          notes={micPreviewNotes()}
          transients={micTransients()}
        />
      </div>

      <MicMeter />

      <Show when={micError() !== null}>
        <span class="mic-error-pill" role="alert">
          ✕ {micError()}
          <Show when={isMicPermissionError()}>
            <span class="mic-error-hint">
              {' '}—{' '}
              <Show when={micPermissionUrl() === null} fallback={<PermissionHint />}>
                разрешите доступ к микрофону в настройках браузера
              </Show>
            </span>
          </Show>
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
        if (p === null) return 'no preview';
        const overflow = p.overflow > 0 ? ` +${p.overflow}` : '';
        const pruned = p.pruned > 0 ? ` [+${p.pruned}]` : '';
        return `● ${p.firstNames.join(' ')}${overflow}${pruned}`;
      })()}
    </span>
  );
};

const InstrumentSelector = (): JSX.Element => (
  <div class="mic-ux-inst-selector" role="group" aria-label="Instrument">
    <For each={INSTRUMENTS}>
      {(inst) => {
        const isActive = (): boolean => micInstrument() === inst.id;
        return (
          <button
            type="button"
            class="mic-ux-inst-btn"
            data-instrument={inst.id}
            data-active={isActive() ? 'true' : 'false'}
            aria-label={`Instrument: ${inst.label}`}
            aria-pressed={isActive()}
            title={`Instrument: ${inst.label}`}
            onClick={() => setMicInstrument(inst.id)}
          >
            <span>{inst.glyph}</span>
            <span class="mic-ux-inst-label">{inst.label}</span>
          </button>
        );
      }}
    </For>
  </div>
);

const SlotSelect = (props: {
  readonly slotTitle: (slot: MicSlot) => string;
}): JSX.Element => (
  <label class="mic-ux-slot-select-wrap" aria-label="Slot">
    <select
      class="mic-ux-slot-select"
      data-slot={micSlot()}
      data-active-slot={micSlot()}
      title={props.slotTitle(micSlot())}
      onChange={(e): void => {
        const v = e.currentTarget.value;
        if (
          v === 'append-stack'
          || v === 'replace-score'
          || v === 'at-cursor'
        ) {
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
              title={disabled() ? 'At-cursor requires editor focus' : s.ariaLabel}
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
  readonly onPlayDemo: () => void;
}): JSX.Element => (
  <div class="mic-ux-empty" role="region" aria-label="Mic feature introduction">
    <div class="mic-ux-empty-title">Tap START and sing, tap, or hum.</div>
    <div class="mic-ux-empty-sub">
      Try a kick drum, a beatbox pattern, or a melody.
    </div>
    <div class="mic-ux-empty-actions">
      <button
        type="button"
        class="mic-ux-empty-demo"
        aria-label="Play a sample drum pattern"
        title="Plays a sample so you can hear what the feature does"
        onClick={(): void => { props.onPlayDemo(); }}
      >
        ▶ Demo: play a sample
      </button>
      <button
        type="button"
        class="mic-ux-empty-help"
        aria-expanded={props.showHelp}
        aria-label="Toggle help text"
        title="Show or hide help text"
        onClick={(): void => { props.onToggleHelp(); }}
      >
        {props.showHelp ? '− hide help' : '+ Learn more'}
      </button>
    </div>
    <Show when={props.showHelp}>
      <p class="mic-ux-empty-help-text">
        The mic detects two things in parallel: sustained pitch (your voice or
        a whistle becomes MIDI notes) and percussive onsets (a tap on the
        table or a clap becomes a drum hit). Both show up on the live timeline
        above the meter; click &ldquo;Add to score&rdquo; to splice them into
        your pattern at the slot you choose. Demo plays a four-on-the-floor
        kick so you can hear the sample bank without granting mic permission.
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

// ── helpers ───────────────────────────────────────────────────────────

/** Build a Strudel snippet from current preview buffers for the
 *  Preview-toggle button. Mirrors `applyToScore`'s branching logic
 *  but doesn't dispatch to the editor. Returns null when there's
 *  nothing to play. */
const buildDemoSnippet = (
  notes: ReadonlyArray<{ readonly midi: number; readonly startMs: number; readonly durationMs: number; readonly cents: number; readonly vibratoCents: number }>,
  transients: ReadonlyArray<{ readonly type: 'kick' | 'snare' | 'hat' | 'click'; readonly startMs: number; readonly amplitude: number; readonly spectralCentroidHz: number; readonly envelopeMs: number }>,
  instrument: string,
): string | null => {
  const hasNotes = notes.length > 0;
  const hasTrans = transients.length > 0;
  if (!hasNotes && !hasTrans) return null;
  // Local copy of the domain helpers so we don't pull them in here
  // (architecture rule: presentation depends on domain, but
  // presentation/state/micStore wraps domain calls). The Preview
  // toggle is presentation-only, so we keep it inline.
  const notesSnippet = hasNotes
    ? `note("${notes
        .map((n) => {
          const cls = ((n.midi % 12) + 12) % 12;
          const oct = Math.floor(n.midi / 12) - 1;
          const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
          const name = names[cls] ?? 'C';
          const dur = Math.max(0.01, n.durationMs / 1000).toFixed(3);
          return `${name}${oct}@${dur}`;
        })
        .join(' ')}").s("${instrument}")`
    : null;
  const transSnippet = hasTrans
    ? (() => {
        const map = { kick: 'drums_bd', snare: 'drums_sd', hat: 'drums_hh', click: 'drums_cp' } as const;
        return `s("${transients.map((t) => map[t.type]).join(' ')}")`;
      })()
    : null;
  if (notesSnippet !== null && transSnippet !== null) {
    return `stack(\n  ${notesSnippet},\n  ${transSnippet}\n)`;
  }
  return notesSnippet ?? transSnippet;
};