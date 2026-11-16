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
import { MiniNotationToolbar } from '../components/MiniNotationToolbar';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { Pianoroll } from '../components/Pianoroll';
import {
  setEditorFocused,
  setPianoEditorApi,
} from '../state/pianoRecStore';
import {
  setMicEditorApi,
  setMicEditorFocused,
} from '../state/micStore';
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
const SCORE_EXTRA_KEY = 'wavecode-score-extra-v1';
const SCORE_VIEW_KEY = 'wavecode-score-view-mode-v1';
const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * wavecode-pianoroll: ScorePanel can render either the CodeMirror
 * text editor (default) OR the Pianoroll timeline view (opt-in). The
 * choice persists via `SCORE_VIEW_KEY`. CM6 is the safe default — Code
 * is the source of truth; the pianoroll is a visualisation companion.
 */
type ScoreViewMode = 'text' | 'roll';
const readStoredView = (): ScoreViewMode => {
  try {
    const v = localStorage.getItem(SCORE_VIEW_KEY);
    if (v === 'roll') return 'roll';
    if (v === 'text') return 'text';
  } catch {
    /* localStorage unavailable */
  }
  return 'text';
};
const writeStoredView = (v: ScoreViewMode): void => {
  try {
    localStorage.setItem(SCORE_VIEW_KEY, v);
  } catch {
    /* localStorage unavailable — silently no-op */
  }
};

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
 * wavecode-zen-ui-phases-6-7 (фаза 6): под партитурой было три шумные
 * полосы — 14 кнопок мини-нотации, переключатель вида (text/roll) и
 * отладочная строка (триггеры / cps / ошибки). Теперь всё это живёт за
 * ОДНИМ раскрытием «⋯ Ещё», которое по умолчанию закрыто: в покое под
 * редактором пусто.
 */
