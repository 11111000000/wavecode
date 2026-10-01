import { Show, onMount, createEffect, createSignal, For, onCleanup } from 'solid-js';
import { Effect } from 'effect';
import { HelloPanel } from './presentation/panels/HelloPanel';
import { ScorePanel } from './presentation/panels/ScorePanel';
import { AIEditPanel } from './presentation/panels/AIEditPanel';
import { DebugPanel } from './presentation/panels/DebugPanel';
import { uiState, toggleAI, toggleStatus, installKeyboardShortcuts } from './presentation/state/uiState';
import { appStore, dispatch } from './presentation/state/appStore';
import { evalScore, stopAudio, beep } from './presentation/state/audioActions';
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
    void ensureAudioLoaded();
    void Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* Repo;
        const saved = yield* repo.loadScore();
        if (saved) dispatch({ type: 'replaceScore', text: saved });
      }).pipe(Effect.provide(AppLayer)),
    );
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

  installKeyboardShortcuts({
    focusAI: () => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-ai-textarea]');
      ta?.focus();
    },
    focusScore: () => {
      const cm = document.querySelector<HTMLElement>('.cm-content');
      cm?.focus();
    },
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
            onClick={() => setShowSavePreset((v) => !v)}
            title="Сохранить текущий score как новый пресет"
          >
            💾
          </button>
          <Show when={presetId().startsWith('custom-')}>
            <button
              type="button"
              class="preset-btn preset-btn-danger"
              onClick={onDeletePreset}
              title="Удалить custom пресет"
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
          <button type="button" class="ctrl-btn ctrl-btn-primary" onClick={() => void evalScore()}>▶ Eval</button>
          <button type="button" class="ctrl-btn" onClick={() => void stopAudio()}>■ Stop</button>
          <button type="button" class="ctrl-btn" onClick={() => beep(440)} title="440Hz">🔊 440</button>
          <button type="button" class="ctrl-btn" onClick={() => beep(220)} title="220Hz">🔊 220</button>
          <span class="ctx-state">
            ctx: <strong class={`status-${ctxState().state === 'running' ? 'playing' : 'idle'}`}>{ctxState().state}</strong>
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
        <section class="score-panel">
          <CollapsibleHeader
            title="Score"
            open={true}
            onToggle={() => {}}
            hint="(live edit)"
            ariaLabel="Score panel (always visible)"
          />
          <ScorePanel />
        </section>

        <section class="ai-panel collapsible" data-open={uiState().aiOpen}>
          <CollapsibleHeader
            title="AI"
            open={uiState().aiOpen}
            onToggle={toggleAI}
            hint="Ctrl+. · Ctrl+↵"
            ariaLabel="AI edit panel"
          />
          <Show when={uiState().aiOpen}>
            <AIEditPanel />
          </Show>
        </section>

        <aside class="status-panel collapsible" data-open={uiState().statusOpen}>
          <CollapsibleHeader
            title="Status"
            open={uiState().statusOpen}
            onToggle={toggleStatus}
            hint="Ctrl+Shift+S"
            ariaLabel="Status panel"
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
