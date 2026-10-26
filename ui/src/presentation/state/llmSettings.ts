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
  /** Short label for the collapsed button, e.g. `Flash`. */
  readonly label: string;
  /** Upstream model the proxy is configured to route this tier to. */
  readonly routesTo: string;
  /** One-line tradeoff shown in the popover. */
  readonly hint: string;
};

/**
 * 2026-10-26: прокси переключён с MiniMax на DeepSeek
 * (`smart` → deepseek-v4-pro, `fast` → deepseek-flash). Лейблы обновлены
 * вместе с маршрутизацией: до этого UI обещал «M3 / M2.1», а прокси
 * отдавал DeepSeek — то есть подпись врала.
 *
 * `routesTo` дублирует маршрутизацию llm-proxy (AngaraConfig,
 * services.llm-proxy.models) — это единственное место в UI, где видно,
 * что именно стоит за тиром. При следующей смене прокси правится здесь
 * и в `VITE_LLM_UPSTREAM` (ui/.env.example).
 */
export const MODEL_TIERS: ReadonlyArray<ModelTier> = [
  { value: 'smart', label: 'V4-Pro', routesTo: 'deepseek-v4-pro', hint: 'умнее, медленнее' },
  { value: 'fast', label: 'Flash', routesTo: 'deepseek-flash', hint: 'быстрее, проще' },
];

export const modelTier = (value: Model): ModelTier =>
  MODEL_TIERS.find((t) => t.value === value) ?? MODEL_TIERS[1]!;

/** Collapsed-button rendering: `Flash · low`. */
export const modelLabel = (value: Model): string => modelTier(value).label;
/**
 * 2026-10-26: у DeepSeek нет «выключить размышление» — effort=off
 * игнорируется провайдером (проверено: reasoning даже растёт). Поэтому
 * опция `off` подписана «min»: клиент отправляет минимальный доступный
 * уровень (`reasoning_effort=low`), а не обещает полное отключение.
 */
export const thinkingLabel = (t: Thinking): string => (t === 'low' ? 'low' : t === 'high' ? 'high' : 'min');

type LLMSettings = {
  readonly model: Model;
  readonly thinking: Thinking;
};

const KEY = 'wavecode-llm-settings-v1';

const defaults: LLMSettings = {
  // 2026-10-16: default flipped smart → fast. На типовых applyEdit в wavecode
  // (правки mini-notation, 1-2K tokens) fast отвечает быстрее, тогда как
  // smart (deepseek-v4-pro) убегает в длинное reasoning и приходит с
  // finish_reason='length', content=''.
  // 2026-10-26: после перехода прокси на DeepSeek замер через
  // llm.kosov.online: model=fast + extra_body.reasoning_effort=low →
  // 125 completion-токенов, 1.8 s (без effort было 1221 токенов, 7.9 s).
  // Дефолт = fast + low: быстрый ответ с приемлемым качеством.
  // Юзер может переключиться на smart для задач, где важнее качество
  // рассуждений (coding, debugging).
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
