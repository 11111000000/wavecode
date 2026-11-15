import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { searchTools, type ToolEntry } from '~/presentation/state/toolRegistry';

/**
 * CommandPalette — весь список инструментов по ⌘K / Ctrl+K.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 9): третий уровень
 * доступа для тех, кто умеет печатать. Палитра не добавляет кнопок —
 * она показывает то же, что и рельс и лист «Инструменты», но за
 * два нажатия клавиатуры и без прокрутки.
 */
const isPaletteOpen = (): boolean => document.body.getAttribute('data-palette-open') === 'true';

export function CommandPalette(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const results = (): readonly ToolEntry[] => searchTools(query());

  const close = (): void => {
    setOpen(false);
    setQuery('');
    setActive(0);
    document.body.removeAttribute('data-palette-open');
  };

  const show = (): void => {
    setOpen(true);
    document.body.setAttribute('data-palette-open', 'true');
    window.setTimeout(() => inputRef?.focus(), 0);
  };

  const choose = (tool: ToolEntry): void => {
    close();
    tool.open();
  };

  const onGlobalKey = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isPaletteOpen()) close();
      else show();
      return;
    }
    if (e.key === 'Escape' && open()) {
      e.preventDefault();
      close();
    }
  };

  const onInputKey = (e: KeyboardEvent): void => {
    const list = results();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (list.length === 0 ? 0 : (i + 1) % list.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (list.length === 0 ? 0 : (i - 1 + list.length) % list.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const tool = list[active()];
      if (tool) choose(tool);
    }
  };

  onMount(() => {
    document.addEventListener('keydown', onGlobalKey);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', onGlobalKey);
    document.body.removeAttribute('data-palette-open');
  });

  return (
    <Show when={open()}>
      <div class="wc-palette" role="dialog" aria-modal="true" aria-label="Палитра команд">
        <div class="wc-palette__backdrop" onClick={close} aria-hidden="true" />
        <div class="wc-palette__panel">
          <input
            ref={inputRef}
            type="text"
            class="wc-palette__input"
            placeholder="Инструмент…"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            autocomplete="off"
            aria-label="Поиск инструмента"
            aria-controls="wc-palette-list"
          />
          <ul class="wc-palette__list" id="wc-palette-list" role="listbox">
            <For each={results()}>
              {(tool, i) => (
                <li role="option" aria-selected={i() === active()}>
                  <button
                    type="button"
                    class="wc-palette__item"
                    data-active={i() === active() ? 'true' : 'false'}
                    onMouseEnter={() => setActive(i())}
                    onClick={() => choose(tool)}
                  >
                    <span class="wc-palette__icon" aria-hidden="true">
                      <tool.icon size={18} />
                    </span>
                    <span class="wc-palette__label">{tool.label}</span>
                    <span class="wc-palette__desc">{tool.description}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </Show>
  );
}
