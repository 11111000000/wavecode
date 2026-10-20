import { Show, createSignal, onMount, onCleanup, For, type JSX } from 'solid-js';
import { MOBILE_MODES, type MobileMode } from '~/presentation/state/uiState';
import {
  SaveIcon, TrashIcon, ResetIcon, PhoneIcon, WrenchIcon, DotsVIcon, PencilIcon,
} from '~/presentation/icons';

export type OverflowMenuProps = {
  presetId: string;
  mobileMode: MobileMode;
  chooseMobileMode: (m: MobileMode) => void;
  onSavePreset: () => void;
  onDeletePreset: () => void;
  onRenamePreset: () => void;
  onResetAll: () => void;
  onOpenAdmin: () => void;
};

/**
 * OverflowMenu — кнопка `⋯` в TopBar; popover с группами:
 *   - user actions: Save preset, Delete preset (custom), Mobile mode
 *   - separator
 *   - admin actions: Open admin 🔧, Reset all
 *
 * Backdrop-close, Esc-close, click-outside-close.
 * Mobile (<640px) — full-width bottom sheet; desktop — anchored popover.
 */
export function OverflowMenu(props: OverflowMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!open()) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.wc-overflow-menu')) return;
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

  const close = (): void => { setOpen(false); };

  return (
    <div class="wc-overflow-menu">
      <button
        type="button"
        class="wc-icon-btn"
        data-tone="ghost"
        onClick={() => setOpen(!open())}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label="Ещё"
        title="Ещё"
      >
        <DotsVIcon size={18} />
      </button>
      <Show when={open()}>
        <div class="wc-overflow-menu__panel" role="menu">
          <button
            type="button"
            class="wc-overflow-item"
            role="menuitem"
            onClick={() => { props.onSavePreset(); close(); }}
          >
            <SaveIcon size={14} />
            <span>Сохранить пресет</span>
          </button>

          <Show when={props.presetId.startsWith('custom-')}>
            <button
              type="button"
              class="wc-overflow-item"
              role="menuitem"
              onClick={() => { close(); props.onRenamePreset(); }}
            >
              <PencilIcon size={14} />
              <span>Переименовать пресет</span>
            </button>
            <button
              type="button"
              class="wc-overflow-item"
              role="menuitem"
              onClick={() => { props.onDeletePreset(); close(); }}
            >
              <TrashIcon size={14} />
              <span>Удалить пресет</span>
            </button>
          </Show>

          <div class="wc-overflow-submenu" role="group" aria-label="Мобильный режим">
            <span class="wc-overflow-submenu__label">
              <PhoneIcon size={12} />
              <span>Мобильный режим</span>
            </span>
            <For each={MOBILE_MODES}>
              {(opt) => (
                <button
                  type="button"
                  class={`wc-overflow-item wc-overflow-item--nested ${props.mobileMode === opt.value ? 'is-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={props.mobileMode === opt.value}
                  title={opt.hint}
                  onClick={() => { props.chooseMobileMode(opt.value); close(); }}
                >
                  <span class="wc-overflow-item__mark">{props.mobileMode === opt.value ? '●' : '○'}</span>
                  <span class="wc-overflow-mobile">
                    <span class="wc-overflow-mobile__label">{opt.label}</span>
                    {/* Without this the three options are indistinguishable
                        until you pick one and navigate away to see the
                        effect — `auto` is especially opaque. */}
                    <span class="wc-overflow-mobile__hint">{opt.hint}</span>
                  </span>
                </button>
              )}
            </For>
          </div>

          <div class="wc-overflow-sep" role="separator" />

          <button
            type="button"
            class="wc-overflow-item"
            role="menuitem"
            onClick={() => { props.onOpenAdmin(); close(); }}
          >
            <WrenchIcon size={14} />
            <span>Открыть админку</span>
          </button>
          <button
            type="button"
            class="wc-overflow-item wc-overflow-item--danger"
            role="menuitem"
            onClick={() => { props.onResetAll(); close(); }}
          >
            <ResetIcon size={14} />
            <span>Сбросить всё</span>
          </button>
        </div>
      </Show>
    </div>
  );
}