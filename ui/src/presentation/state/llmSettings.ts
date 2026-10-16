import { createSignal } from 'solid-js';

/**
 * UI-настройки: выбор модели + thinking toggle.
 * Persistence — localStorage (это UI-state, не доменный, в IDB не нужно).
 */

export type Model = 'smart' | 'fast';
export type Thinking = 'low' | 'high' | 'off';

type LLMSettings = {
  readonly model: Model;
  readonly thinking: Thinking;
};

const KEY = 'wavecode-llm-settings-v1';

const defaults: LLMSettings = {
  // 2026-10-16: default flipped smart → fast. На типовых applyEdit в wavecode
  // (правки mini-notation, 1-2K tokens) fast с thinking=disabled даёт
  // ~1.0-1.5s end-to-end с готовым ответом, тогда как smart (deepseek-v4-pro)
  // даже с budget_tokens лимитами убегает в 3-21s reasoning на полный
  // max_tokens budget и приходит с finish_reason='length', content=''.
  // Юзер может переключиться на smart в UI для задач, где важнее качество
  // рассуждений (coding, debugging), но дефолт = fast.
  model: 'fast',
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
