import { For, type JSX } from 'solid-js';
import { isToolActive } from '~/presentation/state/toolRegistry';
import { getRailTools } from '~/presentation/state/pinnedTools';
import { openKindSheet } from '~/presentation/state/uiState';
import { ToolsIcon } from '~/presentation/icons';

/**
 * ToolRail — постоянная навигация: базовые инструменты и то, что
 * пользователь закрепил.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 9): вместо восьми вкладок
 * нижней панели — пункты рельса и один лист «Инструменты» на всё
 * остальное. На десктопе рельс вертикальный слева, на мобиле —
 * нижний ряд: те же пункты, те же подписи, тот же порядок.
 *
 * wavecode-unified-input-entry: «Ввод» ушёл из рельса в tier 2.
 * Рядом с «ИИ» он читался как второй способ получить музыку, хотя
 * это разные категории: ИИ — адресат, Ввод — способ захвата. Теперь
 * в рельсе три базовых пункта (Нотная, Шаги, ИИ), а ввод открывает
 * круглая кнопка «Ввод».
 *
 * wavecode-pinned-tools: рельс стал не только списком, но и рабочим
 * набором. Кнопка «Инструменты» внизу рельса — единственная точка
 * входа в лист, где эти инструменты закрепляются: базовые пункты
 * живут в рельсе всегда, а часто используемые пользователь переносит
 * туда сам. Одна кнопка на весь интерфейс — на мобиле она тоже в
 * рельсе, а не в верхней панели: два входа в один лист читались как
 * «какая-то кнопка, которая открывает непонятно что».
 */
export function ToolRail(): JSX.Element {
  return (
    <nav class="wc-rail" aria-label="Основные инструменты">
      <div class="wc-rail__items">
        <For each={getRailTools()}>
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
