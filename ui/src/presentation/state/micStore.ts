import { createSignal, onCleanup } from 'solid-js';
import { dispatch, appStore } from './appStore';
import type { CodeMirrorEditorApi } from '~/presentation/components/CodeMirrorEditor';
import {
  initialMicState,
  feed,
  closeOpenNote,
  notesToSnippet,
  DEFAULT_TUNE,
  type AudioNote,
  type MicState,
  type PitchFrame,
} from '~/domain/audio/micCapture';
import {
  startMicDetector,
  isMicSupported,
  type MeterFrame,
  type MicCaptureHandle,
  type MicCaptureState,
} from '~/infrastructure/audio/MicCapture';
import {
  transientsToSnippet,
  type Transient,
} from '~/domain/audio/transient';
import { appendToTopStack } from '~/domain/strudel';
import { consoleStore } from '~/presentation/components/consoleStore';
import { logger } from '~/infrastructure/log';
import { previewPillPayload as _pianoPillRef } from './pianoRecStore';

/**
 * micStore — presentation-layer signals + orchestrator for the
 * mic-to-Strudel panel.
 *
 * What lives here (mirrors pianoRecStore's scope):
 *   1. Live detection state — listening on/off, mic permission,
 *      detector phase ("idle" / "requesting-mic" / "streaming" / "errored"),
 *      last error string, latest detected Hz (for meter UI).
 *   2. Segmentation buffer — accumulating `AudioNote[]` that the user
 *      has produced; managed by `feed()` on every detected frame.
 *   3. Slot selector — where `applyToScore` writes the snippet:
 *      `append-stack` (splice into existing top-level `stack(...)`),
 *      `replace-score` (destructive), or `at-cursor` (CodeMirror insert).
 *      Mirror of pianoRecStore's three slots; lives here separately so
 *      the piano and mic tools evolve independently.
 *   4. Editor API signal — `setMicEditorApi` is wired by
 *      ScorePanel.onReady (mirroring `setPianoEditorApi`); needed for
 *      the `at-cursor` slot to insert at the active selection.
 *   5. Apply pipeline — `applyToScore` commits the buffer to a Strudel
 *      snippet via `notesToSnippet` and dispatches it through the active
 *      slot. Mirrors pianoRecStore.applyToScore verbatim.
 *
 * Auto-detection model
 * --------------------
 * The Mic panel no longer exposes a "sustain vs transient vs auto"
 * mode toggle. Both pipelines run every frame inside
 * `MicCapture.startMicDetector`; this store consumes a single unified
 * event stream and derives a `micDetectionActive` state from it:
 *   - 'idle'         — no recent activity in either buffer
 *   - 'sustained'    — notes present, no recent onsets
 *   - 'percussive'   — recent onsets, no notes
 *   - 'both'         — both buffers have content (singing + tapping)
 *
 * Anti-patterns avoided:
 *   - NO inline worker / AudioContext (those live in infrastructure).
 *   - NO Strudel grammar knowledge (lives in domain).
 *   - Sharing piano's editorAPI signal would couple the two stores; we
 *     duplicate the signal so piano and mic can move independently.
 */

export type MicSlot = 'append-stack' | 'replace-score' | 'at-cursor';

export type MicDetectionKind = 'idle' | 'sustained' | 'percussive' | 'both';

export type MicPeakMark = {
  readonly ms: number;
  readonly type: 'note' | 'transient';
};

/** Window over which `micPeakTimes` retains onset markers for the
 *  live spike overlay. Anything older than `nowMs - windowMs` is
 *  pruned on every `onFrame` / `onTransient` callback. */
const PEAK_HISTORY_WINDOW_MS = 3_000;

export const [micListening, setMicListening] = createSignal(false);
export const [micState, setMicStateSignal] = createSignal<MicCaptureState>('idle');
export const [micError, setMicErrorSignal] = createSignal<string | null>(null);
export const [micPreviewNotes, setMicPreviewNotes] = createSignal<
  ReadonlyArray<AudioNote>
