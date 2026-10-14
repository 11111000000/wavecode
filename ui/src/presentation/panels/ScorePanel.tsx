import {
  Show,
  Suspense,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
} from 'solid-js';
import { appStore, dispatch } from '../state/appStore';
import { getDebug } from '~/infrastructure/audio/LiveAudioEngine';
import { CodeMirrorEditor, type CodeMirrorEditorApi } from '../components/CodeMirrorEditor';
import { TranspileButton } from '../components/TranspileButton';
import { MiniNotationToolbar } from '../components/MiniNotationToolbar';
import { PianoKeyboard } from '../components/PianoKeyboard';
import {
  setEditorFocused,
  setPianoEditorApi,
} from '../state/pianoRecStore';
import {
  getKindSnap,
  hasOpenSheet,
  snapTo,
  type SheetKind,
} from '../state/uiState';

/**
 * Score panel — редактор + debug-info + mini-notation toolbar +
 * (опционально на desktop) inline-пианино под collapsible header'ом.
 *
 * Piano behavior split:
 *   - Desktop (≥1024px) → inline `<PianoKeyboard variant="inline" />`
 *     renders ABOVE the editor when the `▼ Piano` header is expanded.
 *     Default = collapsed (one thin button) so the editor gets full
 *     width; user expands explicitly to record. Collapsed state is
 *     persisted in `wavecode-piano-collapse-v1` localStorage.
 *   - Mobile (<1024px) → no inline piano here; BottomSheet-piano
 *     (rendered from app/BottomSheets.tsx) takes over. The BottomSheet
 *     is gated by the same viewport breakpoint.
 *
 * Editor wiring:
 *   - `editorApi` is captured in `onReady` and used by MiniNotationToolbar
 *     (cursor inserts via `dispatchInsertSnippet`) and by the
 *     pianoRecStore at-cursor slot (insert at the editor cursor).
 *   - focus/blur listeners on `view.contentDOM` drive the
 *     `editorFocused` signal — the `⌖ cursor` slot button stays
 *     disabled until the user actually taps into the editor.
 *
 * <Suspense> wrapper is for lazy CodeMirrorEditor — first open
 * downloads the chunk (~400KB); until then we show a placeholder so
 * the panel doesn't collapse to zero height.
 */

const PIANO_COLLAPSE_KEY = 'wavecode-piano-collapse-v1';
const MINI_TOOLBAR_KEY = 'wavecode-mini-toolbar-v1';
const DESKTOP_QUERY = '(min-width: 1024px)';

