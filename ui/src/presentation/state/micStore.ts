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
  type MicMode,
  type MicCaptureHandle,
  type MicCaptureState,
} from '~/infrastructure/audio/MicCapture';
import {
  transientsToSnippet,
  type Transient,
} from '~/domain/audio/transient';
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
 * Anti-patterns avoided:
 *   - NO inline worker / AudioContext (those live in infrastructure).
 *   - NO Strudel grammar knowledge (lives in domain).
 *   - Sharing piano's editorAPI signal would couple the two stores; we
 *     duplicate the signal so piano and mic can move independently.
 */

export type MicSlot = 'append-stack' | 'replace-score' | 'at-cursor';
export type { MicMode };

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

/**
 * Pipeline mode. 'sustain' (default) runs MPM pitch detection and
 * accumulates AudioNote[]. 'transient' runs onset detection (RMS
 * flux + spectral centroid) and accumulates Transient[]. The 'auto'
 * slot is reserved for Phase 3 (both pipelines in parallel with
 * per-frame classification).
 */
export const [micMode, setMicModeSignal] = createSignal<MicMode>('sustain');
export const setMicMode = (m: MicMode): void => {
  setMicModeSignal(m);
  // Stop+restart so the detector runs the new pipeline. The
  // preview buffer is cleared (the previous pipeline's output is
  // no longer relevant after a mode switch).
  if (micListening()) {
    stopMic();
    startMic();
  } else {
    clearPreview();
  }
};

/** Detected transients (only populated in 'transient' mode). */
export const [micTransients, setMicTransients] = createSignal<ReadonlyArray<Transient>>([]);

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
};

const onMicFrame = (frame: PitchFrame): void => {
  setMicCurrentHz(frame.hz);
  setMicCurrentRms(frame.rms);
  segState = feed(segState, frame, DEFAULT_TUNE, frame.timestampMs);
  setMicPreviewNotes(segState.notes);
};

const onMicTransient = (transient: Transient): void => {
  // Append the new onset to the existing buffer; the snippet is
  // regenerated on apply (transientsToSnippet reads the full
  // buffer at the moment of apply, so a 1-second-old onset is
  // still part of the output if the user hasn't hit "clear").
  setMicTransients([...micTransients(), transient]);
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
  const mode = micMode();
  detector = startMicDetector({
    mode,
    onFrame: onMicFrame,
    onTransient: onMicTransient,
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
 * Mirrors `pianoRecStore.stackAppend` — paren-aware splice of a
 * freshly-transcribed snippet into an existing top-level `stack(...)`,
 * or a fresh `stack(...)` when the editor has no stack yet. Kept
 * here (not imported from pianoRecStore) so the two stores can evolve
 * independently; the algorithm is the same.
 */
const stackAppend = (currentScore: string, snippet: string): string => {
  if (currentScore.trim() === '') return snippet;
  const stackStart = findTopLevelStackAt(currentScore);
  if (stackStart !== -1) {
    let i = stackStart + 5;
    i = skipWhitespaceAndComments(currentScore, i);
    const openParen = i;
    const closeIdx = findStackClose(currentScore, openParen + 1);
    if (closeIdx !== -1) {
      const head = currentScore.slice(0, closeIdx).replace(/\s+$/, '');
      const tail = currentScore.slice(closeIdx);
      const inner = snippet
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n');
      const headNeedsComma = /,\s*$/.test(head);
      return `${head}${headNeedsComma ? '' : ','}\n${inner}\n${tail}`;
    }
  }
  const trimmedCurrent = currentScore.trim();
  return `stack(\n${trimmedCurrent},\n${snippet.split('\n').map((l) => '  ' + l).join('\n')}\n)`;
};

const skipWhitespaceAndComments = (src: string, i: number): number => {
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? src.length : close + 2;
      continue;
    }
    break;
  }
  return i;
};

const findTopLevelStackAt = (src: string): number => {
  const i = skipWhitespaceAndComments(src, 0);
  if (src.slice(i, i + 5) !== 'stack') return -1;
  let j = i + 5;
  j = skipWhitespaceAndComments(src, j);
  if (src[j] !== '(') return -1;
  const peek = src[j + 1];
  if (
    peek !== undefined
    && peek !== ' '
    && peek !== '\t'
    && peek !== '\n'
    && peek !== '\r'
    && peek !== '/'
    && peek !== ')'
  ) {
    return -1;
  }
  return i;
};

const findStackClose = (src: string, afterOpenParen: number): number => {
  let depth = 1;
  let inStr: '"' | "'" | '`' | null = null;
  for (let i = afterOpenParen; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

export const applyToScore = (): void => {
  const mode = micMode();
  let snippet: string | null;
  if (mode === 'transient') {
    const buf = micTransients();
    if (buf.length === 0) return;
    snippet = transientsToSnippet(buf);
  } else {
    const buf = micPreviewNotes();
    if (buf.length === 0) return;
    snippet = notesToSnippet(buf, { instrument: micInstrument() });
  }
  if (snippet === null) return;

  const slot = micSlot();

  if (slot === 'replace-score') {
    dispatch({ type: 'replaceScore', text: snippet });
    clearPreview();
    return;
  }

  if (slot === 'at-cursor') {
    const api = micEditorApi();
    if (api === undefined) {
      console.warn(
        'micStore.applyToScore: at-cursor slot requires editor API; no-op',
      );
      return;
    }
    const view = api.getView();
    if (view === undefined) {
      console.warn(
        'micStore.applyToScore: at-cursor slot requires EditorView; no-op',
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

  const newScore = stackAppend(appStore.score, snippet);
  dispatch({ type: 'replaceScore', text: newScore });
  clearPreview();
};

/**
 * Compact preview-pill payload — count + first N note names + slot label.
 * Pure read of signals. Used by `MicPanel` to render the live
 * preview pill beside the mic button.
 */
export const previewPillPayload = (): {
  count: number;
  firstNames: ReadonlyArray<string>;
  overflow: number;
  slot: MicSlot;
  slotLabel: string;
} | null => {
  // In transient mode show drum-count + first 6 onset types.
  if (micMode() === 'transient') {
    const buf = micTransients();
    if (buf.length === 0) return null;
    const PREVIEW_LIMIT = 6;
    const short = { kick: 'bd', snare: 'sd', hat: 'hh', click: 'cp' } as const;
    const firstNames = buf.slice(0, PREVIEW_LIMIT).map((t) => short[t.type]);
    return {
      count: buf.length,
      firstNames,
      overflow: Math.max(0, buf.length - PREVIEW_LIMIT),
      slot: micSlot(),
      slotLabel: micSlotLabel(micSlot()),
    };
  }
  // sustain mode (default): show note names as before
  const buf = micPreviewNotes();
  if (buf.length === 0) return null;
  const PREVIEW_LIMIT = 6;
  const firstNames = buf.slice(0, PREVIEW_LIMIT).map((n) => {
    const cls = ((n.midi % 12) + 12) % 12;
    const oct = Math.floor(n.midi / 12) - 1;
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return `${names[cls]}${oct}`;
  });
  return {
    count: buf.length,
    firstNames,
    overflow: Math.max(0, buf.length - PREVIEW_LIMIT),
    slot: micSlot(),
    slotLabel: micSlotLabel(micSlot()),
  };
};

onCleanup(() => {
  if (detector !== null) void detector.stop();
});
