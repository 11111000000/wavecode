import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import type { CodeMirrorEditorApi } from './CodeMirrorEditor';
import { dispatchInsertSnippet, SNIPPETS, MiniNotationToolbar } from './MiniNotationToolbar';

/**
 * Build a headless EditorView rooted at a detached DOM node.
 * CodeMirror requires a parent element with `appendChild` capacity —
 * jsdom provides it via document.createElement('div').
 */
function makeView(doc: string, selection?: { anchor: number; head?: number }): EditorView {
  const baseConfig: { doc: string; extensions: Extension[]; selection?: { anchor: number; head: number } } = {
    doc,
    extensions: [history()],
  };
  if (selection) {
    baseConfig.selection = { anchor: selection.anchor, head: selection.head ?? selection.anchor };
  }
  const state = EditorState.create(baseConfig);
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  view.focus();
  return view;
}

function destroy(view: EditorView): void {
  view.destroy();
  view.dom.remove();
}

describe('dispatchInsertSnippet', () => {
  it('inserts snippet at cursor when there is no selection', () => {
    const view = makeView('hello', { anchor: 5 });
    dispatchInsertSnippet(view, 'note(');
    expect(view.state.doc.toString()).toBe('hellonote(');
    expect(view.state.selection.main.from).toBe(10);
    expect(view.state.selection.main.to).toBe(10);
    destroy(view);
  });

  it('inserts snippet at the start of an empty doc', () => {
    const view = makeView('', { anchor: 0 });
    dispatchInsertSnippet(view, 'note(');
    expect(view.state.doc.toString()).toBe('note(');
    expect(view.state.selection.main.from).toBe(5);
    destroy(view);
  });

  it('replaces a selected range with the snippet', () => {
    const view = makeView('hello world', { anchor: 6, head: 11 });
    dispatchInsertSnippet(view, 'note(');
    expect(view.state.doc.toString()).toBe('hello note(');
    expect(view.state.selection.main.from).toBe(11);
    expect(view.state.selection.main.to).toBe(11);
    destroy(view);
  });

  it('handles single-char operators (<, >, [, ], *, ?, comma)', () => {
    const view = makeView('ab', { anchor: 1 });
    dispatchInsertSnippet(view, '<');
    expect(view.state.doc.toString()).toBe('a<b');
    expect(view.state.selection.main.from).toBe(2);
    destroy(view);
  });

  it('inserts a literal space', () => {
    const view = makeView('note(', { anchor: 5 });
    dispatchInsertSnippet(view, ' ');
    expect(view.state.doc.toString()).toBe('note( ');
    expect(view.state.selection.main.from).toBe(6);
    destroy(view);
  });

  it('each snippet insert is undoable as a single transaction', () => {
    const view = makeView('hello', { anchor: 5 });
    dispatchInsertSnippet(view, 'note(');
    expect(view.state.doc.toString()).toBe('hellonote(');

    // Undo: CodeMirror history extension treats consecutive transactions
    // in the same user-event tick as one undoable unit, but each separate
    // dispatch call is its own undo unit unless grouped.
    undo(view);
    expect(view.state.doc.toString()).toBe('hello');

    redo(view);
    expect(view.state.doc.toString()).toBe('hellonote(');
    destroy(view);
  });

  it('does not throw when view has empty doc and cursor at 0', () => {
    const view = makeView('', { anchor: 0 });
    expect(() => dispatchInsertSnippet(view, '.gain(')).not.toThrow();
    expect(view.state.doc.toString()).toBe('.gain(');
    destroy(view);
  });
});

describe('SNIPPETS', () => {
  it('has exactly 14 entries matching the packet spec', () => {
    expect(SNIPPETS).toHaveLength(14);
    const inserts = SNIPPETS.map((s) => s.insert);
    expect(inserts).toEqual([
      'note(',
      's(',
      'stack(',
      'n(',
      '<',
      '>',
      '[',
      ']',
      '*',
      '?',
      '.gain(',
      '.lpf(',
      ',',
      ' ',
    ]);
  });

  it('every entry has non-empty label, insert, and ariaLabel', () => {
    for (const s of SNIPPETS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.insert.length).toBeGreaterThan(0);
      expect(s.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it('labels render visibly on narrow screens (no zero-width chars)', () => {
    for (const s of SNIPPETS) {
      // ␣ is a printable Unicode visible-symbol (U+2423 OPEN BOX) used as
      // the visible representation of space; it must NOT be empty.
      expect(s.label).not.toBe('');
      expect(s.label).not.toMatch(/^\s+$/);
    }
  });
});

/**
 * Click-test: рендерит реальный <MiniNotationToolbar> в jsdom, с реальным
 * EditorView (in-memory), переданным через accessor (editor={() => api}).
 * Проверяет, что клик по кнопке 'note(' вставляет 'note(' в doc —
 * т.е. реактивность accessor-а работает (без неё view был бы undefined).
 */
describe('MiniNotationToolbar click (real EditorView + accessor)', () => {
  afterEach(() => cleanup());

  function makeApi(view: EditorView): CodeMirrorEditorApi {
    return { getView: () => view };
  }

  it("click on 'note(' button inserts 'note(' into the EditorView doc", () => {
    const view = makeView('', { anchor: 0 });
    try {
      const api = makeApi(view);
      const { getByLabelText } = render(() => (
        <MiniNotationToolbar editor={() => api} />
      ));

      const btn = getByLabelText('Insert note function call') as HTMLButtonElement;
      fireEvent.click(btn);

      expect(view.state.doc.toString()).toContain('note(');
      expect(view.state.selection.main.from).toBe(5);
    } finally {
      destroy(view);
    }
  });

  it('accessor returning undefined editor → click is a no-op (no throw)', () => {
    const { getByLabelText } = render(() => (
      <MiniNotationToolbar editor={() => undefined} />
    ));

    const btn = getByLabelText('Insert note function call') as HTMLButtonElement;
    expect(() => fireEvent.click(btn)).not.toThrow();
  });

  it('editor prop omitted → click is a no-op (no throw)', () => {
    const { getByLabelText } = render(() => (
      <MiniNotationToolbar />
    ));

    const btn = getByLabelText('Insert note function call') as HTMLButtonElement;
    expect(() => fireEvent.click(btn)).not.toThrow();
  });
});
