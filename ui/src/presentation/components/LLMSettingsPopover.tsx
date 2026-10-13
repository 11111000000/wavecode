import { Show, For, createSignal, onMount, onCleanup, type JSX } from 'solid-js';
import { getLLMSettings, setModel, setThinking, type Model, type Thinking } from '~/presentation/state/llmSettings';
import { SettingsIcon } from '~/presentation/icons';

const MODEL_OPTIONS: ReadonlyArray<{ value: Model; label: string; hint: string }> = [
  { value: 'smart', label: 'M3', hint: 'умнее, медленнее' },
  { value: 'fast', label: 'M2.1', hint: 'быстрее, проще' },
];

const THINKING_OPTIONS: ReadonlyArray<{ value: Thinking; label: string }> = [
  { value: 'low', label: 'мало' },
  { value: 'high', label: 'много' },
  { value: 'off', label: 'выкл' },
];

const modelLabel = (m: Model): string => m === 'smart' ? 'M3' : 'M2.1';
const thinkingLabel = (t: Thinking): string => t === 'low' ? 'low' : t === 'high' ? 'high' : 'off';

/**
 * LLMSettingsPopover — кнопка `⚙ M3 · high` + popover с выбором
 * модели и thinking. Используется в AIEditPanel footer.
 *
 * На кнопке — текущие настройки одной строкой, в popover — две `<select>`.
 * Backdrop-close, Esc-close.
 */
export function LLMSettingsPopover(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [settings, setSettings] = createSignal(getLLMSettings());

  const refresh = (): void => { setSettings(getLLMSettings()); };

  onMount(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!open()) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.wc-llm-popover-wrap')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (open() && e.key === 'Escape') {
        setOpen(false);
        e.preventDefault();
      }
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    });
  });

  const onModelChange = (e: Event & { currentTarget: HTMLSelectElement }): void => {
    setModel(e.currentTarget.value as Model);
    refresh();
  };
  const onThinkingChange = (e: Event & { currentTarget: HTMLSelectElement }): void => {
    setThinking(e.currentTarget.value as Thinking);
    refresh();
  };

  return (
    <div class="wc-llm-popover-wrap">
      <button
        type="button"
        class="wc-llm-settings-btn"
        onClick={() => setOpen(!open())}
        aria-haspopup="dialog"
        aria-expanded={open()}
        title="Настройки ИИ: модель и размышление"
      >
        <SettingsIcon size={14} />
        <span>{modelLabel(settings().model)}</span>
        <span class="wc-llm-settings-btn__sep">·</span>
        <span>{thinkingLabel(settings().thinking)}</span>
      </button>
      <Show when={open()}>
        <div class="wc-llm-popover" role="dialog" aria-label="Настройки ИИ">
          <label class="wc-llm-popover__field">
            <span class="wc-llm-popover__label">Модель</span>
            <select class="llm-select" value={settings().model} onChange={onModelChange}>
              <For each={MODEL_OPTIONS}>
                {(o) => <option value={o.value}>{o.label} — {o.hint}</option>}
              </For>
            </select>
          </label>
          <label class="wc-llm-popover__field">
            <span class="wc-llm-popover__label">Размышление</span>
            <select class="llm-select" value={settings().thinking} onChange={onThinkingChange}>
              <For each={THINKING_OPTIONS}>
                {(o) => <option value={o.value}>{o.label}</option>}
              </For>
            </select>
          </label>
          <p class="wc-llm-popover__hint">
            Настройки сохраняются в localStorage и применяются ко всем
            последующим запросам.
          </p>
        </div>
      </Show>
    </div>
  );
}