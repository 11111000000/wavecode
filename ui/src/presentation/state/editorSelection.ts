import { createSignal, type Accessor } from 'solid-js';
import type { EditorView } from '@codemirror/view';
import { argText, argLeadingName, parseScore } from '~/domain/strudel';
import type { Arg, Span, StackNode } from '~/domain/strudel';

/**
 * CodeMirror selection → AI focused-context.
 *
 * Two concerns live here:
 *
 *   1. **Pure AST-aware extraction** — `getFocusedContext(scoreText,
 *      range)` walks the Strudel AST produced by `parseScore` and
 *      classifies the user's selection. Returns a discriminated
 *      `FocusedContext`:
 *
 *        - `function-call` (preferred) — the selection lives
 *          strictly inside a top-level `CallNode`; the context
 *          carries the leading function name + the verbatim
 *          source text + the original span. Smallest, most-precise
 *          scope.
 *        - `stack-row`     — the selection lives inside a
 *          top-level `StackNode`'s arg; the context carries the
 *          row index + the arg's verbatim text. Useful for
 *          "make row 2 louder" type prompts.
 *        - `text`          — partial / inter-node / multiline
 *          selection that does not match any node; falls back to
 *          the raw selected text. Still gives the LLM something
 *          to anchor on, just less precisely scoped.
 *        - `null`          — collapsed selection (cursor only, no
 *          range) or selection that landed outside any node span
 *          (e.g. trailing whitespace).
 *
 *      Precedence rule: when a range sits inside both a CallNode
 *      and a StackNode's arg, the function-call context wins
 *      (most specific scope). When a range sits inside a
 *      StackNode's arg but no top-level CallNode matches, the
 *      stack-row context wins. Only when neither matches do we
 *      fall back to text.
 *
 *   2. **Live selection signals** — `selectionRange()` and
 *      `selectedText()` are module-level Solid signals updated
 *      by a single tracking loop installed via
 *      `installSelectionTracker(view)`. AIEditPanel reads these
 *      reactively and re-computes `getFocusedContext(...)` on
 *      every change. The tracker is idempotent — re-installing
 *      on the same view disposes the previous loop.
 *
 * Why a NEW file rather than adding to `editorTypingTracker.ts`:
 * the typing tracker is debounce-only and does not have an
 * EditorView (App.tsx passes it `dispatch` only). Selection
 * tracking requires a view reference; bundling it into the
 * typing tracker would force a breaking change to its signature
 * and to the App.tsx call site, which Slot 1.1 freezes.
 *
 * Compatibility: `editorTypingTracker.ts` is untouched; the
 * signals here are additive and only read by AIEditPanel.
 */

export type FocusedContextSpan = {
  readonly start: number;
  readonly end: number;
};

/**
 * The AST-derived context for the user's current selection.
 *
 * `kind` drives the UI affordance (status line, badge, prompt
 * wording); `text` is what gets appended to the LLM user prompt.
 * `name` is set for `function-call` and `stack-row` (best-effort).
 */
export type FocusedContext =
  | {
      readonly kind: 'function-call';
      readonly name: string;
      readonly text: string;
      readonly span: FocusedContextSpan;
    }
  | {
      readonly kind: 'stack-row';
      readonly index: number;
      readonly name: string | null;
      readonly text: string;
      readonly span: FocusedContextSpan;
    }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly span: FocusedContextSpan;
    }
  | null;

/**
 * A range that satisfies `{from, to}` (CodeMirror's
 * `EditorSelection.main` shape) or `null` for "no selection".
 * Pure: no Solid types in the public signature.
 */
export type SelectionRange = {
  readonly from: number;
  readonly to: number;
};

/**
 * Live selection state, exposed as Solid signals so AIEditPanel
 * can `createMemo` over them reactively. Initialised to `null` —
 * the CodeMirror view may not exist yet (lazy import, mobile
 * BottomSheet that hasn't opened the score tab, etc.).
 */
const [selectionRangeSignal, setSelectionRangeSignal] =
  createSignal<SelectionRange | null>(null);
const [selectedTextSignal, setSelectedTextSignal] = createSignal<string | null>(null);

export const selectionRange: Accessor<SelectionRange | null> = selectionRangeSignal;
export const selectedText: Accessor<string | null> = selectedTextSignal;

/** Internal reset helper for tests + dispose paths. */
export const resetSelectionSignals = (): void => {
  setSelectionRangeSignal(null);
  setSelectedTextSignal(null);
};

// ---------------------------------------------------------------------------
// Pure AST-aware extraction
// ---------------------------------------------------------------------------

const spanContains = (outer: Span, from: number, to: number): boolean =>
  from >= outer.start && to <= outer.end;

const spanIncludesRange = (outer: Span, range: SelectionRange): boolean =>
  spanContains(outer, range.from, range.to) && range.from < range.to;