const readStoredCollapsed = (): boolean => {
  try {
    const v = localStorage.getItem(PIANO_COLLAPSE_KEY);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch {
    /* localStorage unavailable (e.g. SSR / private mode) */
  }
  return true;
};

const writeStoredCollapsed = (v: boolean): void => {
  try {
    localStorage.setItem(PIANO_COLLAPSE_KEY, String(v));
  } catch {
    /* localStorage unavailable — silently no-op */
  }
};

/**
 * wavecode-toast-overhead-and-toolbar-toggle: на mobile snippet
 * toolbar (14 кнопок × 2 ряда = ~110px) ест 12% viewport'а и
 * сжимает cm-host до 1-2 видимых строк. Default = скрыт на
 * mobile, открыт на desktop. localStorage override.
 */
const readMiniToolbarOpen = (defaultOpen: boolean): boolean => {
  try {
    const v = localStorage.getItem(MINI_TOOLBAR_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* localStorage unavailable — silently use default */
  }
  return defaultOpen;
};

const writeMiniToolbarOpen = (v: boolean): void => {
  try {
    localStorage.setItem(MINI_TOOLBAR_KEY, String(v));
  } catch {
    /* localStorage unavailable — silently no-op */
  }
};

const readDesktopMatch = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(DESKTOP_QUERY).matches;
};

export function ScorePanel() {
  const [debug, setDebug] = createSignal(getDebug());
  const [pianoCollapsed, setPianoCollapsed] = createSignal(true);
  const [isDesktop, setIsDesktop] = createSignal(readDesktopMatch());
  // wavecode-toast-overhead-and-toolbar-toggle: mobile default = closed,
  // desktop default = open. localStorage wins.
  const [miniToolbarOpen, setMiniToolbarOpen] = createSignal(
    readMiniToolbarOpen(readDesktopMatch()),
  );
  let editorApi: CodeMirrorEditorApi | undefined;

  const pollId = window.setInterval(() => setDebug(getDebug()), 500);
  onCleanup(() => window.clearInterval(pollId));

  // Restore persisted collapse state + listen for viewport changes.
  onMount(() => {
    setPianoCollapsed(readStoredCollapsed());
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent): void => {
      const wasDesktop = isDesktop();
      setIsDesktop(e.matches);
      // Cross-breakpoint: re-init mini-toolbar default if localStorage
      // didn't pin a value. Keeps "mobile=closed, desktop=open" until
      // user explicitly toggles.
      if (wasDesktop !== e.matches) {
        const stored = localStorage.getItem(MINI_TOOLBAR_KEY);
        if (stored !== 'true' && stored !== 'false') {
          setMiniToolbarOpen(e.matches);
        }
      }
    };
    mql.addEventListener('change', onChange);
    onCleanup(() => mql.removeEventListener('change', onChange));
  });

  const toggleMiniToolbar = (): void => {
    const next = !miniToolbarOpen();
    setMiniToolbarOpen(next);
    writeMiniToolbarOpen(next);
  };

  // Wire the editor API + focus state into pianoRecStore. Re-runs if
  // `editorApi` is reassigned (lazy CodeMirror chunk finishes loading),
  // so the listeners always point at the current EditorView.
  createEffect(() => {
    const api = editorApi;
    if (!api) {
      setPianoEditorApi(undefined);
      setEditorFocused(false);
      return;
    }
    setPianoEditorApi(api);
    const view = api.getView();
    if (!view) {
      setEditorFocused(false);
      return;
    }
    const dom = view.contentDOM;
    const onFocus = (): void => {
      setEditorFocused(true);
      // wavecode-mobile-split-pane polish (b): if a sheet is open at
      // 'full' (70vh) the editor is squeezed to ~200px — too small
      // for active editing. Auto-resize the sheet to 'half' (50vh)
      // so the user gets a comfortable editor without manually
      // dragging the handle.
      if (isDesktop()) return;
      if (!hasOpenSheet()) return;
      // Find the active full-snap sheet (any kind) and shrink it.
      const kinds: ReadonlyArray<NonNullable<SheetKind>> = [
        'ai', 'mixer', 'status', 'step', 'piano',
      ];
      for (const k of kinds) {
        if (getKindSnap(k) === 'full') {
          snapTo('half');
          break;
        }
      }
    };
    const onBlur = (): void => setEditorFocused(false);
    // Capture initial state — if the editor was already focused when
    // we attached, surface that.
    if (dom.contains(document.activeElement) && document.activeElement === dom) {
      setEditorFocused(true);
    }
    dom.addEventListener('focus', onFocus);
    dom.addEventListener('blur', onBlur);
    onCleanup(() => {
      dom.removeEventListener('focus', onFocus);
      dom.removeEventListener('blur', onBlur);
      setEditorFocused(false);
      setPianoEditorApi(undefined);
    });
  });

  const togglePiano = (): void => {
    const next = !pianoCollapsed();
    setPianoCollapsed(next);
    writeStoredCollapsed(next);
  };

  return (
    <div class="score-panel-inner">
      <Show when={appStore.score.trim().length === 0}>
        <div class="score-empty-state" role="note" aria-label="Подсказки для старта">
          <p>Нажми ▶ чтобы запустить шаблон</p>
          <p>Открой Piano → tap для звука</p>
          <p>Или напиши ИИ: "сделай бит"</p>
        </div>
      </Show>
      <Show when={isDesktop()}>
        <div class="score-piano-header">
          <button
            type="button"
            class="piano-toggle"
            data-collapsed={pianoCollapsed() ? 'true' : 'false'}
            aria-expanded={!pianoCollapsed()}
            aria-controls="score-piano-inline"
            aria-label={pianoCollapsed() ? 'Развернуть пианино' : 'Свернуть пианино'}
            onClick={togglePiano}
          >
            <span class="piano-toggle__caret" aria-hidden="true">
              {pianoCollapsed() ? '▶' : '▼'}
            </span>
            <span class="piano-toggle__label">Piano</span>
          </button>
        </div>
        <Show when={!pianoCollapsed()}>
          <div id="score-piano-inline" class="score-piano-inline">
            <PianoKeyboard variant="inline" />
          </div>
        </Show>
      </Show>
      <Suspense fallback={<div class="cm-host cm-host-fill cm-loading">загрузка редактора…</div>}>
        <div class="score-editor-row">
          <CodeMirrorEditor
            value={appStore.score}
            onChange={(v) => dispatch({ type: 'replaceScore', text: v })}
            onReady={(api) => {
              editorApi = api;
            }}
          />
          <TranspileButton />
        </div>
      </Suspense>

      <div class="score-debug">
        <span>триггеры: <strong>{debug().triggers}</strong></span>
        <span>cps: <strong>{debug().cps}</strong></span>
        <Show when={debug().replErr}>
          <span class="debug-err">repl: {debug().replErr}</span>
        </Show>
        <Show when={debug().lastEvalErr}>
          <span class="debug-err">eval: {debug().lastEvalErr}</span>
        </Show>
        <Show when={debug().superdoughErr}>
          <span class="debug-err">super: {debug().superdoughErr}</span>
        </Show>
        <button
          type="button"
          class="snippet-toggle"
          data-active={miniToolbarOpen() ? 'true' : 'false'}
          aria-label={miniToolbarOpen() ? 'Скрыть snippet-клавиатуру' : 'Показать snippet-клавиатуру'}
          aria-pressed={miniToolbarOpen()}
          onClick={toggleMiniToolbar}
          title={miniToolbarOpen() ? 'Скрыть клавиатуру снипов' : 'Показать клавиатуру снипов'}
        >
          ✎ snippet
        </button>
      </div>

      <Show when={miniToolbarOpen()}>
        <MiniNotationToolbar editor={() => editorApi} />
      </Show>
    </div>
  );
}