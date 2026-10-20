import { createSignal } from 'solid-js';

/**
 * UI-настройки: выбор модели + thinking toggle.
 * Persistence — localStorage (это UI-state, не доменный, в IDB не нужно).
 */

export type Model = 'smart' | 'fast';
export type Thinking = 'low' | 'high' | 'off';

/**
 * Single source of truth for what each tier actually means.
 *
 * The tier (`smart` / `fast`) is what goes on the wire — `LiveLLMClient`
 * posts it verbatim as `model` and the proxy routes it. The human
 * label and the one-line rationale live here so there is exactly one
 * place to edit when the proxy's routing changes.
 *
 * Previously `M2.1` was hardcoded twice in `LLMSettingsPopover` (once in
 * the option table, once in the button-label function) and linked to the
 * upstream model id only by a comment in `LiveLLMClient`. Nothing
 * enforced the link, so re-pointing `fast` at a different model would
 * have left the UI advertising a model it no longer used.
 */
export type ModelTier = {
  readonly value: Model;
  /** Short label for the collapsed button, e.g. `M2.1`. */
  readonly label: string;
  /** Upstream model the proxy is configured to route this tier to. */
  readonly routesTo: string;
  /** One-line tradeoff shown in the popover. */
  readonly hint: string;
};

export const MODEL_TIERS: ReadonlyArray<ModelTier> = [
  { value: 'smart', label: 'M3', routesTo: 'MiniMax-M3', hint: 'умнее, медленнее' },
  { value: 'fast', label: 'M2.1', routesTo: 'MiniMax-M2.1-highspeed', hint: 'быстрее, проще' },
];

export const modelTier = (value: Model): ModelTier =>
  MODEL_TIERS.find((t) => t.value === value) ?? MODEL_TIERS[1]!;

/** Collapsed-button rendering: `M2.1 · low`. */
export const modelLabel = (value: Model): string => modelTier(value).label;
export const thinkingLabel = (t: Thinking): string => (t === 'low' ? 'low' : t === 'high' ? 'high' : 'off');

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
