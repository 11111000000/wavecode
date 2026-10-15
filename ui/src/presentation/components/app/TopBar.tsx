import { Show, onCleanup, type JSX } from 'solid-js';
import { appStore } from '~/presentation/state/appStore';
import type { MobileMode } from '~/presentation/state/uiState';
import {
  UndoIcon, RedoIcon, NewIcon,
  LayoutSwapIcon, WavecodeLogo,
} from '~/presentation/icons';
import { ShareButton } from '~/presentation/components/ShareButton';
import { ConsoleButton } from '~/presentation/components/ConsoleButton';
import { OverflowMenu } from './OverflowMenu';

type CtxState = { state: string; sampleRate: number | null };

export type TopBarProps = {
  audioRunning: boolean;
  audioStarting: boolean;
  ctxState: () => CtxState;
  presetId: string;
  mobileMode: MobileMode;
  chooseMobileMode: (m: MobileMode) => void;
  onSavePreset: () => void;
  onRollback: () => void;
  onRedo: () => void;
  onNew: () => void;
  onDeletePreset: () => void;
  onResetAll: () => void;
  onToggleLayout: () => void;
  onOpenAdmin: () => void;
  sampleStatus: 'idle' | 'loading' | 'ready';
};

const LONG_PRESS_MS = 3000;

export function TopBar(props: TopBarProps): JSX.Element {
  let pressTimer: number | null = null;
  const startPress = (): void => {
    const onOpen = props.onOpenAdmin;
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      onOpen();
    }, LONG_PRESS_MS);
  };
  const cancelPress = (): void => {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  onCleanup(() => cancelPress());

  return (
    <header class="wc-topbar">
      <span
        class="wc-topbar__logo-btn"
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        title="Удерживайте 3 секунды для админки"
      >
        <WavecodeLogo size={22} />
      </span>
      <h1 class="wc-topbar__title">wavecode</h1>
      <Show when={props.sampleStatus === 'loading'}>
        <span class="audio-loading-pill" title="Sample banks loading…">♪ samples</span>
      </Show>
      <span class="wc-topbar__led" data-tone={props.audioRunning ? 'running' : 'idle'}>
        <span class="wc-led" data-tone={props.audioRunning ? 'running' : 'idle'}>
          {props.audioRunning ? `▶ ${props.ctxState().state}` : `● ${props.ctxState().state}`}
        </span>
      </span>
      <Show when={appStore.audio.lastError}>
        <a
          class="wc-admin-warn"
          href="#/admin"
          aria-label="Открыть админку: ошибка аудио"
          title="Аудио-ошибка — открыть админку"
        >
          ⚠
        </a>
      </Show>
      <div class="wc-topbar__actions">
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
          onClick={props.onRollback}
          disabled={(appStore.undoStacks[appStore.activeTrackId]?.length ?? 0) === 0}
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
          disabled={true} // redo not supported in dialog-sessions v1
          aria-label="Повторить"
          title="Повторить (Ctrl+Y)"
        >
          <RedoIcon size={18} />
        </button>
        <ShareButton />
        <ConsoleButton />
        <button
          type="button"
          class="wc-icon-btn"
          data-tone="ghost"
          onClick={props.onToggleLayout}
          aria-label="Переключить layout"
          aria-pressed={props.audioRunning}
          title="AI ↔ Код"
        >
          <LayoutSwapIcon size={18} />
        </button>
        <OverflowMenu
          presetId={props.presetId}
          mobileMode={props.mobileMode}
          chooseMobileMode={props.chooseMobileMode}
          onSavePreset={props.onSavePreset}
          onDeletePreset={props.onDeletePreset}
          onResetAll={props.onResetAll}
          onOpenAdmin={props.onOpenAdmin}
        />
      </div>
    </header>
  );
}