>([]);
export const [micCurrentHz, setMicCurrentHz] = createSignal<number | null>(null);
export const [micSlot, setMicSlotSignal] = createSignal<MicSlot>('append-stack');
export const [micInstrument, setMicInstrumentSignal] = createSignal<string>('piano');
export const [micEditorApi, setMicEditorApi] = createSignal<
  CodeMirrorEditorApi | undefined
>(undefined);
export const [micEditorFocused, setMicEditorFocused] = createSignal(false);

// Live RMS (0..1) — separate from `micCurrentHz` so the meter can
// show "the mic is hearing sound" even when there's no clear pitch.
// Set by `onMicFrame`; cleared on `clearPreview` / `stopMic`.
export const [micCurrentRms, setMicCurrentRms] = createSignal<number>(0);

/** Latest meter frame from `MicCapture.onMeter`. The UI consumes this
 *  to render the live RMS bar with onset spike markers. */
export const [micMeterFrame, setMicMeterFrame] = createSignal<MeterFrame | null>(null);

/** Trailing 3-second list of detected onsets (`{ms, type}`) — used
 *  by the UI to draw vertical spike markers at the time each note
 *  closed or each transient fired. Pruned on every MicCapture event
 *  to entries within the last `PEAK_HISTORY_WINDOW_MS`. */
export const [micPeakTimes, setMicPeakTimes] = createSignal<
  ReadonlyArray<MicPeakMark>
>([]);

/** Detected transients (always populated — both pipelines run every
 *  frame in the new auto-only model). */
export const [micTransients, setMicTransients] = createSignal<ReadonlyArray<Transient>>([]);

/**
 * How many notes have been dropped from the sliding-window buffer
 * (Phase 3 long-form display). The parallel domain work adds
 * `notesPrunedCount` to `MicState`; we expose it here for the
 * preview-pill ("● 4 нот: c4 e4 g4 e4 [+12]") and defensively
 * default to 0 if the field hasn't landed yet.
 */
export const [micPrunedCount, setMicPrunedCount] = createSignal<number>(0);

let segState: MicState = initialMicState();
let detector: MicCaptureHandle | null = null;

export const micSlotLabel = (slot: MicSlot): string => {
  switch (slot) {
    case 'append-stack': return 'конец стека';
    case 'replace-score': return 'заменить score';
    case 'at-cursor': return 'в курсор';
  }
};

export const micSlotGlyph = (slot: MicSlot): string => {
  switch (slot) {
    case 'append-stack': return '↵ stack';
    case 'replace-score': return '⟳ replace';
    case 'at-cursor': return '⌖ cursor';
  }
};

export const setMicSlot = (slot: MicSlot): void => {
  setMicSlotSignal(slot);
};

const pushError = (err: Error): void => {
  setMicErrorSignal(err.message);
};

const resetSegState = (): void => {
  segState = initialMicState();
  setMicPreviewNotes([]);
  setMicTransients([]);
  setMicCurrentHz(null);
  setMicCurrentRms(0);
  setMicPrunedCount(0);
  setMicMeterFrame(null);
  setMicPeakTimes([]);
};

/** Prune `micPeakTimes` of entries older than `nowMs - window`. Called
 *  on every MicCapture event so the array stays bounded at ~30-100
 *  entries regardless of session length. */
const prunePeakTimes = (nowMs: number): void => {
  const cutoff = nowMs - PEAK_HISTORY_WINDOW_MS;
  const cur = micPeakTimes();
  let i = 0;
  while (i < cur.length && cur[i]!.ms < cutoff) i += 1;
  if (i === 0) return;
  setMicPeakTimes(cur.slice(i));
};

/** Append a `note` mark to `micPeakTimes` (called when a sustained
 *  note is closed in the segmenter — i.e. when `micPreviewNotes`
 *  grew in length) and prune the trailing 3s window. */
const recordNotePeak = (timestampMs: number): void => {
  const next: MicPeakMark = { ms: timestampMs, type: 'note' };
  setMicPeakTimes([...micPeakTimes(), next]);
  prunePeakTimes(timestampMs);
};