const readExtraOpen = (): boolean => {
  try {
    const v = localStorage.getItem(SCORE_EXTRA_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* localStorage unavailable — silently use default */
  }
  return false;
};

const writeExtraOpen = (v: boolean): void => {
  try {
    localStorage.setItem(SCORE_EXTRA_KEY, String(v));
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
  // wavecode-pianoroll: text vs roll view toggle (default = text).
  const [viewMode, setViewMode] = createSignal<ScoreViewMode>(readStoredView());
  // wavecode-zen-ui-phases-6-7 (фаза 6): сниппеты, переключатель вида
  // и отладка — за одним раскрытием, по умолчанию закрытым.
  const [extraOpen, setExtraOpen] = createSignal(readExtraOpen());
  // editorApi — СИГНАЛ, а не обычная переменная: `createEffect` ниже
  // подписывается на него и переподключает слушатели фокуса, когда
  // ленивый чанк CodeMirror догружается. С обычной переменной эффект
  // отрабатывал один раз (api ещё undefined), слушатели фокуса не
  // вешались — и слот «⌖ курсор» в пианино оставался вечно
  // заблокированным, хотя подпись обещала «Тапните в редактор».
  const [editorApi, setEditorApi] = createSignal<CodeMirrorEditorApi | undefined>();

  const switchView = (next: ScoreViewMode): void => {
    if (viewMode() === next) return;
    setViewMode(next);
    writeStoredView(next);
  };

  const pollId = window.setInterval(() => setDebug(getDebug()), 500);
  onCleanup(() => window.clearInterval(pollId));

  // Restore persisted collapse state + listen for viewport changes.
  onMount(() => {
    setPianoCollapsed(readStoredCollapsed());
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent): void => {
      setIsDesktop(e.matches);
    };
    mql.addEventListener('change', onChange);
    onCleanup(() => mql.removeEventListener('change', onChange));
  });

  const toggleExtra = (): void => {
    const next = !extraOpen();
    setExtraOpen(next);
    writeExtraOpen(next);
  };

  // Wire the editor API + focus state into pianoRecStore. Re-runs if
  // `editorApi` is reassigned (lazy CodeMirror chunk finishes loading),
  // so the listeners always point at the current EditorView.
  createEffect(() => {
    const api = editorApi();
    if (!api) {
      setPianoEditorApi(undefined);
      setEditorFocused(false);
      setMicEditorApi(undefined);
      setMicEditorFocused(false);
      return;
    }
    setPianoEditorApi(api);
    setMicEditorApi(api);
    const view = api.getView();
    if (!view) {
      setEditorFocused(false);
      setMicEditorFocused(false);
      return;
    }
    const dom = view.contentDOM;
    const onFocus = (): void => {
      setEditorFocused(true);
      setMicEditorFocused(true);
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
    const onBlur = (): void => {
      setEditorFocused(false);
      setMicEditorFocused(false);
    };
    // Capture initial state — if the editor was already focused when
    // we attached, surface that.
    if (dom.contains(document.activeElement) && document.activeElement === dom) {
      setEditorFocused(true);
      setMicEditorFocused(true);
    }
    dom.addEventListener('focus', onFocus);
    dom.addEventListener('blur', onBlur);
    onCleanup(() => {
      dom.removeEventListener('focus', onFocus);
      dom.removeEventListener('blur', onBlur);
      setEditorFocused(false);
      setMicEditorFocused(false);
      setPianoEditorApi(undefined);
      setMicEditorApi(undefined);
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
          <p>Нажми ▶ — заиграет шаблон</p>
          <p>Речь, свист или ритм — по кнопке «Ввод»</p>
          <p>Пианино и микшер — в меню «Инструменты»</p>
          <p>Или напиши ИИ: «сделай бит»</p>
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
            <span class="piano-toggle__label">Пианино</span>
          </button>
        </div>
        <Show when={!pianoCollapsed()}>
          <div id="score-piano-inline" class="score-piano-inline">
            <PianoKeyboard variant="inline" />
          </div>
        </Show>
      </Show>
      <Suspense fallback={<div class="cm-host cm-host-fill cm-loading">загрузка редактора…</div>}>
        <Show when={viewMode() === 'text'}>
          <CodeMirrorEditor
            value={appStore.score}
            onChange={(v) => dispatch({ type: 'replaceScore', text: v })}
            onReady={(api) => {
              setEditorApi(api);
            }}
          />
        </Show>
        <Show when={viewMode() === 'roll'}>
          <div class="pianoroll-pane">
            <Pianoroll
              score={appStore.score}
              onChange={(v) => dispatch({ type: 'replaceScore', text: v })}
            />
          </div>
        </Show>
      </Suspense>

      <div class="score-extra">
        <button
          type="button"
          class="score-extra__toggle"
          data-testid="score-extra-toggle"
          data-active={extraOpen() ? 'true' : 'false'}
          aria-expanded={extraOpen()}
          aria-controls="score-extra-body"
          aria-label={
            extraOpen()
              ? 'Скрыть вид партитуры, мини-нотацию и отладку'
              : 'Показать вид партитуры, мини-нотацию и отладку'
          }
          onClick={toggleExtra}
          title={extraOpen() ? 'Скрыть' : 'Вид партитуры, мини-нотация и отладка'}
        >
          <span aria-hidden="true">⋯</span>
          {/* wavecode-pinned-tools: раньше тут тоже стояло «Ещё» — и на
              экране оказывалось два «Ещё»: в рельсе (инструменты) и
              здесь (вид партитуры, мини-нотация, отладка). Кнопка в
              рельсе остаётся «Ещё» — там это про инструменты; здесь
              «Подробнее» не путается с ней. */}
          <span class="score-extra__toggle-label">Подробнее</span>
        </button>

        <Show when={extraOpen()}>
          <div id="score-extra-body" class="score-extra__body" data-testid="score-extra-body">
            <div class="pianoroll-view-toggle" role="group" aria-label="Вид партитуры">
              <button
                type="button"
                class="pianoroll-view-toggle-btn"
                data-active={viewMode() === 'text' ? 'true' : 'false'}
                aria-pressed={viewMode() === 'text'}
                onClick={() => switchView('text')}
                title="Редактор кода — источник истины"
              >
                Код
              </button>
              <button
                type="button"
                class="pianoroll-view-toggle-btn"
                data-active={viewMode() === 'roll' ? 'true' : 'false'}
                aria-pressed={viewMode() === 'roll'}
                onClick={() => switchView('roll')}
                title="Лента нот — читать и править ноты визуально"
              >
                Ролл
              </button>
            </div>

            <MiniNotationToolbar editor={() => editorApi()} />

            <div class="score-debug">
              <span>триггеры: <strong>{debug().triggers}</strong></span>
              <span>темп: <strong>{debug().cps}</strong></span>
              <Show when={debug().replErr}>
                <span class="debug-err">repl: {debug().replErr}</span>
              </Show>
              <Show when={debug().lastEvalErr}>
                <span class="debug-err">eval: {debug().lastEvalErr}</span>
              </Show>
              <Show when={debug().superdoughErr}>
                <span class="debug-err">super: {debug().superdoughErr}</span>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}