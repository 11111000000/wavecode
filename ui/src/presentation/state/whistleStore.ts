import { createSignal, onCleanup } from 'solid-js';
import { dispatch, appStore } from './appStore';
import type { CodeMirrorEditorApi } from '~/presentation/components/CodeMirrorEditor';
import {
  initialWhistleState,
  feed,
  closeOpenNote,
  notesToSnippet,
  DEFAULT_TUNE,
  type AudioNote,
  type WhistleState,
  type PitchFrame,
} from '~/domain/audio/whistle';
import {
  startWhistleDetector,
  isWhistleSupported,
  type WhistleDetectorHandle,
  type WhistleDetectorState,
} from '~/infrastructure/audio/WhistleDetector';
import { previewPillPayload as _pianoPillRef } from './pianoRecStore';

/**
 * whistleStore — presentation-layer signals + orchestrator for the
 * whistle-to-Strudel mic panel.
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
 *      the piano and whistle tools evolve independently.
 *   4. Editor API signal — `setWhistleEditorApi` is wired by
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
 *     duplicate the signal so piano and whistle can move independently.
 */

export type WhistleSlot = 'append-stack' | 'replace-score' | 'at-cursor';

export const [whistleListening, setWhistleListening] = createSignal(false);
export const [whistleState, setWhistleStateSignal] = createSignal<WhistleDetectorState>('idle');
export const [whistleError, setWhistleErrorSignal] = createSignal<string | null>(null);
export const [whistlePreviewNotes, setWhistlePreviewNotes] = createSignal<
  ReadonlyArray<AudioNote>
>([]);
export const [whistleCurrentHz, setWhistleCurrentHz] = createSignal<number | null>(null);
export const [whistleSlot, setWhistleSlotSignal] = createSignal<WhistleSlot>('append-stack');
export const [whistleInstrument, setWhistleInstrumentSignal] = createSignal<string>('piano');
export const [whistleEditorApi, setWhistleEditorApi] = createSignal<
  CodeMirrorEditorApi | undefined
>(undefined);
export const [whistleEditorFocused, setWhistleEditorFocused] = createSignal(false);

let segState: WhistleState = initialWhistleState();
let detector: WhistleDetectorHandle | null = null;

export const whistleSlotLabel = (slot: WhistleSlot): string => {
  switch (slot) {
    case 'append-stack': return 'конец стека';
    case 'replace-score': return 'заменить score';
    case 'at-cursor': return 'в курсор';
  }
};

export const whistleSlotGlyph = (slot: WhistleSlot): string => {
  switch (slot) {
    case 'append-stack': return '↵ stack';
    case 'replace-score': return '⟳ replace';
    case 'at-cursor': return '⌖ cursor';
  }
};

export const setWhistleSlot = (slot: WhistleSlot): void => {
  setWhistleSlotSignal(slot);
};

const pushError = (err: Error): void => {
  setWhistleErrorSignal(err.message);
};

const resetSegState = (): void => {
  segState = initialWhistleState();
  setWhistlePreviewNotes([]);
  setWhistleCurrentHz(null);
};

const onWhistleFrame = (frame: PitchFrame): void => {
  setWhistleCurrentHz(frame.hz);
  segState = feed(segState, frame, DEFAULT_TUNE, frame.timestampMs);
  setWhistlePreviewNotes(segState.notes);
};

export const startWhistle = (): void => {
  if (whistleListening()) return;
  if (!isWhistleSupported()) {
    pushError(new Error('Этот браузер не поддерживает микрофон (getUserMedia недоступен).'));
    setWhistleStateSignal('errored');
    return;
  }
  resetSegState();
  setWhistleErrorSignal(null);
  detector = startWhistleDetector({
    onFrame: onWhistleFrame,
    onStateChange: (s) => setWhistleStateSignal(s),
    onError: (err) => {
      pushError(err);
      setWhistleListening(false);
      setWhistleStateSignal('errored');
    },
  });
  setWhistleListening(true);
};

export const stopWhistle = (): void => {
  if (!whistleListening() && detector === null) return;
  if (detector !== null) {
    // Force-close any open note so the last leg stays in preview.
    segState = closeOpenNote(segState, performance.now());
    setWhistlePreviewNotes(segState.notes);
    void detector.stop();
    detector = null;
  }
  setWhistleListening(false);
  setWhistleStateSignal('idle');
};

export const freezePreview = (): void => {
  segState = closeOpenNote(segState, performance.now());
  setWhistlePreviewNotes(segState.notes);
};

export const clearPreview = (): void => {
  resetSegState();
};

export const toggleWhistleSlot = (): void => {
  const order: ReadonlyArray<WhistleSlot> = ['append-stack', 'replace-score', 'at-cursor'];
  const cur = whistleSlot();
  const idx = order.indexOf(cur);
  setWhistleSlot(order[(idx + 1) % order.length]!);
};

export const setWhistleInstrument = (s: string): void => {
  setWhistleInstrumentSignal(s);
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
  const buf = whistlePreviewNotes();
  if (buf.length === 0) return;
  const snippet = notesToSnippet(buf, { instrument: whistleInstrument() });
  if (snippet === null) return;

  const slot = whistleSlot();

  if (slot === 'replace-score') {
    dispatch({ type: 'replaceScore', text: snippet });
    clearPreview();
    return;
  }

  if (slot === 'at-cursor') {
    const api = whistleEditorApi();
    if (api === undefined) {
      console.warn(
        'whistleStore.applyToScore: at-cursor slot requires editor API; no-op',
      );
      return;
    }
    const view = api.getView();
    if (view === undefined) {
      console.warn(
        'whistleStore.applyToScore: at-cursor slot requires EditorView; no-op',
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
 * Pure read of signals. Used by `WhistlePanel` to render the live
 * preview pill beside the mic button.
 */
export const previewPillPayload = (): {
  count: number;
  firstNames: ReadonlyArray<string>;
  overflow: number;
  slot: WhistleSlot;
  slotLabel: string;
} | null => {
  const buf = whistlePreviewNotes();
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
    slot: whistleSlot(),
    slotLabel: whistleSlotLabel(whistleSlot()),
  };
};

onCleanup(() => {
  if (detector !== null) void detector.stop();
});