const onMicFrame = (frame: PitchFrame): void => {
  setMicCurrentHz(frame.hz);
  setMicCurrentRms(frame.rms);
  const beforeNotes = segState.notes.length;
  segState = feed(segState, frame, DEFAULT_TUNE, frame.timestampMs);
  setMicPreviewNotes(segState.notes);
  // Defensive: the parallel domain branch will add `notesPrunedCount`
  // to MicState. Until that lands, we treat it as 0 (no opt chain →
  // no false negative from the field's absence on the type).
  const pruned = (segState as { notesPrunedCount?: number }).notesPrunedCount;
  setMicPrunedCount(typeof pruned === 'number' ? pruned : 0);
  // A new note closed in the segmenter → mark a `note` spike on the
  // live meter overlay so the user sees their sung notes land.
  if (segState.notes.length > beforeNotes) {
    recordNotePeak(frame.timestampMs);
  }
};

const onMicTransient = (transient: Transient): void => {
  // Append the new onset to the existing buffer; the snippet is
  // regenerated on apply (transientsToSnippet reads the full
  // buffer at the moment of apply, so a 1-second-old onset is
  // still part of the output if the user hasn't hit "clear").
  setMicTransients([...micTransients(), transient]);
  // Record a `transient` peak at the onset's start time so the
  // meter overlay draws a spike exactly where the hit fired.
  const next: MicPeakMark = { ms: transient.startMs, type: 'transient' };
  setMicPeakTimes([...micPeakTimes(), next]);
  prunePeakTimes(transient.startMs);
};

const onMicMeter = (frame: MeterFrame): void => {
  setMicMeterFrame(frame);
  // Don't add a peak mark for the meter itself — that's only for
  // detected musical events (notes + transients).
};

export const startMic = (): void => {
  if (micListening()) return;
  if (!isMicSupported()) {
    pushError(new Error('Этот браузер не поддерживает микрофон (getUserMedia недоступен).'));
    setMicStateSignal('errored');
    return;
  }
  resetSegState();
  setMicErrorSignal(null);
  detector = startMicDetector({
    onFrame: onMicFrame,
    onTransient: onMicTransient,
    onMeter: onMicMeter,
    onStateChange: (s) => setMicStateSignal(s),
    onError: (err) => {
      pushError(err);
      setMicListening(false);
      setMicStateSignal('errored');
    },
  });
  setMicListening(true);
};

export const stopMic = (): void => {
  if (!micListening() && detector === null) return;
  if (detector !== null) {
    // Force-close any open note so the last leg stays in preview.
    segState = closeOpenNote(segState, performance.now());
    setMicPreviewNotes(segState.notes);
    void detector.stop();
    detector = null;
  }
  setMicListening(false);
  setMicStateSignal('idle');
};

export const freezePreview = (): void => {
  segState = closeOpenNote(segState, performance.now());
  setMicPreviewNotes(segState.notes);
};

export const clearPreview = (): void => {
  resetSegState();
};

export const toggleMicSlot = (): void => {
  const order: ReadonlyArray<MicSlot> = ['append-stack', 'replace-score', 'at-cursor'];
  const cur = micSlot();
  const idx = order.indexOf(cur);
  setMicSlot(order[(idx + 1) % order.length]!);
};

export const setMicInstrument = (s: string): void => {
  setMicInstrumentSignal(s);
};

/**
 * `micDetectionActive` — derived signal consumed by `MicPanel`'s
 * preview-pill icon. Decides which icon to show based on what's in
 * the buffers RIGHT NOW:
 *   - both buffers empty → 'idle'
 *   - notes only           → 'sustained'
 *   - transients only      → 'percussive'
 *   - both non-empty       → 'both'
 *
 * This is a plain function (Solid's `createMemo` would also work) —
 * it's cheap, but every reader in the panel re-derives. Performance
 * is fine because the only consumers are UI components in the same
 * panel; if we ever lift this into a frequently-rendered tree we'd
 * wrap it in `createMemo`.
 */
export const micDetectionActive = (): MicDetectionKind => {
  const hasNotes = micPreviewNotes().length > 0;
  const hasTransients = micTransients().length > 0;
  if (hasNotes && hasTransients) return 'both';
  if (hasNotes) return 'sustained';
  if (hasTransients) return 'percussive';
  return 'idle';
};

