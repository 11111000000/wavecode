import { createSignal } from 'solid-js';
import { getPreset } from './presetsStore';

/**
 * Персистенция «выбранного пресета» в TransportBar.
 *
 * До появления этого модуля `presetId` жил локальным сигналом в
 * AppShell и инициализировался хардкодом `'creep'` (App.tsx:119).
 * useAppBootstrap гидрировал только `appStore.score` из IDB —
 * после релоада играла одна, в дропдауне светилась другая.
 *
 * Семантика «последний загруженный» (см. math/wavecode-preset-id-
 * hydration/packet.md):
 *  - сигнал отражает последний пресет, который юзер явно выбрал;
 *  - правки score НЕ сбрасывают сигнал (Ableton-style);
 *  - при гидрации валидируем: если пресет удалён → fallback на
 *    `'creep'` + persist; score-drift НЕ фолбэковый (правленый X
 *    остаётся легитимным «последний выбор был X»).
 *
 * localStorage ключ `wavecode-selected-preset-v1` — versioned,
 * миграция с предыдущих версий не нужна (раньше ключа не было).
 */

export const SELECTED_PRESET_KEY = 'wavecode-selected-preset-v1';

const DEFAULT_PRESET_ID = 'creep';

const readStored = (): string | null => {
  try {
    return window.localStorage.getItem(SELECTED_PRESET_KEY);
  } catch {
    return null;
  }
};

const writeStored = (id: string): void => {
  try {
    window.localStorage.setItem(SELECTED_PRESET_KEY, id);
  } catch {
    /* private mode / quota — ignore */
  }
};

const [selectedPresetId, setSelectedPresetIdRaw] = createSignal<string>(
  readStored() ?? DEFAULT_PRESET_ID,
);

export const getSelectedPresetId = (): string => selectedPresetId();

/**
 * Единственная точка записи: обновляет signal + localStorage.
 *
 * Запись всегда идёт (нет no-op оптимизации): localStorage.setItem —
 * дешёвая операция, а попытка срезать повторы ломает инвариант
 * «hydrate с пустым storage → default персистится» (signal уже = дефолт
 * после init, без write storage остался бы null).
 */
export const setSelectedPresetPersist = (id: string): void => {
  setSelectedPresetIdRaw(id);
  writeStored(id);
};

/**
 * Hydrate after the score has been restored from IDBRepo. Three branches:
 *
 *  (1) no stored value → fall back to default, persist once so
 *      subsequent reloads are consistent.
 *  (2) stored id exists in `allPresets()` → adopt it (works for both
 *      unchanged presets and edited-presets — both are legitimate
 *      «последний выбор был X»).
 *  (3) stored id does NOT exist (e.g. custom preset that was
 *      deleted) → fall back to default, persist (do not restore the
 *      dead id on every reload).
 *
 * Текущий `appStore.score` намеренно не сравнивается с preset.score
 * внутри этой функции — это семантика «правленый X» (см. packet).
 */
export const hydrateSelectedPreset = (): void => {
  const stored = readStored();
  if (stored === null) {
    setSelectedPresetPersist(DEFAULT_PRESET_ID);
    return;
  }
  if (getPreset(stored) !== undefined) {
    setSelectedPresetIdRaw(stored);
    return;
  }
  setSelectedPresetPersist(DEFAULT_PRESET_ID);
};

/**
 * Forcibly wipe the storage entry and reset the signal to the default.
 * Используется share-restore (shared snippet не несёт preset context)
 * и `resetAllBrowserData` чтобы после «Сбросить всё» в localStorage
 * не оставалось ни ключа, ни сигнала.
 */
export const resetSelectedPreset = (): void => {
  try {
    window.localStorage.removeItem(SELECTED_PRESET_KEY);
  } catch {
    /* ignore */
  }
  setSelectedPresetIdRaw(DEFAULT_PRESET_ID);
};