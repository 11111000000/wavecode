import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { bracketMatching } from '@codemirror/language';
import { createEffect, onCleanup, onMount, untrack } from 'solid-js';
import { miniNotationHighlight } from '../editor/miniNotationHighlight';
import { runtimeMiniHighlight } from '../editor/runtimeMiniHighlight';
import { strudelCompletions } from '../editor/strudelCompletions';
import { lispHighlight, lispHighlightStyles } from '../editor/lispHighlight';
import { languageMode } from '../state/languageModeStore';
import { flashDecorations } from '../state/pianoRecStore';

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
 * Language mode:
 *   - Subscribes to `languageMode()`. On change, dispatches
 *     `lispCompartment.reconfigure(...)` so lispHighlight / bracketMatching
 *     appear or disappear without losing cursor position or doc content.
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
  const lispCompartment = new Compartment();

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
        lispCompartment.of(buildLispExtensions()),
        lispHighlightStyles,
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

  // Reconfigure lisp-related extensions when language mode changes.
  // Compartment.reconfigure preserves cursor/selection/doc — only the
  // extension set swaps. The lispHighlight plugin re-evaluates
  // `languageMode()` on its next update pass.
  createEffect(() => {
    languageMode();
    if (!view) return;
    untrack(() =>
      view!.dispatch({
        effects: lispCompartment.reconfigure(buildLispExtensions()),
      }),
    );
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

/**
 * Lisp-specific extension set, swapped via Compartment on mode change.
 * - Lisp mode: lispHighlight decoration + bracketMatching.
 * - JS mode: empty array (mini-notation highlight comes from
 *   `miniNotationHighlight`, already in the static extension list).
 */
const buildLispExtensions = (): Extension[] => {
  if (languageMode() !== 'lisp') return [];
  return [bracketMatching(), lispHighlight(() => languageMode() === 'lisp')];
};