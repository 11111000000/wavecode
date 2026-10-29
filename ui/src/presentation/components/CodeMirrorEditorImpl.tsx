import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { For, Show, createEffect, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import { miniNotationHighlight } from '../editor/miniNotationHighlight';
import { runtimeMiniHighlight } from '../editor/runtimeMiniHighlight';
import { strudelCompletions } from '../editor/strudelCompletions';
import { vocabTooltip } from '../editor/vocabTooltip';
import {
  instrumentClickPicker,
  type InstrumentPickTarget,
} from '../editor/instrumentClickPicker';
import {
  MELODIC_SOUNDS,
  DRUM_SOUNDS,
  DRUMS_ONLY_ID,
} from '~/domain/sounds';
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

  /**
   * The sound picker opened by clicking a sound name in the score.
   * `null` = closed.
   */
  const [pickTarget, setPickTarget] = createSignal<InstrumentPickTarget | null>(null);

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
        // wavecode-inline-tooltips: hover popover with Russian
        // description + example for Strudel functions, samples,
        // and note names. See `decisions/wavecode-inline-tooltips.yaml`
        // for scope / silence contract.
        vocabTooltip(),
        // wavecode-instrument-picker: click a sound name in the
        // score to swap it for another one that really exists.
        instrumentClickPicker((target) => { setPickTarget(target); }),
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

  /**
   * Replace the clicked sound name with the picked one.
   *
   * The replacement is a plain CM6 transaction over the token range
   * (no quotes) — the score text is the source of truth and the
   * editor's `updateListener` pushes the new document up to the store.
   */
  const applyInstrument = (id: string): void => {
    const target = pickTarget();
    if (!view || target === null) return;
    setPickTarget(null);
    if (id === target.current) return;
    view.dispatch({
      changes: { from: target.from, to: target.to, insert: id },
    });
  };

  /**
   * Where the picker goes. The host clips its overflow, so the
   * position is clamped into it: below the click, or above it when
   * the click was near the bottom edge.
   */
  const pickerPosition = (target: InstrumentPickTarget): { left: string; top: string } => {
    const host = containerRef;
    const width = host?.clientWidth ?? 0;
    const height = host?.clientHeight ?? 0;
    const pickerWidth = 200;
    const pickerHeight = 44;
    const left = Math.max(8, Math.min(target.x - 20, width - pickerWidth - 8));
    const below = target.y + 16;
    const top = below + pickerHeight > height
      ? Math.max(8, target.y - pickerHeight - 8)
      : below;
    return { left: `${left}px`, top: `${top}px` };
  };

  return (
    <div
      ref={containerRef}
      class="cm-host cm-host-fill"
      style={{
        border: '1px solid var(--border)',
        'border-radius': '4px',
        overflow: 'hidden',
      }}
    >
      <Show when={pickTarget()}>
        {(target) => (
          <div
            class="cm-instrument-picker"
            style={pickerPosition(target())}
            role="dialog"
            aria-label="Выберите инструмент"
          >
            <select
              class="cm-instrument-picker__select"
              value={target().current}
              onChange={(e) => { applyInstrument(e.currentTarget.value); }}
            >
              <option value={target().current}>{target().current}</option>
              <optgroup label="Мелодические">
                <For each={MELODIC_SOUNDS}>
                  {(sound) => <option value={sound.id}>{sound.label}</option>}
                </For>
              </optgroup>
              <optgroup label="Ударные">
                <For each={DRUM_SOUNDS}>
                  {(sound) => <option value={sound.id}>{sound.label}</option>}
                </For>
              </optgroup>
              <option value={DRUMS_ONLY_ID}>Только барабаны</option>
            </select>
          </div>
        )}
      </Show>
    </div>
  );
}