export const applyToScore = (): void => {
  const notesBuf = micPreviewNotes();
  const transBuf = micTransients();
  const notesSnippet = notesBuf.length === 0
    ? null
    : notesToSnippet(notesBuf, { instrument: micInstrument() });
  const transSnippet = transBuf.length === 0
    ? null
    : transientsToSnippet(transBuf);
  if (notesSnippet === null && transSnippet === null) return;
  let snippet: string;
  if (notesSnippet !== null && transSnippet !== null) {
    // Both buffers produced something → emit a stack(...) so the
    // apply preserves the two contributions as siblings. Don't
    // indent; small sessions stay readable this way.
    snippet = `stack(\n  ${notesSnippet},\n  ${transSnippet}\n)`;
  } else {
    snippet = (notesSnippet ?? transSnippet) as string;
  }

  const slot = micSlot();

  if (slot === 'replace-score') {
    dispatch({ type: 'replaceScore', text: snippet });
    clearPreview();
    return;
  }

  if (slot === 'at-cursor') {
    const api = micEditorApi();
    if (api === undefined) {
      logger.push(
        'warn',
        ['micStore.applyToScore: at-cursor slot requires editor API; no-op'],
        'micStore.applyToScore',
      );
      return;
    }
    const view = api.getView();
    if (view === undefined) {
      logger.push(
        'warn',
        ['micStore.applyToScore: at-cursor slot requires EditorView; no-op'],
        'micStore.applyToScore',
      );
      return;
    }
    const sel = view.state.selection.main;
    const anchor = sel.from + snippet.length;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor },
    });
    clearPreview();
    return;
  }

  const result = appendToTopStack(appStore.score, snippet);
  if (!result.ok) {
    consoleStore.pushToast({
      severity: 'warn',
      title: 'Не удалось вставить запись',
      body: 'В score незакрытая скобка stack(...) — исправьте синтаксис и повторите.',
    });
    return;
  }
  dispatch({ type: 'replaceScore', text: result.score });
  clearPreview();
};

/**
 * Compact preview-pill payload — count + first N item names + slot label.
 * Pure read of signals. Used by `MicPanel` to render the live preview
 * pill beside the mic button.
 *
 * The auto-detection model means the user sees a unified stream:
 *   - notes are prefixed with '♪'
 *   - onsets are prefixed with '✦'
 * Both can appear in `firstNames` simultaneously. The `kind` field
 * lets the UI pick the right icon (mic / drum / both / muted).
 *
 * Returns null when there is nothing to preview.
 */
export const previewPillPayload = (): {
  count: number;
  firstNames: ReadonlyArray<string>;
  overflow: number;
  pruned: number;
  slot: MicSlot;
  slotLabel: string;
  kind: MicDetectionKind;
} | null => {
  const PREVIEW_LIMIT = 6;
  const notesBuf = micPreviewNotes();
  const transBuf = micTransients();

  if (notesBuf.length === 0 && transBuf.length === 0) return null;

  const short = { kick: 'bd', snare: 'sd', hat: 'hh', click: 'cp' } as const;
  const noteStrings = notesBuf.map((n) => {
    const cls = ((n.midi % 12) + 12) % 12;
    const oct = Math.floor(n.midi / 12) - 1;
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return `♪ ${names[cls]}${oct}`;
  });
  const transStrings = transBuf.map((t) => `✦ ${short[t.type]}`);
  const merged = [...noteStrings, ...transStrings];
  const firstNames = merged.slice(0, PREVIEW_LIMIT);
  const totalCount = notesBuf.length + transBuf.length;
  return {
    count: totalCount,
    firstNames,
    overflow: Math.max(0, merged.length - PREVIEW_LIMIT),
    pruned: micPrunedCount(),
    slot: micSlot(),
    slotLabel: micSlotLabel(micSlot()),
    kind: micDetectionActive(),
  };
};

onCleanup(() => {
  if (detector !== null) void detector.stop();
});