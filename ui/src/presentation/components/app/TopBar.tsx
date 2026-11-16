import { onCleanup, type JSX } from 'solid-js';
import { appStore } from '~/presentation/state/appStore';
import type { MobileMode } from '~/presentation/state/uiState';
import {
  UndoIcon, RedoIcon, NewIcon,
  WavecodeLogo,
} from '~/presentation/icons';
import { ShareButton } from '~/presentation/components/ShareButton';
import { ConsoleButton } from '~/presentation/components/ConsoleButton';
import { OverflowMenu } from './OverflowMenu';
import { StatusStrip } from './StatusStrip';

type CtxState = { state: string; sampleRate: number | null };

export type TopBarProps = {
  ctxState: () => CtxState;
  presetId: string;
  mobileMode: MobileMode;
  chooseMobileMode: (m: MobileMode) => void;
  onSavePreset: () => void;
  onRollback: () => void;
  onRedo: () => void;
  onNew: () => void;
  onDeletePreset: () => void;
  onRenamePreset: () => void;
  onResetAll: () => void;
  onToggleLayout: () => void;
  onOpenAdmin: () => void;
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
        title={
          import.meta.env.DEV
            ? 'Удерживайте 3 секунды для админки'
            : 'wavecode'
        }
      >
        <WavecodeLogo size={22} />
      </span>
      <h1 class="wc-topbar__title">wavecode</h1>
      {/* wavecode-zen-ui-phases-6-7 (фаза 6): состояние аудио,
          счётчик сэмплов и индикатор офлайна живут в ОДНОМ кластере
          (StatusStrip). Отдельная плашка «♪ samples» была мёртвым
          кодом — sampleStatus никогда не становился 'loading'. */}
      <StatusStrip ctxState={() => props.ctxState().state} />
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
        <ShareButton />
        <ConsoleButton />
        {/* wavecode-pinned-tools: кнопка «Инструменты» убрана из
            верхней панели. Она открывала тот же лист, что и «Ещё» в
            рельсе, — два входа в одну поверхность, и верхний был
            голой иконкой-сеткой без подписи: «кнопка, которая
            открывает непонятно что». Теперь вход один, он стоит в
            рельсе рядом с инструментами, которые этим листом
            управляются, и на мобиле он тоже внизу. */}
        <OverflowMenu
          presetId={props.presetId}
          mobileMode={props.mobileMode}
          chooseMobileMode={props.chooseMobileMode}
          onSavePreset={props.onSavePreset}
          onDeletePreset={props.onDeletePreset}
          onRenamePreset={props.onRenamePreset}
          onResetAll={props.onResetAll}
          onOpenAdmin={props.onOpenAdmin}
        />
      </div>
    </header>
  );
}