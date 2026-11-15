import { EditorView } from '@codemirror/view';
import { For, createSignal, onCleanup, onMount } from 'solid-js';
import type { CodeMirrorEditorApi } from './CodeMirrorEditor';

export type Snippet = {
  readonly label: string;
  readonly insert: string;
  readonly ariaLabel: string;
};

export const SNIPPETS: ReadonlyArray<Snippet> = [
  { label: 'note(', insert: 'note(', ariaLabel: 'Вставить вызов note' },
  { label: 's(', insert: 's(', ariaLabel: 'Вставить вызов s' },
  { label: 'stack(', insert: 'stack(', ariaLabel: 'Вставить вызов stack' },
  { label: 'n(', insert: 'n(', ariaLabel: 'Вставить синтаксис n' },
  { label: '<', insert: '<', ariaLabel: 'Вставить начало медленной группы' },
  { label: '>', insert: '>', ariaLabel: 'Вставить конец медленной группы' },
  { label: '[', insert: '[', ariaLabel: 'Вставить открывающую скобку шага' },
  { label: ']', insert: ']', ariaLabel: 'Вставить закрывающую скобку шага' },
  { label: '*', insert: '*', ariaLabel: 'Вставить оператор повтора' },
  { label: '?', insert: '?', ariaLabel: 'Вставить оператор случайности' },
  { label: '.gain(', insert: '.gain(', ariaLabel: 'Вставить эффект gain' },
  { label: '.lpf(', insert: '.lpf(', ariaLabel: 'Вставить фильтр нижних частот' },
  { label: ',', insert: ',', ariaLabel: 'Вставить запятую' },
  { label: '␣', insert: ' ', ariaLabel: 'Вставить пробел' },
];

type Props = {
  readonly editor?: (() => CodeMirrorEditorApi | undefined) | undefined;
};

const VISUAL_VIEWPORT_VAR = '--visual-viewport-height';
const VKB_THRESHOLD_PX = 100;
const RESIZE_DEBOUNCE_MS = 100;

function readViewportState(): { height: number; vkbOpen: boolean } {
  const vv = window.visualViewport;
  if (!vv) return { height: window.innerHeight, vkbOpen: false };
  const vkbOpen = vv.height < window.innerHeight - VKB_THRESHOLD_PX;
  return { height: vv.height, vkbOpen };
}

/**
 * Pure-ish dispatch helper — extracted for unit testing.
 * Inserts snippet at the main selection, replacing any selected range,
 * and parks the cursor right after the inserted text.
 */
export function dispatchInsertSnippet(view: EditorView, snippet: string): void {
  const sel = view.state.selection.main;
  const anchor = sel.from + snippet.length;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: snippet },
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: 'nearest' }),
  });
}

export function MiniNotationToolbar(props: Props) {
  const [vkbOpen, setVkbOpen] = createSignal(false);

  function insertSnippet(snippet: string): void {
    const view = props.editor?.()?.getView();
    if (!view) return;
    dispatchInsertSnippet(view, snippet);
    view.focus();
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;

  const syncViewport = (): void => {
    const { height, vkbOpen: open } = readViewportState();
    setVkbOpen(open);
    document.documentElement.style.setProperty(VISUAL_VIEWPORT_VAR, `${height}px`);
  };

  const onResize = (): void => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncViewport, RESIZE_DEBOUNCE_MS);
  };

  onMount(() => {
    syncViewport();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
    }
    window.addEventListener('resize', onResize);
  });

  onCleanup(() => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onResize);
    }
    window.removeEventListener('resize', onResize);
  });

  return (
    <div
      class="mini-toolbar"
      role="toolbar"
      aria-label="Панель вставки мини-нотации Strudel"
      data-vkb-visible={vkbOpen() ? 'true' : 'false'}
    >
      <For each={SNIPPETS}>
        {(s) => (
          <button
            type="button"
            class="mini-toolbar-btn"
            aria-label={s.ariaLabel}
            onClick={() => insertSnippet(s.insert)}
          >
            {s.label}
          </button>
        )}
      </For>
    </div>
  );
}
