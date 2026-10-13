import { createSignal } from 'solid-js';
import { EditorView } from '@codemirror/view';
import type { PianoInstrument } from '~/domain/music/notes';
import { noteToneSnippet, noteNumberToName } from '~/domain/music/notes';
import { dispatch, appStore } from './appStore';
import type { CodeMirrorEditorApi } from '~/presentation/components/CodeMirrorEditor';

/**
 * pianoRecStore — presentation-layer signals + orchestrators for the
 * piano's three user toggles (REC, FOLLOW, instrument selector) and
 * the REC-→-apply pipeline.
 *
 * Six concerns live here:
 *   1. **Rec buffer** — when the user toggles REC on and plays the
 *      piano, each note-on/off pair pushes a `RecNote` entry onto
 *      `recBuffer` (midi + startMs + endMs). The buffer is consulted
 *      by `applyToScore()` (and the legacy `flushRec()`); `applyToScore`
 *      is the primary commit path used by the `↑ apply` toolbar button.
 *   2. **Instrument** — which OscillatorType the next `noteOn` should
 *      use. Held in a separate signal so the keyboard can read the
 *      current value at noteOn time without re-rendering on every
 *      press. Also passed through to `commitSnippet` so committed
 *      notes reflect what was actually played.
 *   3. **FOLLOW toggle** — `followEnabled` signal that drives the
 *      PianoKeyboard RAF poll loop. Independent of REC: a user can
 *      have REC on (writing their own melody into the buffer) AND
 *      FOLLOW on (seeing what the current score is playing) at the
 *      same time — the two intents don't conflict.
 *   4. **Commit pipeline** — `commitSnippet` is a pure function that
 *      turns a `RecNote[]` into a Strudel snippet for `applyToScore`.
 *      `stackAppend` is a tiny paren-aware helper (mirrors
 *      `appendGridToScore` in gridState.ts but takes a raw snippet
 *      instead of a `Grid`).
 *   5. **Slot selector** (wavecode-piano-rec-clarity) — three
 *      commit targets the user can pick from in PianoToolbar:
 *        `append-stack`  — current behavior, splice into the existing
 *                          top-level `stack(...)` (or wrap both if
 *                          editor doesn't have one).
 *        `replace-score` — destructive: `dispatch(replaceScore, snippet)`.
 *                          Reversible via multi-undo.
 *        `at-cursor`     — insert at the CodeMirror main selection,
 *                          park cursor after the snippet, scroll into
 *                          view. Requires `pianoEditorApi` to be set
 *                          (ScorePanel wires it on mount).
 *      Default `append-stack`. NOT persisted — each session starts
 *      from default to avoid the "forgotten slot" UX bug where
 *      `at-cursor` is selected but the editor has no focus.
 *   6. **Editor focus + API** — `editorFocused` and `pianoEditorApi`
 *      signals maintained by ScorePanel via view.contentDOM
 *      focus/blur listeners and the CodeMirrorEditorApi `onReady`
 *      callback. The slot selector reads `editorFocused()` to enable
 *      `at-cursor` only when there's a cursor to insert at.
 *
 * Lives in presentation/state/ because:
 *   - All signals are UI-state (Solid signals + an appStore dispatch).
 *   - presentation may NOT import @strudel/*; we delegate string
 *     formatting to `noteToneSnippet` from the pure domain layer.
 *   - presentation MAY import infrastructure (so we can talk to the
 *     AudioEngine via appStore → audioActions if needed), but for
 *     commit we don't — the snippet is editor-only.
 */

export type RecNote = {
  readonly midi: number;
  readonly startMs: number;
  readonly endMs: number;
};

/**
 * Where a `↑ apply` call writes the recorded snippet. Mirrors the
 * three affordances of any text/code editor (append / replace / at-cursor)
 * applied to Strudel's top-level-stack semantics.
 */
export type PianoSlot = 'append-stack' | 'replace-score' | 'at-cursor';

/** Human-readable label for the preview-pill and tests. */
export const pianoSlotLabel = (slot: PianoSlot): string => {
  switch (slot) {
    case 'append-stack': return 'конец стека';
    case 'replace-score': return 'заменить score';
    case 'at-cursor': return 'в курсор';
  }
};

/** Compact bullet for the segmented control buttons. */
export const pianoSlotGlyph = (slot: PianoSlot): string => {
  switch (slot) {
    case 'append-stack': return '↵ stack';
    case 'replace-score': return '⟳ replace';
    case 'at-cursor': return '⌖ cursor';
  }
};

export const [recEnabled, setRecEnabled] = createSignal(false);
export const [recBuffer, setRecBuffer] = createSignal<ReadonlyArray<RecNote>>([]);
export const [instrument, setInstrumentSignal] = createSignal<PianoInstrument>('triangle');
export const [followEnabled, setFollowEnabled] = createSignal(false);

