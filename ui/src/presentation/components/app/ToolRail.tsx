import { For, type JSX } from 'solid-js';
import { TIER1_TOOLS, isToolActive } from '~/presentation/state/toolRegistry';
import { openKindSheet } from '~/presentation/state/uiState';
import { ToolsIcon } from '~/presentation/icons';

/**
 * ToolRail — постоянная навигация из трёх инструментов.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 9): вместо восьми вкладок
 * нижней панели — пункты рельса и один лист «Инструменты» на всё
 * остальное. На десктопе рельс вертикальный слева, на мобиле —
 * нижний ряд: те же пункты, те же подписи, тот же порядок.
 *
 * wavecode-unified-input-entry: «Ввод» ушёл из рельса в tier 2.
 * Рядом с «ИИ» он читался как второй способ получить музыку, хотя
 * это разные категории: ИИ — адресат, Ввод — способ захвата. Теперь
 * в рельсе три пункта (Нотная, Шаги, ИИ), а ввод открывает круглая
 * кнопка «Ввод».
 *
 * Кнопка «Инструменты» внизу рельса — единственная точка входа в
 * лист со всем остальным; на мобиле она остаётся в верхней панели
 * (см. TopBar), чтобы нижний ряд оставался трёхпунктным.
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
    </nav>
  );
}