const spanToFC = (span: Span): FocusedContextSpan => ({
  start: span.start,
  end: span.end,
});

const argTextAndName = (arg: Arg): { text: string; name: string | null } => {
  const text = argText(arg);
  const name = argLeadingName(arg);
  return { text, name };
};

/**
 * Walk a single `ScoreNode` looking for the most specific
 * `FocusedContext` that strictly contains the given range.
 *
 * Precedence (most → least specific):
 *
 *   1. A top-level `CallNode` whose span ⊇ range → function-call.
 *   2. A top-level `StackNode`'s arg whose span ⊇ range →
 *      stack-row (the row index in `StackNode.args`).
 *   3. Otherwise text-fallback at the call site.
 *
 * We do NOT recursively descend into nested calls inside stack
 * args — Strudel args inside a `StackNode` are opaque (the AST
 * captures them as `expr`/`string`/etc.), and the relevant
 * scope for AI is the row, not the inner expression.
 */
const classifyInStack = (stack: StackNode, range: SelectionRange): FocusedContext => {
  // Prefer the row whose span strictly contains the range.
  for (let i = 0; i < stack.args.length; i += 1) {
    const arg = stack.args[i]!;
    if (spanIncludesRange(arg.span, range)) {
      const { text, name } = argTextAndName(arg);
      return {
        kind: 'stack-row',
        index: i,
        name,
        text,
        span: spanToFC(arg.span),
      };
    }
  }
  // No single arg fits the whole range — fall back to the arg
  // that contains `range.from` (so the LLM prompt still names
  // a row), or null if the range starts between args.
  for (let i = 0; i < stack.args.length; i += 1) {
    const arg = stack.args[i]!;
    if (range.from >= arg.span.start && range.from <= arg.span.end) {
      const { text, name } = argTextAndName(arg);
      return {
        kind: 'stack-row',
        index: i,
        name,
        text,
        span: spanToFC(arg.span),
      };
    }
  }
  return null;
};

/**
 * The public API: classify the user's selection against the
 * AST produced by `parseScore(scoreText)`.
 *
 * Returns `null` when:
 *   - the range is collapsed (`from === to`);
 *   - the range does not fall inside any node span;
 *   - the score is empty / whitespace-only.
 *
 * The function is pure: same inputs → same output, no side
 * effects, no Solid signals touched. It is safe to call from
 * a `createMemo` that re-runs on every selection change.
 */
export const getFocusedContext = (
  scoreText: string,
  range: SelectionRange | null,
): FocusedContext => {
  if (range === null) return null;
  if (range.from === range.to) return null;
  if (scoreText.length === 0) return null;

  // Range may have from > to if the user dragged from right to
  // left — CodeMirror normalises this, but defend at the API
  // boundary so a bad call site cannot produce inverted spans.
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  if (from < 0 || to > scoreText.length) {
    // Selection drifted off the doc (e.g. after a doc change
    // that shrank the buffer). Treat as no-selection.
    return null;
  }

  let ast;
  try {
    ast = parseScore(scoreText);
  } catch {
    // The parser is documented as non-throwing, but defend
    // against future changes — fall back to text rather than
    // crashing the AI panel.
    return {
      kind: 'text',
      text: scoreText.slice(from, to),
      span: { start: from, end: to },
    };
  }

  // Pass 1: function-call — most specific. Any top-level
  // CallNode whose span strictly contains the range wins
  // outright (we don't recurse — see classifyInNode).
  for (const node of ast.nodes) {
    if (node.kind !== 'call') continue;
    if (!spanIncludesRange(node.span, { from, to })) continue;
    // Recover the verbatim call source from the original text.
    // The AST node carries `name` and a `span` but not the
    // verbatim text — reconstruct via slice so the LLM sees
    // the user's exact characters (including trailing dots,
    // `.gain(0.4)` chains, etc.).
    const verbatim = scoreText.slice(node.span.start, node.span.end);
    return {
      kind: 'function-call',
      name: node.name,
      text: verbatim,
      span: spanToFC(node.span),
    };
  }

  // Pass 2: stack-row — any top-level StackNode whose span
  // contains the range contributes a stack-row context.
  for (const node of ast.nodes) {
    if (node.kind !== 'stack') continue;
    if (!spanContains(node.span, from, to)) continue;
    const ctx = classifyInStack(node, { from, to });
    if (ctx !== null) return ctx;
  }

  // Pass 3: text-fallback — the range covers SOMETHING in the
  // doc but no AST node fit. The user might have highlighted
  // partial nodes, whitespace-only, or trailing text. Return
  // the literal selected text so the LLM at least sees what was
  // selected.
  return {
    kind: 'text',
    text: scoreText.slice(from, to),
    span: { start: from, end: to },
  };
};

// ---------------------------------------------------------------------------
// Live selection tracker (rAF poll on EditorView.selection.main)
// ---------------------------------------------------------------------------