// wavecode-piano-rec-clarity: slot + focus + editor-API signals
export const [pianoSlot, setPianoSlotSignal] = createSignal<PianoSlot>('append-stack');
export const [editorFocused, setEditorFocusedSignal] = createSignal(false);
export const [pianoEditorApi, setPianoEditorApiSignal] = createSignal<
  CodeMirrorEditorApi | undefined
>(undefined);

export const toggleRec = (): void => {
  setRecEnabled((v) => !v);
};

export const setInstrument = (i: PianoInstrument): void => {
  setInstrumentSignal(i);
};

export const toggleFollow = (): void => {
  setFollowEnabled((v) => !v);
};

export const setFollow = (v: boolean): void => {
  setFollowEnabled(v);
};

/** Set the active apply slot. NOT persisted between sessions. */
export const setPianoSlot = (slot: PianoSlot): void => {
  setPianoSlotSignal(slot);
};

/** Called by ScorePanel when the CodeMirror contentDOM gains focus. */
export const setEditorFocused = (v: boolean): void => {
  setEditorFocusedSignal(v);
};

/** Called by ScorePanel in the editor's `onReady` callback. */
export const setPianoEditorApi = (
  api: CodeMirrorEditorApi | undefined,
): void => {
  setPianoEditorApiSignal(() => api);
};

/**
 * Append a not-yet-finished note to the buffer.
 *
 * The keyboard calls this on note-on with `endMs === startMs` (a
 * "press without release" marker); when note-off fires, it calls
 * `updateLastNoteEnd(nextMs)` to fix the end timestamp. This split
 * keeps the public API minimal while supporting tap-and-hold correctly.
 */
export const appendNote = (midi: number, startMs: number, endMs: number): void => {
  setRecBuffer((b) => [...b, { midi, startMs, endMs }]);
};

/** Replace the endMs of the most recent buffer entry. No-op if empty. */
export const updateLastNoteEnd = (endMs: number): void => {
  setRecBuffer((b) => {
    if (b.length === 0) return b;
    const idx = b.length - 1;
    const last = b[idx]!;
    const next = b.slice();
    next[idx] = { ...last, endMs };
    return next;
  });
};

/** Return the last `n` notes from the buffer (most-recent first or
 *  in order, see impl) without mutating it. */
export const recentNotes = (n: number): ReadonlyArray<RecNote> => {
  const buf = recBuffer();
  if (n <= 0 || buf.length === 0) return [];
  return buf.slice(Math.max(0, buf.length - n));
};

/** Return the buffer and clear it. */
export const flushRec = (): ReadonlyArray<RecNote> => {
  const buf = recBuffer();
  setRecBuffer([]);
  return buf;
};

/** Reset the buffer without returning it. Used by tests + cleanup paths. */
export const clearRec = (): void => {
  setRecBuffer([]);
};

/**
 * Convert a `RecNote[]` buffer into a multi-line Strudel snippet,
 * one piano voice per buffer entry (NOT stack — each line is a
 * separate top-level `<voice>` so the Strudel scheduler plays them
 * simultaneously with their own envelopes).
 *
 * The packet specifies `noteToneSnippet(midi, instrument)` for each
 * note so the committed snippet mirrors what the user just played.
 *
 * Pure: no side effects, deterministic, fully testable. Empty buffer
 * → empty string (handled at the call site: `applyToScore` skips
 * dispatch when this returns "").
 */
export const commitSnippet = (
  buffer: ReadonlyArray<RecNote>,
  inst: PianoInstrument,
): string => {
  if (buffer.length === 0) return '';
  const lines: string[] = [];
  for (const note of buffer) {
    lines.push(noteToneSnippet(note.midi, inst));
  }
  return lines.join('\n');
};

/**
 * Merge a freshly-committed snippet into the current editor score,
 * handling three cases:
 *
 *   1. empty editor                   → snippet verbatim
 *   2. editor already has top-level
 *      `stack(...)`                  → splice snippet INSIDE the existing
 *                                       stack, comma-separated as a new
 *                                       layer
 *   3. editor has a single non-stack
 *      pattern (e.g. just `note(...)`) → wrap BOTH in a fresh `stack(...)`
 *
 * Paren-aware: skips comments and string literals when locating the
 * top-level `stack` open. See `gridState.appendGridToScore` for the
 * original version (this is the same algorithm adapted to operate on
 * raw snippet strings instead of synthesised grid rows).
 */
