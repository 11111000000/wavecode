import { Show } from 'solid-js';
import { HelloPanel } from './presentation/panels/HelloPanel';
import { ScorePanel } from './presentation/panels/ScorePanel';
import { ReplPanel } from './presentation/panels/ReplPanel';
import { uiState, toggleRepl, toggleStatus, installKeyboardShortcuts } from './presentation/state/uiState';

function CollapsibleHeader(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  hint: string;
  ariaLabel: string;
}) {
  return (
    <header class="panel-header" onClick={props.onToggle}>
      <span class="collapse-toggle" aria-expanded={props.open} aria-label={props.ariaLabel}>
        <span class="caret">{props.open ? '▾' : '▸'}</span>
        <h2>{props.title}</h2>
        <span class="panel-hint">{props.hint}</span>
      </span>
    </header>
  );
}

export function App() {
  installKeyboardShortcuts({
    focusRepl: () => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-repl-textarea]');
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
          <kbd>Ctrl</kbd>+<kbd>.</kbd> REPL · <kbd>Ctrl</kbd>+<kbd>↵</kbd> eval
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

        <section class="repl-panel collapsible" data-open={uiState().replOpen}>
          <CollapsibleHeader
            title="REPL"
            open={uiState().replOpen}
            onToggle={toggleRepl}
            hint="Ctrl+. · Ctrl+↵"
            ariaLabel="REPL panel"
          />
          <Show when={uiState().replOpen}>
            <ReplPanel />
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
    </main>
  );
}