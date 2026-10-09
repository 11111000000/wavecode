import { Show, onMount, createEffect, createSignal, For, onCleanup } from 'solid-js';
import { Effect } from 'effect';
import { HelloPanel } from './presentation/panels/HelloPanel';
import { ScorePanel } from './presentation/panels/ScorePanel';
import { AIEditPanel } from './presentation/panels/AIEditPanel';
import { DebugPanel } from './presentation/panels/DebugPanel';
import { TransportPanel } from './presentation/components/TransportPanel';
import { installTransportAudioSync } from './presentation/state/useTransportAudioSync';
import { uiState, toggleScore, toggleAI, toggleStatus, installKeyboardShortcuts } from './presentation/state/uiState';
import { appStore, dispatch } from './presentation/state/appStore';
import { installTypingTracker } from './presentation/state/editorTypingTracker';
import { evalScore, stopAudio, beep } from './presentation/state/audioActions';
import { RecordButton } from './presentation/components/RecordButton';
import { ShareButton } from './presentation/components/ShareButton';
import { shareState, setPendingShare, markIdbHasScore, startLoadingShared, finishLoadingShared } from './presentation/state/shareState';
import { decodeSnippet } from '~/domain/urlCodec';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import {
  ensureAudioLoaded,
  getAudioContextState,
} from '~/infrastructure/audio/LiveAudioEngine';
import {
  allPresets,
  getPreset,
  saveCustomPreset,
  deleteCustomPreset,
  resetAllBrowserData,
} from './presentation/state/presetsStore';

function CollapsibleHeader(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  hint: string;
  ariaLabel: string;
}) {
  return (
    <header class="panel-header" onClick={() => props.onToggle()}>
      <span class="collapse-toggle" aria-expanded={props.open} aria-label={props.ariaLabel}>
        <span class="caret">{props.open ? '▾' : '▸'}</span>
        <h2>{props.title}</h2>
        <span class="panel-hint">{props.hint}</span>
      </span>
    </header>
  );
}

