import { createSignal } from 'solid-js';

/**
 * UI-настройки: выбор модели + thinking toggle.
 * Persistence — localStorage (это UI-state, не доменный, в IDB не нужно).
 */

type Model = 'smart' | 'fast';
type Thinking = 'low' | 'high' | 'off';

type LLMSettings = {
  model: Model;
  thinking: Thinking;
};

const KEY = 'wavecode-llm-settings-v1';

const defaults: LLMSettings = {
  model: 'smart',
  thinking: 'low',
};

const load = (): LLMSettings => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<LLMSettings>) };
  } catch {
    return defaults;
  }
};

const save = (s: LLMSettings): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
};

const [settings, setSettings] = createSignal<LLMSettings>(load());

export const getLLMSettings = (): LLMSettings => settings();

export const setModel = (model: Model): void => {
  const next = { ...settings(), model };
  setSettings(next);
  save(next);
};

export const setThinking = (thinking: Thinking): void => {
  const next = { ...settings(), thinking };
  setSettings(next);
  save(next);
};
