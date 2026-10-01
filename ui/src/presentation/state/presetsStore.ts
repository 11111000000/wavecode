import { createSignal } from 'solid-js';
import type { Preset } from '~/domain/presets';
import { BUILTIN_PRESETS } from '~/domain/presets';

/**
 * Custom (user-saved) пресеты. Хранятся в localStorage.
 * Built-in пресеты — в BUILTIN_PRESETS (read-only).
 */

const KEY = 'wavecode-custom-presets-v1';

const load = (): Preset[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Preset[];
    return parsed.filter((p) => p.id && p.score && p.name);
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

export const saveCustomPreset = (name: string, score: string): Preset => {
  const id = `custom-${Date.now().toString(36)}`;
  const preset: Preset = { id, name: name.trim() || 'Без названия', score, custom: true };
  const next = [...customPresets(), preset];
  setCustomPresets(next);
  save(next);
  return preset;
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
