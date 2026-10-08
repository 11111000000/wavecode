import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { createEffect, onCleanup, onMount, untrack } from 'solid-js';
import { miniNotationHighlight } from '../editor/miniNotationHighlight';
import { strudelCompletions } from '../editor/strudelCompletions';

export type CodeMirrorEditorApi = {
  readonly getView: () => EditorView | undefined;
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
        autocompletion({ override: [strudelCompletions] }),
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

    const api: CodeMirrorEditorApi = {
      getView: () => view,
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