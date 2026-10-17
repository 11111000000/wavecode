import { type JSX } from 'solid-js';
import type { MobileMode } from '~/presentation/state/uiState';
import { getSampleStatus } from '~/presentation/state/uiState';
import { TabBar } from '~/presentation/components/TabBar';
import { Toast } from '~/presentation/components/Toast';
import { ConsoleSheet } from '~/presentation/components/ConsoleSheet';
import { TopBar } from '~/presentation/components/app/TopBar';
import { TransportBar } from '~/presentation/components/TransportBar';
import { PanelsLayout } from '~/presentation/components/app/PanelsLayout';

type CtxState = { state: string; sampleRate: number | null };

export type AppShellViewProps = {
  readonly audioRunning: () => boolean;
  readonly audioStarting: () => boolean;
  readonly ctxState: () => CtxState;
  readonly presetId: () => string;
  readonly mobileMode: () => MobileMode;
  readonly showSavePreset: () => boolean;
  readonly newPresetName: () => string;
  readonly chooseMobileMode: (m: MobileMode) => void;
  readonly onSavePreset: () => void;
  readonly onRollback: () => void;
  readonly onRedo: () => void;
  readonly onNew: () => void;
  readonly onDeletePreset: () => void;
  readonly onResetAll: () => void;
  readonly onToggleLayout: () => void;
  readonly onOpenAdmin: () => void;
  readonly onLoadPreset: (id: string) => void;
  readonly onSetShowSavePreset: (v: boolean) => void;
  readonly onSetNewPresetName: (v: string) => void;
  readonly onSaveCustomPreset: () => void;
  readonly onPlay: () => void;
  readonly onStop: () => void;
};

export const AppShellView = (props: AppShellViewProps): JSX.Element => (
  <main class="app wc-app">
    <Toast />
    <TopBar
      audioRunning={props.audioRunning()}
      audioStarting={props.audioStarting()}
      ctxState={props.ctxState}
      presetId={props.presetId()}
      mobileMode={props.mobileMode()}
      sampleStatus={getSampleStatus()}
      chooseMobileMode={props.chooseMobileMode}
      onSavePreset={props.onSavePreset}
      onRollback={props.onRollback}
      onRedo={props.onRedo}
      onNew={props.onNew}
      onDeletePreset={props.onDeletePreset}
      onResetAll={props.onResetAll}
      onToggleLayout={props.onToggleLayout}
      onOpenAdmin={props.onOpenAdmin}
    />
    <TransportBar
      presetId={props.presetId()}
      showSavePreset={props.showSavePreset()}
      newPresetName={props.newPresetName()}
      audioRunning={props.audioRunning}
      audioStarting={props.audioStarting}
      onLoadPreset={props.onLoadPreset}
      onShowSavePreset={props.onSetShowSavePreset}
      onNewPresetName={props.onSetNewPresetName}
      onSavePreset={props.onSaveCustomPreset}
      onPlay={props.onPlay}
      onStop={props.onStop}
    />
    <PanelsLayout />
    <TabBar />
    <ConsoleSheet />
  </main>
);