export function App() {
  const [ctxState, setCtxState] = createSignal(getAudioContextState());
  const [presetId, setPresetId] = createSignal('creep');
  const [showSavePreset, setShowSavePreset] = createSignal(false);
  const [newPresetName, setNewPresetName] = createSignal('');

  const pollId = window.setInterval(() => setCtxState(getAudioContextState()), 500);
  onCleanup(() => window.clearInterval(pollId));

  onMount(() => {
    // Side-channel: cps signal → AudioEngine.setCps (debounced). Изолировано
    // от тестов transportState (там эта ф-ция не вызывается).
    installTransportAudioSync();

    // Lazy: подгружаем сохранённый score, но НЕ дёргаем Strudel.
    // Strudel (≈676KB / 216KB gzip — половина initial bundle) нужен только
    // для аудио, которое юзер запросит кнопкой «Запуск» / «440» / «Применить».
    // Без ensureAudioLoaded() initial бандл падает с ~415KB до ~200KB gzip.
    void Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* Repo;
        const saved = yield* repo.loadScore();
        if (saved) {
          // IDB выигрывает: локальная работа не перезаписывается автоматом.
          // Если при этом в URL был `?s=...` — оставляем pending для модалки
          // «Load shared snippet» (юзер сам решает, перезаписывать ли).
          dispatch({ type: 'replaceScore', text: saved });
          markIdbHasScore(true);
        } else {
          // IDB пуст — auto-apply pending share, если он был.
          const pending = shareState.pendingEncoded();
          if (pending) {
            const text = decodeSnippet(pending);
            if (text) {
              startLoadingShared();
              dispatch({ type: 'replaceScore', text });
              finishLoadingShared();
              setPendingShare(null);
            } else {
              setPendingShare(null);
            }
          }
        }
      }).pipe(Effect.provide(AppLayer)),
    );

    // Preload Strudel по первому user-gesture. Пока юзер просто смотрит
    // на партитуру — chunk не качается (важно для слабых сетей). Как только
    // юзер кликнул / нажал клавишу / ткнул в тач — стартуем фоном, чтобы
    // к моменту «Запуск» chunk уже был тёплый в кэше.
    let preloaded = false;
    const preload = () => {
      if (preloaded) return;
      preloaded = true;
      void ensureAudioLoaded();
      window.removeEventListener('pointerdown', preload, true);
      window.removeEventListener('keydown', preload, true);
    };
    window.addEventListener('pointerdown', preload, { capture: true, passive: true });
    window.addEventListener('keydown', preload, { capture: true, passive: true });
  });

  let saveTimer: number | undefined;
  createEffect(() => {
    const score = appStore.score;
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveScore(score);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });

  let saveMessagesTimer: number | undefined;
  createEffect(() => {
    const messages = appStore.messages;
    if (saveMessagesTimer !== undefined) window.clearTimeout(saveMessagesTimer);
    saveMessagesTimer = window.setTimeout(() => {
      // Глубокая копия: Solid-store proxy не сериализуется через
      // structured-clone (см. DataCloneError в IDB). JSON-roundtrip
      // снимает proxy-обёртки и оставляет plain-object массив.
      const plain = JSON.parse(JSON.stringify(messages));
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveMessages(plain);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });

  const loadPreset = (id: string): void => {
    const preset = getPreset(id);
    if (!preset) return;
    setPresetId(id);
    dispatch({ type: 'replaceScore', text: preset.score });
    // Auto-eval: заменяем score и сразу играем. Если уже играло — стоп
    // предыдущего цикла происходит внутри LiveAudioEngine.eval (repl.stop).
    void evalScore();
  };

  const onSavePreset = (): void => {
    const name = newPresetName().trim();
    if (!name) return;
    const preset = saveCustomPreset(name, appStore.score);
    setPresetId(preset.id);
    setShowSavePreset(false);
    setNewPresetName('');
  };

  const onDeletePreset = (): void => {
    const id = presetId();
    if (!id.startsWith('custom-')) return;
    deleteCustomPreset(id);
    setPresetId('creep');
    const fallback = getPreset('creep');
    if (fallback) dispatch({ type: 'replaceScore', text: fallback.score });
  };

  const onResetAll = (): void => {
    const ok = window.confirm('Сбросить ВСЕ настройки и очистить локальное хранилище?\n(localStorage + IDB score/messages)');
    if (!ok) return;
    resetAllBrowserData();
    void Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* Repo;
        yield* repo.saveScore('');
        yield* repo.saveMessages([]);
      }).pipe(Effect.provide(AppLayer)),
    ).then(() => window.location.reload());
  };

  const NEW_COMPOSITION_TEMPLATE = '// Начни новую композицию здесь\n';

  const onNewComposition = (): void => {
    const ok = window.confirm('Создать новую композицию?\nТекущая партитура и история диалога сбросятся.');
    if (!ok) return;
    void stopAudio();
    dispatch({ type: 'replaceScore', text: NEW_COMPOSITION_TEMPLATE });
    dispatch({ type: 'clearMessages' });
    setPresetId('creep');
  };

  const onRollback = (): void => {
    void stopAudio();
    dispatch({ type: 'undoScore' });
  };

  const onRedo = (): void => {
    void stopAudio();
    dispatch({ type: 'redoScore' });
  };

  installTypingTracker(dispatch);

  installKeyboardShortcuts({
    focusAI: () => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-ai-textarea]');
      ta?.focus();
    },
    focusScore: () => {
      const cm = document.querySelector<HTMLElement>('.cm-content');
      cm?.focus();
    },
    undoScore: onRollback,
    redoScore: onRedo,
  });

  return (
    <main class="app">
      <header class="app-header">
        <div class="app-title">
          <h1>wavecode</h1>
          <span class="app-subtitle">live-coding · AI · Strudel</span>
        </div>
        <div class="app-preset-row">
          <select
            class="preset-select"
            value={presetId()}
            onChange={(e) => loadPreset(e.currentTarget.value)}
            title="Готовые пресеты"
          >
            <optgroup label="Встроенные">
              <For each={allPresets().filter((p) => !p.custom)}>
                {(p) => <option value={p.id}>{p.name}{p.artist ? ` · ${p.artist}` : ''}</option>}
              </For>
            </optgroup>
            <Show when={allPresets().some((p) => p.custom)}>
              <optgroup label="Мои">
                <For each={allPresets().filter((p) => p.custom)}>
                  {(p) => <option value={p.id}>⭐ {p.name}</option>}
                </For>
              </optgroup>
            </Show>
          </select>
          <button
            type="button"
            class="preset-btn"
            onClick={onRollback}
            disabled={appStore.history.length === 0}
            title="Отменить последнюю правку (Ctrl+Z)"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            class="preset-btn"
            onClick={onRedo}
            disabled={appStore.future.length === 0}
            title="Повторить отменённую правку (Ctrl+Y)"
          >
            ↷ Redo
          </button>
          <button
            type="button"
            class="preset-btn preset-btn-new"
            onClick={onNewComposition}
            title="Создать новую композицию"
          >
            ✦ Новая
          </button>
          <button
            type="button"
            class="preset-btn"
            onClick={() => setShowSavePreset((v) => !v)}
            title="Сохранить партитуру как пресет"
          >
            💾
          </button>
          <ShareButton />
          <Show when={presetId().startsWith('custom-')}>
            <button
              type="button"
              class="preset-btn preset-btn-danger"
              onClick={onDeletePreset}
              title="Удалить пресет"
            >
              🗑
            </button>
          </Show>
          <button
            type="button"
            class="preset-btn preset-btn-danger"
            onClick={onResetAll}
            title="Сбросить всё"
          >
            🧹
          </button>
        </div>
        <div class="app-controls-row">
          <button type="button" class="ctrl-btn ctrl-btn-primary" onClick={() => void evalScore()}>▶ Запуск</button>
          <button type="button" class="ctrl-btn" onClick={() => void stopAudio()}>■ Стоп</button>
          <RecordButton />
          <button type="button" class="ctrl-btn" onClick={() => beep(440)} title="440 Гц">🔊 440</button>
          <button type="button" class="ctrl-btn" onClick={() => beep(220)} title="220 Гц">🔊 220</button>
          <TransportPanel />
          <span class="ctx-state">
            контекст: <strong class={`status-${ctxState().state === 'running' ? 'playing' : 'idle'}`}>{ctxState().state}</strong>
          </span>
        </div>
      </header>

      <Show when={showSavePreset()}>
        <div class="save-preset-bar">
          <input
            type="text"
            placeholder="Имя пресета"
            value={newPresetName()}
            onInput={(e) => setNewPresetName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSavePreset(); }}
            class="save-preset-input"
          />
          <button type="button" onClick={onSavePreset} disabled={!newPresetName().trim()}>OK</button>
          <button type="button" onClick={() => { setShowSavePreset(false); setNewPresetName(''); }}>Отмена</button>
        </div>
      </Show>

      <div class="app-body">
        <section class="score-panel collapsible" data-open={uiState().scoreOpen}>
          <CollapsibleHeader
            title="Партитура"
            open={uiState().scoreOpen}
            onToggle={toggleScore}
            hint="live-редактирование · Ctrl+Shift+E"
            ariaLabel="Панель партитуры"
          />
          <Show when={uiState().scoreOpen}>
            <ScorePanel />
          </Show>
        </section>

        <section class="ai-panel collapsible" data-open={uiState().aiOpen}>
          <CollapsibleHeader
            title="ИИ"
            open={uiState().aiOpen}
            onToggle={toggleAI}
            hint="Ctrl+. фокус · Ctrl+↵ отправить"
            ariaLabel="Панель ИИ"
          />
          <Show when={uiState().aiOpen}>
            <AIEditPanel />
          </Show>
        </section>

        <aside class="status-panel collapsible" data-open={uiState().statusOpen}>
          <CollapsibleHeader
            title="Состояние"
            open={uiState().statusOpen}
            onToggle={toggleStatus}
            hint="Ctrl+Shift+S"
            ariaLabel="Панель состояния"
          />
          <Show when={uiState().statusOpen}>
            <HelloPanel />
          </Show>
        </aside>
      </div>
      <DebugPanel />
    </main>
  );
}
