import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { createEffect, onCleanup, onMount, untrack } from 'solid-js';
import { miniNotationHighlight } from '../editor/miniNotationHighlight';
import { runtimeMiniHighlight } from '../editor/runtimeMiniHighlight';
import { strudelCompletions } from '../editor/strudelCompletions';
import { flashDecorations } from '../state/pianoRecStore';
import { installSelectionTracker, type SelectionRange } from '../state/editorSelection';

export type CodeMirrorEditorApi = {
  readonly getView: () => EditorView | undefined;
  /**
   * wavecode-editor-selection-ai: current main selection in the
   * editor (null for a collapsed cursor). Optional because
   * pre-existing tests / mocks construct CodeMirrorEditorApi
   * inline without `getSelection` — making it required would
   * break the entire test suite for a feature the existing
   * tests do not exercise.
   */
  readonly getSelection?: () => SelectionRange | null;
};

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onReady?: (api: CodeMirrorEditorApi) => void;
};

/**
 * Solid wrapper для CodeMirror 6 vanilla API.
 *
 * Two-way binding:
 *   - при mount инициализируется EditorView с props.value
 *   - onChange диспатчится на каждое doc change
 *   - если props.value меняется извне (например, через agent edit),
 *     editor обновляется через dispatch(changes)
 *
 * Imperative handle: после mount вызывает props.onReady(api) с
 * функцией getView() — внешние компоненты (например, mini-toolbar)
 * могут диспатчить транзакции напрямую через view.dispatch.
 *
 * Loaded via lazy() wrapper in ./CodeMirrorEditor.tsx — этот файл
 * импортирует весь CodeMirror (~400KB gzip) только когда пользователь
 * открывает score tab в первый раз.
 */
export function CodeMirrorEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  onMount(() => {
    if (!containerRef) return;
    const initial = untrack(() => props.value);
    const state = EditorState.create({
      doc: initial,
      extensions: [
        basicSetup,
        oneDark,
        miniNotationHighlight,
        runtimeMiniHighlight,
        autocompletion({ override: [strudelCompletions] }),
        flashDecorations,
        EditorView.contentAttributes.of({
          autocorrect: 'off',
          autocapitalize: 'off',
          spellcheck: 'false',
          inputmode: 'text',
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) untrack(() => props.onChange(u.state.doc.toString()));
        }),
      ],
    });
    view = new EditorView({ state, parent: containerRef });

    // wavecode-editor-selection-ai: wire the live-selection
    // tracker so AIEditPanel can read selectionRange() /
    // selectedText() reactively. Idempotent — re-installing on
    // the same view disposes the previous loop.
    const trackerDispose = installSelectionTracker(view);
    onCleanup(() => trackerDispose());

    const api: CodeMirrorEditorApi = {
      getView: () => view,
      getSelection: () => {
        if (!view) return null;
        const sel = view.state.selection.main;
        if (sel.from === sel.to) return null;
        const lo = Math.min(sel.from, sel.to);
        const hi = Math.max(sel.from, sel.to);
        return { from: lo, to: hi };
      },
    };
    untrack(() => props.onReady?.(api));
  });

  createEffect(() => {
    const next = props.value;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== next) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
    }
  });

  onCleanup(() => view?.destroy());

  return (
    <div
      ref={containerRef}
      class="cm-host cm-host-fill"
      style={{
        border: '1px solid var(--border)',
        'border-radius': '4px',
        overflow: 'hidden',
      }}
    />
  );
}
