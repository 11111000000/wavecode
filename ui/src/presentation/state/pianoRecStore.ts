import { createSignal } from 'solid-js';
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { PianoInstrument } from '~/domain/music/notes';
import { noteToneSnippet, noteNumberToName } from '~/domain/music/notes';
import { appendToTopStack } from '~/domain/strudel';
import { consoleStore } from '~/presentation/components/consoleStore';
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
 * Merge a freshly-committed snippet into the current editor score.
 *
 * Delegates to the shared AST-backed `appendToTopStack`
 * (`ui/src/domain/strudel/splice.ts`), replacing the hand-rolled
 * paren-walker this module used to keep inline. Handles three cases:
 *
 *   1. empty editor                   → snippet verbatim
 *   2. editor already has top-level
 *      `stack(...)`                  → splice snippet INSIDE the existing
 *                                       stack, comma-separated as a new
 *                                       layer
 *   3. editor has a single non-stack
 *      pattern (e.g. just `note(...)`) → wrap BOTH in a fresh `stack(...)`
 *
 * If the top-level `stack(` is unterminated (malformed score), the
 * returned string is the original score unchanged — the caller
 * (`applyToScore`) surfaces a warning and preserves the recording
 * rather than emitting broken code. `appendToTopStack` signals this
 * with `{ ok: false }`.
 */
export const stackAppend = (currentScore: string, snippet: string): string => {
  const result = appendToTopStack(currentScore, snippet);
  return result.ok ? result.score : currentScore;
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
    // Flash the entire new doc — destructive replace, every line is new.
    flashAfterCommit();
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
    const sel = view.state.selection.main;
    insertAtCursor(view, snippet);
    // Flash the inserted lines. After view.dispatch above, the doc
    // already reflects the change, so `view.state.doc` is the new doc.
    const insertEnd = sel.from + snippet.length;
    flashRange(view, sel.from, insertEnd);
    setRecBuffer([]);
    return;
  }

  // append-stack
  const result = appendToTopStack(appStore.score, snippet);
  if (!result.ok) {
    consoleStore.pushToast({
      severity: 'warn',
      title: 'Не удалось вставить запись',
      body: 'В score незакрытая скобка stack(...) — исправьте синтаксис и повторите.',
    });
    return; // preserve the recording for retry
  }
  dispatch({ type: 'replaceScore', text: result.score });
  setRecBuffer([]);
  // Flash the appended lines at the end of the new doc.
  flashAfterCommit();
};

/**
 * After a replace-score / append-stack commit, flash the inserted range
 * in the CodeMirror view. Walks through `pianoEditorApi()`; if no
 * editor is wired (e.g. mobile BottomSheet with editor hidden), this
 * is a silent no-op — the preview-pill still gives feedback.
 */
