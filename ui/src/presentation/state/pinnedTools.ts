import { createSignal } from 'solid-js';
import { TOOLS, TIER1_TOOLS, type ToolEntry, type ToolId } from './toolRegistry';

/**
 * pinnedTools — какие инструменты пользователь закрепил в рельсе.
 *
 * wavecode-pinned-tools: после переноса «Ввода» в круглую кнопку
 * рельс остался с тремя пунктами, а остальные инструменты (Пианино,
 * Микшер, Визуализация, Экспорт, Консоль) спрятались за два клика:
 * «Ещё» → карточка. Пользователь, который каждый день открывает
 * микшер, вынужден повторять этот путь — и сам начал просить
 * «закрепить нужное внизу».
 *
 * Что здесь живёт
 * ---------------
 * Только идентификаторы закреплённых инструментов и их хранение.
 * Порядок и содержимое рельса собирает `getRailTools()`.
 *
 * Почему не в `toolRegistry.ts`
 * -----------------------------
 * Реестр — источник правды о том, КАКИЕ инструменты есть; закрепление —
 * про то, какими пользователь пользуется. Реестр не должен знать о
 * пользователе, а этот модуль — о конкретных инструментах: он
 * импортирует `TOOLS` для проверки «а существует ли такой id».
 * Обратной зависимости нет — иначе получился бы цикл импортов.
 *
 * Хранение — localStorage, тем же ключом-версией, что и остальные
 * пользовательские настройки (`wavecode-mobile-sheet-h-v1` и т.п.).
 * Инструменты — это не данные композиции: они не должны попадать в
 * IndexedDB и в общий экспорт.
 */

const STORAGE_KEY = 'wavecode-pinned-tools-v1';

/**
 * Сколько инструментов можно закрепить сверх трёх базовых.
 *
 * Рельс — это постоянная навигация, а не склад. На мобиле он занимает
 * один ряд в 60 px: семь-восемь пунктов в ряд уже не читаются, а
 * подписи («Нотная», «Визуализация») начинают обрезаться. Три
 * закреплённых — это «я часто работаю с микшером, пианино и
 * экспортом», и влезает без скролла.
 */
export const MAX_PINNED_TOOLS = 3;

const KNOWN_IDS: ReadonlySet<string> = new Set(TOOLS.map((t) => t.id));

/**
 * Инструмент можно закрепить?
 *
 * Правило одно и живёт в реестре: закрепляются только tier 2, кроме
 * тех, у кого `pinnable === false`. Здесь та же проверка нужна для
 * чтения хранилища — там может лежать что угодно, и рельс не должен
 * ни показать «Нотная» дважды, ни выпустить «Ввод» в закреплённые.
 */
const isPinnableTool = (id: ToolId): boolean => {
  const tool = TOOLS.find((t) => t.id === id);
  return tool !== undefined && tool.tier === 2 && tool.pinnable !== false;
};

const loadPinned = (): readonly ToolId[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<ToolId>();
    const ids: ToolId[] = [];
    for (const value of parsed) {
      if (typeof value !== 'string') continue;
      if (!KNOWN_IDS.has(value)) continue;
      const id = value as ToolId;
      if (seen.has(id)) continue;
      if (!isPinnableTool(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= MAX_PINNED_TOOLS) break;
    }
    return ids;
  } catch {
    /* localStorage недоступен или битые данные — начинаем с пустого рельса */
    return [];
  }
};

const [pinnedIds, setPinnedIds] = createSignal<readonly ToolId[]>(loadPinned());

const persist = (ids: readonly ToolId[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* localStorage недоступен — работаем без сохранения */
  }
};

/** Идентификаторы закреплённых инструментов, в порядке закрепления. */
export const getPinnedIds = (): readonly ToolId[] => pinnedIds();

/** Закреплён ли инструмент в рельсе. */
export const isPinned = (id: ToolId): boolean => pinnedIds().includes(id);

/** Можно ли ещё закрепить (или снять — снять можно всегда). */
export const canPinMore = (): boolean => pinnedIds().length < MAX_PINNED_TOOLS;

/**
 * Переключить закрепление.
 *
 * Базовые инструменты рельса (tier 1) закрепить нельзя: они в рельсе
 * уже всегда, и вторая копия была бы дублированием. Инструмент с
 * `pinnable: false` — тоже: у «Ввода» есть собственная постоянная
 * кнопка.
 */
export const togglePinned = (id: ToolId): void => {
  const current = pinnedIds();
  if (current.includes(id)) {
    const next = current.filter((x) => x !== id);
    setPinnedIds(next);
    persist(next);
    return;
  }
  if (!isPinnableTool(id)) return;
  if (current.length >= MAX_PINNED_TOOLS) return;
  const next = [...current, id];
  setPinnedIds(next);
  persist(next);
};

/** Снять все закрепления — вернуть рельс к трём базовым пунктам. */
export const resetPinnedTools = (): void => {
  setPinnedIds([]);
  persist([]);
};

/**
 * Содержимое рельса: базовые инструменты + закреплённые.
 *
 * Базовые идут первыми и всегда — закрепление дополняет навигацию,
 * а не переставляет её. Закреплённые идут в порядке закрепления:
 * чем позже закрепил, тем правее — так пользователь сам управляет
 * порядком, а «свежий» инструмент оказывается под рукой.
 */
export const getRailTools = (): readonly ToolEntry[] => {
  const pinned = pinnedIds()
    .map((id) => TOOLS.find((t) => t.id === id))
    .filter((t): t is ToolEntry => t !== undefined);
  return [...TIER1_TOOLS, ...pinned];
};
