import { Show, type JSX } from 'solid-js';
import {
  uiState, toggleAI, toggleStatus, getActiveTab,
} from '~/presentation/state/uiState';
import { HelloPanel } from '~/presentation/panels/HelloPanel';
import { ScorePanel } from '~/presentation/panels/ScorePanel';
import { AIEditPanel } from '~/presentation/panels/AIEditPanel';
import { BottomSheets } from './BottomSheets';

function CollapsibleHeader(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  hint: string;
  ariaLabel: string;
}): JSX.Element {
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

export type PanelsLayoutProps = Record<string, never>;

export function PanelsLayout(_: PanelsLayoutProps): JSX.Element {
  void _;
  return (
    <div class="app-body">
      <section class="score-panel">
        <Show when={uiState().scoreOpen}>
          <ScorePanel />
        </Show>
      </section>

      <Show when={uiState().aiOpen && getActiveTab() === 'score'}>
        <section class="ai-panel collapsible" data-open="true">
          <CollapsibleHeader
            title="ИИ"
            open={uiState().aiOpen}
            onToggle={toggleAI}
            hint="Ctrl+. фокус · Ctrl+↵ отправить"
            ariaLabel="Панель ИИ"
          />
          <AIEditPanel />
        </section>
      </Show>

      <Show when={uiState().statusOpen && getActiveTab() === 'score'}>
        <aside class="status-panel collapsible" data-open="true">
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
      </Show>

      {/* wavecode-mobile-split-pane: BottomSheets live INSIDE
          .app-body so the mobile split-pane layout (column flex:
          ScorePanel + Sheet) takes effect via sheets.css @media
          (max-width: 720px). On desktop ≥1024px the sheets
          restore position:fixed / right-side drawer through CSS
          overrides in the same media-query block. */}
      <BottomSheets />
    </div>
  );
}