const flashAfterCommit = (): void => {
  const api = pianoEditorApi();
  if (!api) return;
  // After Solid's reactive graph finishes, the CodeMirror createEffect
  // has already mirrored appStore.score → view.state.doc, so we can
  // flash [0, doc.length) right now. queueMicrotask is a defensive
  // hop that survives the rare case where CodeMirror batches updates
  // across multiple Solid ticks.
  queueMicrotask(() => {
    const v = api.getView();
    if (!v || !v.dom.isConnected) return;
    flashLastInsertRange(v);
  });
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
// CodeMirror flash-decorations (wavecode-piano-rec-clarity polish)
// Transient yellow highlight on inserted lines after a successful apply.
// Three pieces:
//   - `setFlashDecorations` / `clearFlashDecorations` StateEffects.
//   - `flashDecorations` StateField — exposes its value as
//     `EditorView.decorations`, drives the actual highlight.
//   - `flashRange(view, from, to)` — caller-side helper that
//     computes line-range decorations, dispatches them, then
//     auto-clears after FLASH_DURATION_MS.
//
// The field MUST be registered in CodeMirrorEditorImpl extensions for
// `provide: EditorView.decorations.from(...)` to take effect.
// =========================================================================

const FLASH_DURATION_MS = 1200;
/** Cap on how many inserted lines get highlighted. Prevents perf issues
 *  for very long snippets (e.g. 100+ notes recorded in a single
 *  session). */
const FLASH_LINE_CAP = 10;

export const setFlashDecorations = StateEffect.define<DecorationSet>();
export const clearFlashDecorations = StateEffect.define<null>();

export const flashDecorations = StateField.define<DecorationSet>({
  create: (): DecorationSet => Decoration.none,
  update: (decos, tr): DecorationSet => {
    for (const e of tr.effects) {
      if (e.is(setFlashDecorations)) return e.value;
      if (e.is(clearFlashDecorations)) return Decoration.none;
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Build a DecorationSet that flashes every inserted line in [from, to).
 *  Pure: takes a CodeMirror doc string + lineAt-resolution helpers so
 *  callers without a live view can still compute it.
 *
 *  Sub-sampling for long inserts: if the range covers more than
 *  FLASH_LINE_CAP lines, only the first and last line are decorated
 *  (highlighted yellow bar still gives a clear visual cue; full
 *  per-line decoration would slow the editor for 100+ line snippets). */
export const buildFlashRange = (
  doc: {
    lineAt(pos: number): { from: number; number: number };
    line(n: number): { from: number };
  },
  from: number,
  to: number,
): DecorationSet => {
  if (from === to) return Decoration.none;
  const fromLine = doc.lineAt(from);
  const toLine = doc.lineAt(to);
  const lineFroms: number[] = [fromLine.from];
  if (toLine.number === fromLine.number) {
    return Decoration.set(
      lineFroms.map((f) =>
        Decoration.line({ attributes: { class: 'cm-line-flash' } }).range(f),
      ),
    );
  }
  const total = toLine.number - fromLine.number + 1;
  if (total <= FLASH_LINE_CAP) {
    for (let n = fromLine.number + 1; n <= toLine.number; n += 1) {
      lineFroms.push(doc.line(n).from);
    }
  } else {
    // Sub-sample: first + last.
    lineFroms.push(doc.line(toLine.number).from);
  }
  return Decoration.set(
    lineFroms.map((f) =>
      Decoration.line({ attributes: { class: 'cm-line-flash' } }).range(f),
    ),
  );
};

/** Apply a transient yellow highlight on every line in [from, to] of
 *  the given view, then auto-clear after FLASH_DURATION_MS. No-op
 *  if the range is empty or the view is destroyed before the timeout. */
export const flashRange = (
  view: EditorView,
  from: number,
  to: number,
): void => {
  if (from === to) return;
  const decos = buildFlashRange(view.state.doc, from, to);
  view.dispatch({ effects: setFlashDecorations.of(decos) });
  setTimeout(() => {
    if (!view.dom.isConnected) return;
    view.dispatch({ effects: clearFlashDecorations.of(null) });
  }, FLASH_DURATION_MS);
};

/**
 * Compute the document range covered by the most recent dispatch, then
 * highlight those lines. Used by `applyToScore` after a successful
 * replace-score or append-stack commit so the user sees WHERE the new
 * snippet landed. At-cursor uses cursor-relative range directly.
 *
 * Looks at the LAST transaction's `changes` field via `view.state` —
 * since `applyToScore` dispatches synchronously, the changes are
 * visible in `view.state.doc` immediately after.
 */
export const flashLastInsertRange = (view: EditorView): void => {
  const doc = view.state.doc;
  // For a fresh view after our dispatch, the change covers [0, doc.length]
  // if we replaced the whole doc, or [insertFrom, insertTo] otherwise.
  // CodeMirror exposes transactions on view.state but the cleanest
  // signal here is: compare against the previous-score snapshot.
  // Simplification: highlight the entire current doc — cheap enough
  // and clear enough for the user (replaces always touch whole doc,
  // append-stack appends to bottom, cursor-insert goes to cursor).
  const last = doc.length;
  if (last === 0) return;
  flashRange(view, 0, last);
};
