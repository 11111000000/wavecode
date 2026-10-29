import { createSignal } from 'solid-js';
import type { Preset } from '~/domain/presets';
import { BUILTIN_PRESETS } from '~/domain/presets';

/**
 * Custom (user-saved) пресеты. Хранятся в localStorage.
 * Built-in пресеты — в BUILTIN_PRESETS (read-only).
 */

const KEY = 'wavecode-custom-presets-v1';

/**
 * Default name used when `onNew` creates a fresh composition without
 * asking the user for a name up-front (см. decisions/fix-new-
 * composition-flow.yaml). A unique "Новая композиция N" suffix is
 * appended if the bare name is already taken.
 */
export const NEW_COMPOSITION_DEFAULT_NAME = 'Новая композиция';

const load = (): Preset[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Preset[];
    // Migration: drop custom presets whose name shadows a built-in.
    // Typical case: user loaded old version of a built-in, hit "💾 Save"
    // and saved as custom — now their stale code shadows the updated
    // built-in in the dropdown and confuses the user.
    const builtInNames = new Set(
      BUILTIN_PRESETS.map((p) => p.name.toLowerCase().trim())
    );
    const filtered = parsed.filter(
      (p) => !p.custom || !builtInNames.has((p.name ?? '').toLowerCase().trim())
    );
    if (filtered.length !== parsed.length) {
      try {
        localStorage.setItem(KEY, JSON.stringify(filtered));
      } catch {
        /* ignore */
      }
    }
    return filtered.filter((p) => p.id && p.score && p.name);
  } catch {
    return [];
  }
};

const save = (presets: Preset[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
};

const [customPresets, setCustomPresets] = createSignal<Preset[]>(load());

export const allPresets = (): Preset[] => [...BUILTIN_PRESETS, ...customPresets()];

export const getPreset = (id: string): Preset | undefined =>
  allPresets().find((p) => p.id === id);

/**
 * Возвращает "Новая композиция" или "Новая композиция N", где N —
 * первый незанятый суффикс. Case-insensitive — 'НОВАЯ КОМПОЗИЦИЯ 2'
 * коллизит с 'Новая Композиция 2'. Достаточно для UI, где имена
 * пресетов — свободный текст.
 */
const findUniqueDefaultName = (): string => {
  const taken = new Set(allPresets().map((p) => p.name.toLowerCase().trim()));
  const base = NEW_COMPOSITION_DEFAULT_NAME.toLowerCase();
  if (!taken.has(base)) return NEW_COMPOSITION_DEFAULT_NAME;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${NEW_COMPOSITION_DEFAULT_NAME} ${n}`;
};

/**
 * Создаёт custom-пресет с автогенерированным именем (см.
 * `findUniqueDefaultName`). Используется `useRouteGuards.onNew`,
 * чтобы клик "Новая" создавал ИМЕНОВАННУЮ композицию, которая
 * отображается в дропдауне и персистится как любой custom-пресет
 * — раньше onNew подменял активный пресет на 'creep' и терял
 * состояние "юзер начал новую композицию" после релоада
 * (см. decisions/fix-new-composition-flow.yaml).
 */
export const addCustomPreset = (score: string): Preset => {
  const name = findUniqueDefaultName();
  return saveCustomPreset(name, score);
};

export const saveCustomPreset = (name: string, score: string): Preset => {
  const id = `custom-${Date.now().toString(36)}`;
  const preset: Preset = { id, name: name.trim() || 'Без названия', score, custom: true };
  const next = [...customPresets(), preset];
  setCustomPresets(next);
  save(next);
  return preset;
};

/**
 * Переименование custom-пресета. No-op если:
 *   - id не найден,
 *   - id ссылается на builtin (защита от UI-багов; rename в UI
 *     рендерится только для custom-*),
 *   - новое имя пустое или совпадает с текущим.
 *
 * Возвращает `true` если запись произошла (UI-стороне можно
 * закрыть промпт/инпут без повторного confirm).
 */
export const renameCustomPreset = (id: string, newName: string): boolean => {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  const target = customPresets().find((p) => p.id === id);
  if (!target) return false;
  if (target.name === trimmed) return true;
  const next = customPresets().map((p) =>
    p.id === id ? { ...p, name: trimmed } : p,
  );
  setCustomPresets(next);
  save(next);
  return true;
};

export const deleteCustomPreset = (id: string): void => {
  const next = customPresets().filter((p) => p.id !== id);
  setCustomPresets(next);
  save(next);
};

export const resetAllBrowserData = (): void => {
  try {
    localStorage.removeItem('wavecode-ui-state-v1');
    localStorage.removeItem('wavecode-llm-settings-v1');
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  setCustomPresets([]);
};
