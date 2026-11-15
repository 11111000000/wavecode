import { For, type JSX } from 'solid-js';
import { TIER1_TOOLS, isToolActive } from '~/presentation/state/toolRegistry';
import { openKindSheet } from '~/presentation/state/uiState';
import { ToolsIcon } from '~/presentation/icons';
import { SampleProgressBadge } from '~/presentation/components/SampleProgressBadge';

/**
 * ToolRail — постоянная навигация из четырёх инструментов.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 9): вместо восьми вкладок
 * нижней панели — четыре пункта рельса (Нотная, Шаги, ИИ, Ввод) и
 * один лист «Инструменты» на всё остальное. На десктопе рельс
 * вертикальный слева, на мобиле — нижний ряд: те же четыре пункта,
 * те же подписи, тот же порядок.
 *
 * Кнопка «Инструменты» внизу рельса — единственная точка входа в
 * лист со всем остальным; на мобиле она остаётся в верхней панели
 * (см. TopBar), чтобы нижний ряд оставался четырёхпунктным.
 */
export function ToolRail(): JSX.Element {
  return (
    <nav class="wc-rail" aria-label="Основные инструменты">
      <div class="wc-rail__items">
        <For each={TIER1_TOOLS}>
          {(tool) => (
            <button
              type="button"
              class="wc-rail__item"
              data-active={isToolActive(tool.id) ? 'true' : 'false'}
              onClick={() => tool.open()}
              aria-label={tool.label}
              aria-pressed={isToolActive(tool.id)}
              title={tool.description}
            >
              <tool.icon size={20} />
              <span class="wc-rail__label">{tool.short}</span>
            </button>
          )}
        </For>
      </div>
      <button
        type="button"
        class="wc-rail__more"
        onClick={() => openKindSheet('tools', 'half')}
        aria-label="Инструменты"
        title="Инструменты (⌘K)"
      >
        <ToolsIcon size={20} />
        <span class="wc-rail__label">Ещё</span>
      </button>
      <SampleProgressBadge />
    </nav>
  );
}
