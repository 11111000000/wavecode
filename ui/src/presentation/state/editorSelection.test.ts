import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, createEffect } from 'solid-js';
import { parseScore } from '~/domain/strudel';
import {
  getFocusedContext,
  selectionRange,
  selectedText,
  resetSelectionSignals,
  installSelectionTracker,
  registerAiExplainSelectedHandler,
  aiExplainSelectedAccessor,
  type SelectionRange,
} from './editorSelection';

/**
 * Tests for the AST-aware selection → FocusedContext pipeline.
 *
 * Three layers of coverage:
 *
 *   1. Pure AST classification (`getFocusedContext`) — the
 *      discriminated union's four kinds: function-call,
 *      stack-row, text-fallback, null. Includes precedence
 *      (function-call wins over stack-row when both apply)
 *      and edge cases (collapsed cursor, partial selection,
 *      inverted range, range past EOF).
 *
 *   2. Live selection signals — `installSelectionTracker` reads
 *      a mock EditorView and pushes the current main selection
 *      into the module-level Solid signals. The tracker uses
 *      `requestAnimationFrame`; tests use vi's fake timers to
 *      flush ticks deterministically.
 *
 *   3. Hotkey handler slot — `registerAiExplainSelectedHandler`
 *      is idempotent and the disposer unsets the slot.
 */

// ---------------------------------------------------------------------------
// Mock EditorView — minimal surface for installSelectionTracker
// ---------------------------------------------------------------------------

type MockSel = { readonly from: number; readonly to: number };

class MockView {
  selection: MockSel = { from: 0, to: 0 };
  doc = '';
  dom: { isConnected: boolean };

  constructor(initialDoc: string, isConnected = true) {
    this.doc = initialDoc;
    this.dom = { isConnected };
  }

  /** Simulate a selection change. */
  setSelection(from: number, to: number): void {
    this.selection = { from, to };
  }

  /** Edit the doc (so the slice in pushSelection changes). */
  setDoc(text: string): void {
    this.doc = text;
  }

  get state(): {
    selection: { main: MockSel };
    doc: { toString(): string };
  } {
    return {
      selection: { main: this.selection },
      doc: { toString: () => this.doc },
    };
  }
}

/** Cast helper: the tracker expects a real EditorView; for tests
 *  we only read `.state.selection.main`, `.state.doc.toString()`,
 *  and `.dom.isConnected` — MockView satisfies that surface. */
const asView = (v: MockView): Parameters<typeof installSelectionTracker>[0] =>
  v as unknown as Parameters<typeof installSelectionTracker>[0];

/** Narrow helper: assert result is non-null in tests. */
const unwrap = <T>(v: T): Exclude<T, null> => {
  if (v === null) throw new Error('expected non-null');
  return v as Exclude<T, null>;
};

// ---------------------------------------------------------------------------
// Pure AST classification
// ---------------------------------------------------------------------------

describe('getFocusedContext — AST classification', () => {
  it('returns null for a null range', () => {
    expect(getFocusedContext('note("c4")', null)).toBeNull();
  });

  it('returns null for a collapsed cursor (from === to)', () => {
    expect(getFocusedContext('note("c4")', { from: 5, to: 5 })).toBeNull();
  });

  it('returns null for an empty score', () => {
    expect(getFocusedContext('', { from: 0, to: 0 })).toBeNull();
    expect(getFocusedContext('', { from: 5, to: 10 })).toBeNull();
  });

  it('returns null when the range is past the end of the doc', () => {
    expect(getFocusedContext('note("c4")', { from: 100, to: 200 })).toBeNull();
  });

  it('returns null when the range starts past EOF', () => {
    const text = 'note("c4")'; // 10 chars
    expect(getFocusedContext(text, { from: 50, to: 10 })).toBeNull();
  });

  it('normalises inverted ranges (from > to)', () => {
    const result = unwrap(getFocusedContext('note("c4")', { from: 8, to: 0 }));
    expect(result.kind).toBe('function-call');
    if (result.kind === 'function-call') {
      expect(result.name).toBe('note');
    }
  });

  it('matches a top-level CallNode as function-call', () => {
    const text = 'note("c4 e3 g3")';
    const result = unwrap(getFocusedContext(text, { from: 0, to: 15 }));
    expect(result.kind).toBe('function-call');
    if (result.kind === 'function-call') {
      expect(result.name).toBe('note');
      expect(result.text).toBe(text);
    }
  });

  it('matches a partial CallNode span as function-call', () => {
    const text = 'note("c4 e3 g3").gain(0.4).slow(2)';
    const result = unwrap(getFocusedContext(text, { from: 0, to: 15 }));
    expect(result.kind).toBe('function-call');
    if (result.kind === 'function-call') {
      expect(result.name).toBe('note');
    }
  });

  it('matches a stack-row by index', () => {
    const text = 'stack(\n  s("bd*4"),\n  note("c3"),\n  n("0 1 2")\n)';
    const ast = parseScore(text);
    const stack = ast.nodes[0];
    if (!stack || stack.kind !== 'stack') throw new Error('expected stack');
    const noteRow = stack.args[1]!;
    expect(noteRow.span.start).toBeGreaterThan(0);
    const result = unwrap(
      getFocusedContext(text, {
        from: noteRow.span.start,
        to: noteRow.span.end,
      }),
    );
    expect(result.kind).toBe('stack-row');
    if (result.kind === 'stack-row') {
      expect(result.index).toBe(1);
      expect(result.name).toBe('note');
      expect(result.text).toContain('note("c3")');
    }
  });

  it('prefers function-call over stack-row when both apply', () => {
    const text = 'note("c4")';
    const result = unwrap(getFocusedContext(text, { from: 0, to: 10 }));
    expect(result.kind).toBe('function-call');
  });

  it('falls back to text for whitespace-only selection', () => {
    const result = unwrap(getFocusedContext('   ', { from: 0, to: 3 }));
    expect(result.kind).toBe('text');
    if (result.kind === 'text') {
      expect(result.text).toBe('   ');
    }
  });

  it('falls back to text for a selection between two calls', () => {
    const text = 'note("c4")\n\nnote("e4")';
    const result = unwrap(getFocusedContext(text, { from: 10, to: 13 }));
    expect(result.kind).toBe('text');
    if (result.kind === 'text') {
      expect(result.text.length).toBeGreaterThan(0);
    }
  });

  it('falls back to text when the range extends past a CallNode span', () => {
    const text = '  note("c4")  '; // length 14
    const result = unwrap(getFocusedContext(text, { from: 0, to: 14 }));
    expect(result.kind).toBe('text');
    if (result.kind === 'text') {
      expect(result.text).toBe(text);
    }
  });
});