/**
 * Module-level cleanup handle for the most recent
 * `installSelectionTracker` call. Re-installing on the same
 * view disposes the previous loop so we never double-fire.
 *
 * Implementation note: CodeMirror 6 has no dedicated
 * `selectionChange` extension; the recommended pattern is to
 * register an `EditorView.updateListener` in the view's
 * extensions array at construction time. Doing that from a
 * separate module would require either:
 *
 *   - exposing a Compartment on the view and re-configuring
 *     it (heavy; one transaction per install), OR
 *   - extending `CodeMirrorEditorApi` with an `addExtension`
 *     method (a permanent API change for one feature).
 *
 * A 60Hz rAF poll is the cheapest correct alternative: it
 * costs one equality check per frame and runs only while the
 * view is connected. We seed the signals synchronously at
 * install time so the very first AIEditPanel read returns the
 * real selection rather than a transient null.
 */
let activeDispose: (() => void) | null = null;
let activeView: EditorView | null = null;

/**
 * Read the current main selection from a CodeMirror view and
 * start a 60Hz poll that updates the module-level signals on
 * every selection change. Idempotent: re-installing on the same
 * view no-ops; re-installing on a different view disposes the
 * previous loop first.
 */
export const installSelectionTracker = (view: EditorView): (() => void) => {
  if (activeView === view && activeDispose !== null) {
    return activeDispose;
  }

  if (activeDispose !== null) {
    activeDispose();
    activeDispose = null;
  }

  // Seed with the view's current selection so the first
  // AIEditPanel read after install returns a real value rather
  // than null-then-update.
  const initial = view.state.selection.main;
  let lastFrom = initial.from;
  let lastTo = initial.to;
  pushSelection(lastFrom, lastTo, view.state.doc.toString());

  let raf = 0;
  let stopped = false;
  const poll = (): void => {
    if (stopped) return;
    raf = 0;
    if (!view.dom.isConnected) return;
    const sel = view.state.selection.main;
    if (sel.from !== lastFrom || sel.to !== lastTo) {
      lastFrom = sel.from;
      lastTo = sel.to;
      pushSelection(lastFrom, lastTo, view.state.doc.toString());
    }
    raf = requestAnimationFrame(poll);
  };
  raf = requestAnimationFrame(poll);

  const dispose = (): void => {
    stopped = true;
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (activeView === view) {
      activeView = null;
      activeDispose = null;
    }
  };
  activeView = view;
  activeDispose = dispose;
  return dispose;
};

const pushSelection = (from: number, to: number, doc: string): void => {
  if (from === to) {
    setSelectionRangeSignal(null);
    setSelectedTextSignal(null);
    return;
  }
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  setSelectionRangeSignal({ from: lo, to: hi });
  setSelectedTextSignal(doc.slice(lo, hi));
};

// ---------------------------------------------------------------------------
// Keyboard shortcut registration (Ctrl/Cmd+Shift+L → AI focus on selection)
// ---------------------------------------------------------------------------

/**
 * Module-level handler slot for the AI "explain/replace the
 * selection" hotkey. App.tsx is frozen by Slot 1.1, so the
 * centralized `installKeyboardShortcuts` does NOT take this
 * handler directly — AIEditPanel registers it via
 * `registerAiExplainSelectedHandler` from its onMount, and the
 * lazy wrapper in `useKeyboardShortcuts` (added in this branch)
 * resolves the handler at press-time.
 *
 * Lazy resolution also covers the case where AIEditPanel mounts
 * AFTER `useKeyboardShortcuts`'s onMount fires: the wrapper
 * reads this signal at the moment the user presses the hotkey,
 * by which point AIEditPanel has populated it.
 *
 * The slot is wrapped in an object so that Solid's setter type
 * overload can distinguish between "set to a new handler
 * function" (the actual value) and "compute next value via a
 * callback" — a bare `(() => void) | null` slot would have the
 * setter treat any function as a setter callback and return
 * `void` (undefined), silently dropping the handler.
 */
type HandlerSlot = { readonly fn: (() => void) | null };

const [aiExplainSelectedSlot, setAiExplainSelectedSlotSignal] =
  createSignal<HandlerSlot>({ fn: null });

export const aiExplainSelectedAccessor: Accessor<(() => void) | null> = () =>
  aiExplainSelectedSlot().fn;

/**
 * Register the AI-panel-side handler for Ctrl/Cmd+Shift+L.
 * Returns a disposer. Called from AIEditPanel's onMount.
 */
export const registerAiExplainSelectedHandler = (
  handler: (() => void) | null,
): (() => void) => {
  setAiExplainSelectedSlotSignal({ fn: handler });
  return () => {
    if (aiExplainSelectedSlot().fn === handler) {
      setAiExplainSelectedSlotSignal({ fn: null });
    }
  };
};