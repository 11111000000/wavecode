import { createSignal, For, Show, type JSX } from 'solid-js';
import { BottomSheet } from '~/presentation/components/BottomSheet';
import { searchTools, type ToolEntry } from '~/presentation/state/toolRegistry';
import { closeKindSheet } from '~/presentation/state/uiState';
import {
  canPinMore,
  isPinned,
  MAX_PINNED_TOOLS,
  togglePinned,
} from '~/presentation/state/pinnedTools';
import { PinIcon } from '~/presentation/icons';
import { PresetPicker } from './PresetPicker';

/**
 * ToolsSheet — лист, который решает две задачи: показать инструменты
 * и позволить оставить нужные в рельсе.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 9): tier 2 инструментов
 * больше не восемь вкладок внизу экрана, а сетка карточек в одном
 * листе с поиском. Глубина раскрытия остаётся ≤ 2: рельс → лист →
 * действие.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6): первым блоком листа идёт
 * выбор композиции — раньше он стоял в транспортной строке и делал
 * её втрое шире нужного. Строка транспорта теперь это ровно
 * «play · темп · позиция».
 *
 * wavecode-pinned-tools: лист перестал быть вторым списком рельса.
 *
 *   Что было
 *   --------
 *   В листе были ВСЕ инструменты — девять карточек, из которых
 *   первые три (Нотная, Шаги, ИИ) — ровно те же, что висели в рельсе
 *   в тридцати сантиметрах левее. Подпись листа гласила «всё, что не
 *   в рельсе» — и была неправдой: пользователь видел один и тот же
 *   список дважды и не мог понять, где «настоящий».
 *
 *   Что стало
 *   ---------
 *   В листе — только то, чего в рельсе нет: инструменты tier 2. Базовые
 *   пункты рельса в листе не повторяются (они всегда под рукой), и
 *   подпись теперь правдива: «что закрепить в рельсе».
 *
 *   На каждой карточке — булавка. Она отвечает на вопрос, который
 *   пользователь задавал сам: «как оставить то, чем я пользуюсь
 *   часто, на виду». Нажатая булавка добавляет инструмент в рельс;
 *   инструмент остаётся в листе и там же снимается.
 *
 *   «Ввод» в листе остаётся — иначе поиск по «микрофон» или «свист»
 *   отвечал бы «Ничего не найдено», хотя лист ввода существует. Но
 *   закрепить его нельзя: у него есть собственная круглая кнопка, а
 *   вторая точка входа в тот же лист вернула бы ровно то
 *   дублирование, которое здесь убирается.
 */
export function ToolsSheet(): JSX.Element {
  const [query, setQuery] = createSignal('');

  /**
   * Что показывает лист.
   *
   * Без запроса — только tier 2: то, чего в рельсе нет. Базовые
   * пункты рельса здесь не повторяются: список «всё, что не в
   * рельсе» иначе снова солгал бы.
   *
   * С запросом — все совпадения, включая базовые. Иначе поиск в
   * листе стал бы хуже палитры команд: на «нотная» он отвечал бы
   * «Ничего не найдено», хотя «Нотная» стоит в рельсе в одном
   * касании. Найденный базовый инструмент показывается с
   * заблокированной булавкой — он уже в рельсе.
   */
  const results = (): readonly ToolEntry[] => {
    const q = query().trim();
    if (!q) return searchTools('').filter((t) => t.tier === 2);
    return searchTools(q);
  };

  const openTool = (tool: ToolEntry): void => {
    closeKindSheet('tools');
    tool.open();
  };

  /**
   * Почему булавка может быть недоступна.
   *
   * Три разных случая, и каждый должен быть объяснён, а не молча
   * проигнорирован:
   *   - инструмент уже в рельсе (найден поиском по базовому);
   *   - инструмент закреплять не нужно («Ввод» — у него своя кнопка);
   *   - лимит закреплений выбран.
   *
   * Причина не повторяет имя инструмента: имя добавляется к ней
   * отдельно, в подписи булавки. Иначе заблокированная булавка теряла
   * бы имя — и в листе с девятью карточек четыре булавки звучали бы
   * одинаково.
   */
  const pinReason = (tool: ToolEntry): string | null => {
    if (isPinned(tool.id)) return null;
    if (tool.tier === 1) return 'уже в рельсе';
    if (tool.pinnable === false) {
      return tool.pinNote ?? 'закреплять не нужно';
    }
    if (!canPinMore()) {
      return `закрепить можно не больше ${MAX_PINNED_TOOLS} — снимите один из закреплённых`;
    }
    return null;
  };

  /**
   * Подпись булавки — всегда с именем инструмента.
   *
   * Три состояния:
   *   - закреплено  → «Убрать „X“ из рельса»;
   *   - заблокировано → «„X“ — <причина>»;
   *   - доступно    → «Закрепить „X“ в рельсе».
   */
  const pinLabel = (tool: ToolEntry): string => {
    if (isPinned(tool.id)) return `Убрать «${tool.label}» из рельса`;
    const reason = pinReason(tool);
    if (reason) return `«${tool.label}» — ${reason}`;
    return `Закрепить «${tool.label}» в рельсе`;
  };

  return (
    <BottomSheet kind="tools" title="Инструменты" subtitle="что закрепить в рельсе">
      <div class="wc-tools-sheet">
        <PresetPicker />
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
              {(tool) => {
                const reason = (): string | null => pinReason(tool);
                return (
                  <li class="wc-tool-cell">
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
                    <button
                      type="button"
                      class="wc-tool-card__pin"
                      data-on={isPinned(tool.id) ? 'true' : 'false'}
                      data-locked={reason() ? 'true' : 'false'}
                      aria-pressed={isPinned(tool.id)}
                      aria-disabled={reason() ? 'true' : 'false'}
                      aria-label={pinLabel(tool)}
                      title={pinLabel(tool)}
                      onClick={() => {
                        if (reason()) return;
                        togglePinned(tool.id);
                      }}
                    >
                      <PinIcon size={14} />
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>
    </BottomSheet>
  );
}
