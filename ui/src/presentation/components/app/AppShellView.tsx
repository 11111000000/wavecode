import { type JSX } from 'solid-js';
import type { MobileMode } from '~/presentation/state/uiState';
import { ToolRail } from '~/presentation/components/app/ToolRail';
import { Toast } from '~/presentation/components/Toast';
import { ConsoleSheet } from '~/presentation/components/ConsoleSheet';
import { TopBar } from '~/presentation/components/app/TopBar';
import { TransportBar } from '~/presentation/components/TransportBar';
import { PanelsLayout } from '~/presentation/components/app/PanelsLayout';
import { CommandPalette } from '~/presentation/components/app/CommandPalette';

type CtxState = { state: string; sampleRate: number | null };

export type AppShellViewProps = {
  readonly audioRunning: () => boolean;
  readonly audioStarting: () => boolean;
  readonly ctxState: () => CtxState;
  readonly presetId: () => string;
  readonly mobileMode: () => MobileMode;
  readonly chooseMobileMode: (m: MobileMode) => void;
  readonly onSavePreset: () => void;
  readonly onRollback: () => void;
  readonly onRedo: () => void;
  readonly onNew: () => void;
  readonly onDeletePreset: () => void;
  readonly onRenamePreset: () => void;
  readonly onResetAll: () => void;
  readonly onToggleLayout: () => void;
  readonly onOpenAdmin: () => void;
  readonly onPlay: () => void;
  readonly onStop: () => void;
};

export const AppShellView = (props: AppShellViewProps): JSX.Element => (
  <main class="app wc-app">
    <Toast />
    <TopBar
      ctxState={props.ctxState}
      presetId={props.presetId()}
      mobileMode={props.mobileMode()}
      chooseMobileMode={props.chooseMobileMode}
      onSavePreset={props.onSavePreset}
      onRollback={props.onRollback}
      onRedo={props.onRedo}
      onNew={props.onNew}
      onDeletePreset={props.onDeletePreset}
      onRenamePreset={props.onRenamePreset}
      onResetAll={props.onResetAll}
      onToggleLayout={props.onToggleLayout}
      onOpenAdmin={props.onOpenAdmin}
    />
    <TransportBar
      audioRunning={props.audioRunning}
      audioStarting={props.audioStarting}
      onPlay={props.onPlay}
      onStop={props.onStop}
    />
    <PanelsLayout />
    <ToolRail />
    <ConsoleSheet />
    <CommandPalette />
  </main>
);