export const stackAppend = (currentScore: string, snippet: string): string => {
  if (currentScore.trim() === '') return snippet;

  const stackStart = findTopLevelStackAt(currentScore);
  if (stackStart !== -1) {
    let i = stackStart + 5; // 'stack'
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

  // Non-stack score → wrap both in a fresh stack.
  const trimmedCurrent = currentScore.trim();
  return `stack(\n${trimmedCurrent},\n${snippet.split('\n').map((l) => '  ' + l).join('\n')}\n)`;
};

/**
 * Orchestrator: read the current rec buffer, commit to a snippet, then
 * dispatch through the active `pianoSlot()`:
 *
 *   - `append-stack`  → splice into existing top-level stack via
 *                       `stackAppend`, then dispatch `replaceScore`.
 *   - `replace-score` → dispatch `replaceScore` with the raw snippet
 *                       (destructive — user-visible via undo).
 *   - `at-cursor`     → insert at the CodeMirror main selection,
 *                       park cursor after the snippet, scroll into
 *                       view. Requires `pianoEditorApi` to have been
 *                       wired by ScorePanel.onReady. No-op with a
 *                       `console.warn` if the editor is unavailable
 *                       (caller should disable the button — see
 *                       `editorFocused`).
 *
 * Clears the buffer ONLY after a successful commit (so failed
 * at-cursor with no editor preserves the recording for retry).
 *
 * No-ops when the buffer is empty.
 */
export const applyToScore = (): void => {
  const buf = recBuffer();
  if (buf.length === 0) return;
  const snippet = commitSnippet(buf, instrument());
  if (snippet === '') return;

  const slot = pianoSlot();

  if (slot === 'replace-score') {
    dispatch({ type: 'replaceScore', text: snippet });
    setRecBuffer([]);
    return;
  }

  if (slot === 'at-cursor') {
    const api = pianoEditorApi();
    if (!api) {
      console.warn(
        'pianoRecStore.applyToScore: at-cursor slot requires editor API; no-op',
      );
      return;
    }
    const view = api.getView();
    if (!view) {
      console.warn(
        'pianoRecStore.applyToScore: at-cursor slot requires EditorView; no-op',
      );
      return;
    }
    insertAtCursor(view, snippet);
    setRecBuffer([]);
    return;
  }

  // append-stack
  const newScore = stackAppend(appStore.score, snippet);
  dispatch({ type: 'replaceScore', text: newScore });
  setRecBuffer([]);
};

/**
 * Insert a snippet at the main CodeMirror selection. Replaces any
 * selected range, parks the cursor at the end of the inserted text,
 * and scrolls the inserted region into view (nearest).
 *
 * Mirrors `dispatchInsertSnippet` in MiniNotationToolbar.tsx — kept
 * here so `applyToScore` doesn't have to import from the
 * presentation/components tree (and so unit tests can verify the
 * transaction spec against a mock view).
 */
export const insertAtCursor = (view: EditorView, snippet: string): void => {
  const sel = view.state.selection.main;
  const anchor = sel.from + snippet.length;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: snippet },
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: 'nearest' }),
  });
};

/**
 * Build the CodeMirror transaction spec for an at-cursor insert
 * without applying it. Pure: useful for unit tests and for callers
 * that want to compose the spec with their own effects.
 */
export const atCursorSpec = (
  cursorFrom: number,
  cursorTo: number,
  snippet: string,
): {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number };
  effects: ReturnType<typeof EditorView.scrollIntoView>;
} => {
  const anchor = cursorFrom + snippet.length;
  return {
    changes: { from: cursorFrom, to: cursorTo, insert: snippet },
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: 'nearest' }),
  };
};

/**
 * Compact preview-pill payload: count + first N midi names + slot label.
 * Pure — read by PianoToolbar to render the REC pill.
 */
export const previewPillPayload = (): {
  count: number;
  firstNames: ReadonlyArray<string>;
  overflow: number;
  slot: PianoSlot;
  slotLabel: string;
} | null => {
  const buf = recBuffer();
  if (buf.length === 0) return null;
  const PREVIEW_LIMIT = 5;
  const firstNames = buf.slice(0, PREVIEW_LIMIT).map((n) => noteNumberToName(n.midi));
  const overflow = Math.max(0, buf.length - PREVIEW_LIMIT);
  return {
    count: buf.length,
    firstNames,
    overflow,
    slot: pianoSlot(),
    slotLabel: pianoSlotLabel(pianoSlot()),
  };
};

// =========================================================================
// Paren-aware scanner helpers — minimal subset of gridState.ts's helper
// trio, kept inline because they're <50 lines combined and only used by
// `stackAppend` from this module. Extracting them to a shared module
// would add a file for no real reuse benefit.
//
// If a third stack-parser consumer appears (likely none), extract into
// `presentation/state/stackParse.ts`.
// =========================================================================

const skipWhitespaceAndComments = (src: string, i: number): number => {
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
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
  // Require word-break after `(` (whitespace, comment, or close-paren) so
  // we don't confuse `stackFollower(...)` for a real stack call.
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