import { createSignal, For, Show, type JSX } from 'solid-js';
import { BottomSheet } from '~/presentation/components/BottomSheet';
import { searchTools, type ToolEntry } from '~/presentation/state/toolRegistry';
import { closeKindSheet } from '~/presentation/state/uiState';

/**
 * ToolsSheet — один лист со всем, что не поместилось в рельс.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 9): tier 2 инструментов
 * больше не восемь вкладок внизу экрана, а сетка карточек в одном
 * листе с поиском. Глубина раскрытия остаётся ≤ 2: рельс → лист →
 * действие.
 *
 * Список не дублируется вручную: карточки строятся из реестра
 * инструментов (см. state/toolRegistry.ts).
 */
export function ToolsSheet(): JSX.Element {
  const [query, setQuery] = createSignal('');
  const results = (): readonly ToolEntry[] => searchTools(query());

  const openTool = (tool: ToolEntry): void => {
    closeKindSheet('tools');
    tool.open();
  };

  return (
    <BottomSheet kind="tools" title="Инструменты" subtitle="всё, что не в рельсе">
      <div class="wc-tools-sheet">
        <label class="wc-tools-sheet__search">
          <span class="wc-visually-hidden">Поиск инструмента</span>
          <input
            type="search"
            placeholder="Поиск инструмента…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            autocomplete="off"
          />
        </label>
        <Show
          when={results().length > 0}
          fallback={<p class="wc-tools-sheet__empty">Ничего не найдено</p>}
        >
          <ul class="wc-tools-sheet__grid">
            <For each={results()}>
              {(tool) => (
                <li>
                  <button
                    type="button"
                    class="wc-tool-card"
                    onClick={() => openTool(tool)}
                  >
                    <span class="wc-tool-card__icon" aria-hidden="true">
                      <tool.icon size={20} />
                    </span>
                    <span class="wc-tool-card__label">{tool.label}</span>
                    <span class="wc-tool-card__desc">{tool.description}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </BottomSheet>
  );
}