// ---------------------------------------------------------------------------
// Live selection signals + installSelectionTracker
// ---------------------------------------------------------------------------

describe('selection signals + installSelectionTracker', () => {
  let view: MockView;

  beforeEach(() => {
    resetSelectionSignals();
    vi.useFakeTimers();
    view = new MockView('hello world', true);
  });

  afterEach(() => {
    view.dom.isConnected = false;
    vi.useRealTimers();
  });

  it('seeds the signals from the view on install', () => {
    view.setSelection(2, 7);
    createRoot((dispose) => {
      const trackerDispose = installSelectionTracker(asView(view));
      expect(selectionRange()).toEqual({ from: 2, to: 7 });
      expect(selectedText()).toBe('hello world'.slice(2, 7));
      trackerDispose();
      dispose();
    });
  });

  it('updates the signals when the view selection changes (after an rAF tick)', () => {
    view.setSelection(0, 0); // start with collapsed
    createRoot((dispose) => {
      const trackerDispose = installSelectionTracker(asView(view));
      expect(selectionRange()).toBeNull();
      view.setSelection(0, 5);
      vi.advanceTimersByTime(20);
      expect(selectionRange()).toEqual({ from: 0, to: 5 });
      expect(selectedText()).toBe('hello'.slice(0, 5));
      trackerDispose();
      dispose();
    });
  });

  it('clears the signals when the selection becomes collapsed', () => {
    view.setSelection(2, 7);
    createRoot((dispose) => {
      const trackerDispose = installSelectionTracker(asView(view));
      expect(selectionRange()).toEqual({ from: 2, to: 7 });
      view.setSelection(4, 4);
      vi.advanceTimersByTime(20);
      expect(selectionRange()).toBeNull();
      expect(selectedText()).toBeNull();
      trackerDispose();
      dispose();
    });
  });

  it('dispose stops further updates', () => {
    createRoot((dispose) => {
      const trackerDispose = installSelectionTracker(asView(view));
      expect(selectionRange()).toBeNull();
      trackerDispose();
      view.setSelection(5, 8);
      vi.advanceTimersByTime(20);
      expect(selectionRange()).toBeNull();
      dispose();
    });
  });

  it('creates a reactive signal that downstream createEffect can watch', async () => {
    view.setSelection(1, 4);
    const captured: Array<{ range: SelectionRange | null; text: string | null }> = [];
    let trackerDispose: () => void = (): void => {};
    let rootDispose: () => void = (): void => {};
    rootDispose = createRoot((dispose) => {
      trackerDispose = installSelectionTracker(asView(view));
      createEffect(() => {
        captured.push({ range: selectionRange(), text: selectedText() });
      });
      return dispose;
    });
    // Wait for the createEffect's first run.
    await Promise.resolve();
    await Promise.resolve();
    expect(captured.length).toBeGreaterThanOrEqual(1);
    expect(captured[captured.length - 1]!.range).toEqual({ from: 1, to: 4 });

    // Drive a follow-up selection change and verify the effect
    // re-runs with the new value.
    view.setSelection(0, 2);
    vi.advanceTimersByTime(20);
    await Promise.resolve();
    await Promise.resolve();
    expect(captured[captured.length - 1]!.range).toEqual({ from: 0, to: 2 });

    // Cleanup at the END so the tracker + root stay alive for
    // both assertions.
    trackerDispose();
    rootDispose();
  });
});

// ---------------------------------------------------------------------------
// Hotkey handler slot
// ---------------------------------------------------------------------------

describe('registerAiExplainSelectedHandler', () => {
  beforeEach(() => {
    resetSelectionSignals();
  });

  it('stores the handler and the accessor returns it', () => {
    const handler = vi.fn();
    const dispose = registerAiExplainSelectedHandler(handler);
    const resolved = aiExplainSelectedAccessor();
    expect(resolved).not.toBeNull();
    if (resolved === null) throw new Error('expected non-null');
    resolved();
    expect(handler).toHaveBeenCalledTimes(1);
    dispose();
    expect(aiExplainSelectedAccessor()).toBeNull();
  });

  it('clears the slot when the disposer is called', () => {
    const handler = vi.fn();
    const dispose = registerAiExplainSelectedHandler(handler);
    expect(aiExplainSelectedAccessor()).not.toBeNull();
    dispose();
    expect(aiExplainSelectedAccessor()).toBeNull();
  });

  it('re-registering replaces the previous handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    registerAiExplainSelectedHandler(first);
    registerAiExplainSelectedHandler(second);
    aiExplainSelectedAccessor()?.();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('passing null clears the slot', () => {
    registerAiExplainSelectedHandler(vi.fn());
    expect(aiExplainSelectedAccessor()).not.toBeNull();
    registerAiExplainSelectedHandler(null);
    expect(aiExplainSelectedAccessor()).toBeNull();
  });
});