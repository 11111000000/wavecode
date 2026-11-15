import { Show, type JSX } from 'solid-js';
import { uiState } from '~/presentation/state/uiState';
import { ScorePanel } from '~/presentation/panels/ScorePanel';
import { BottomSheets } from './BottomSheets';

export type PanelsLayoutProps = Record<string, never>;

/**
 * PanelsLayout — холст и то, что живёт слоями поверх него.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 9): ИИ больше не живёт
 * панелью рядом с партитурой (она занимала ~60 % ширины и забирала
 * внимание у холста). ИИ — это слой: на десктопе правый drawer
 * (`BottomSheet kind="ai"` → sheets.css, ≥1024px), на мобиле — лист.
 * Второй поверхности у ИИ больше нет.
 */
export function PanelsLayout(_: PanelsLayoutProps): JSX.Element {
  void _;
  return (
    <div class="app-body">
      <section class="score-panel">
        <Show when={uiState().scoreOpen}>
          <ScorePanel />
        </Show>
      </section>

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
