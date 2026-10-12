import { Show, For, onMount, onCleanup, type JSX } from 'solid-js';
import { appStore } from '~/presentation/state/appStore';
import type { MobileMode } from '~/presentation/state/uiState';
import {
  UndoIcon, RedoIcon, NewIcon, SaveIcon, TrashIcon, ResetIcon, PhoneIcon,
  BrandLogo,
} from '~/presentation/icons';
import { ShareButton } from '~/presentation/components/ShareButton';

type CtxState = { state: string; sampleRate: number | null };

export type TopBarProps = {
  audioRunning: boolean;
  ctxState: () => CtxState;
  presetId: string;
  mobileMode: MobileMode;
  showMobileMenu: boolean;
  chooseMobileMode: (m: MobileMode) => void;
  setShowMobileMenu: (v: boolean) => void;
  onSavePreset: () => void;
  onRollback: () => void;
  onRedo: () => void;
  onNew: () => void;
  onDeletePreset: () => void;
  onResetAll: () => void;
};

export function TopBar(props: TopBarProps): JSX.Element {
  onMount(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!props.showMobileMenu) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.mobile-menu-wrap')) return;
      props.setShowMobileMenu(false);
    };
    document.addEventListener('click', onDocClick);
    onCleanup(() => document.removeEventListener('click', onDocClick));
  });

  return (
    <header class="wc-topbar">
      <BrandLogo size={22} />
      <h1 class="wc-topbar__title">wavecode</h1>
      <span class="wc-topbar__led" data-tone={props.audioRunning ? 'running' : 'idle'}>
        <span class="wc-led" data-tone={props.audioRunning ? 'running' : 'idle'}>
          {props.audioRunning ? `▶ ${props.ctxState().state}` : `● ${props.ctxState().state}`}
        </span>
      </span>
      <div class="wc-topbar__actions">
        <button
          type="button"
          class="wc-icon-btn"
          data-tone="ghost"
          onClick={props.onRollback}
          disabled={appStore.history.length === 0}
          aria-label="Отменить"
          title="Отменить (Ctrl+Z)"
        >
          <UndoIcon size={18} />
        </button>
        <button
          type="button"
          class="wc-icon-btn"
          data-tone="ghost"
          onClick={props.onRedo}
          disabled={appStore.future.length === 0}
          aria-label="Повторить"
          title="Повторить (Ctrl+Y)"
        >
          <RedoIcon size={18} />
        </button>
        <button
          type="button"
          class="wc-icon-btn"
          data-tone="ghost"
          onClick={props.onNew}
          aria-label="Новая"
          title="Новая композиция"
        >
          <NewIcon size={18} />
        </button>
        <button
          type="button"
          class="wc-icon-btn"
          data-tone="ghost"
          onClick={props.onSavePreset}
          aria-label="Сохранить"
          title="Сохранить как пресет"
        >
          <SaveIcon size={18} />
        </button>
        <ShareButton />
        <div class="mobile-menu-wrap">
          <button
            type="button"
            class="wc-icon-btn"
            data-tone="ghost"
            onClick={() => props.setShowMobileMenu(!props.showMobileMenu)}
            aria-label="Мобильный режим"
            aria-haspopup="true"
            aria-expanded={props.showMobileMenu}
          >
            <PhoneIcon size={18} />
          </button>
          <Show when={props.showMobileMenu}>
            <div class="mobile-menu" role="menu">
              <For each={(['auto', 'compact', 'full'] as const)}>
                {(mode) => (
                  <button
                    type="button"
                    class={`mobile-menu-item${props.mobileMode === mode ? ' is-active' : ''}`}
                    onClick={() => props.chooseMobileMode(mode)}
                    role="menuitemradio"
                    aria-checked={props.mobileMode === mode}
                  >
                    <span class="mobile-menu-mark">{props.mobileMode === mode ? '●' : '○'}</span>
                    <span>
                      {mode === 'auto' ? 'Авто' : mode === 'compact' ? 'Компактно' : 'Полно'}
                    </span>
                    <span class="mobile-menu-hint">
                      {mode === 'auto' ? 'по ширине' : mode === 'compact' ? 'только партитура' : 'все 3 панели'}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <Show when={props.presetId.startsWith('custom-')}>
          <button
            type="button"
            class="wc-icon-btn"
            data-tone="ghost"
            onClick={props.onDeletePreset}
            aria-label="Удалить пресет"
          >
            <TrashIcon size={18} />
          </button>
        </Show>
        <button
          type="button"
          class="wc-icon-btn"
          data-tone="ghost"
          onClick={props.onResetAll}
          aria-label="Сбросить всё"
        >
          <ResetIcon size={18} />
        </button>
      </div>
    </header>
  );
}
