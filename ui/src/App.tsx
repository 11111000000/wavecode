import { Show, onMount, createEffect } from 'solid-js';
import { Effect } from 'effect';
import { HelloPanel } from './presentation/panels/HelloPanel';
import { ScorePanel } from './presentation/panels/ScorePanel';
import { AIEditPanel } from './presentation/panels/AIEditPanel';
import { DebugPanel } from './presentation/panels/DebugPanel';
import { uiState, toggleAI, toggleStatus, installKeyboardShortcuts } from './presentation/state/uiState';
import { appStore, dispatch } from './presentation/state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { ensureAudioLoaded } from '~/infrastructure/audio/LiveAudioEngine';

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
  // Eagerly bootstrap Strudel runtime so LLM-returned snippets work on first edit.
  onMount(() => {
    void ensureAudioLoaded();
    // Restore score from IDB on startup (debounced via promise).
    void Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* Repo;
        const saved = yield* repo.loadScore();
        if (saved) dispatch({ type: 'replaceScore', text: saved });
      }).pipe(Effect.provide(AppLayer)),
    );
  });

  // Autosave score on change (debounced).
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
        <span class="app-hints">
          <kbd>Ctrl</kbd>+<kbd>.</kbd> AI · <kbd>Ctrl</kbd>+<kbd>↵</kbd> eval
        </span>
      </header>
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
