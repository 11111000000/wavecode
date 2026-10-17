import { createSignal, createEffect, onMount, Show, untrack, type JSX } from 'solid-js';
import { setTab, getActiveTab, getLayout, setLayout, setMobileMode, getMobileMode, type MobileMode } from './presentation/state/uiState';
import { appStore, dispatch } from './presentation/state/appStore';
import { installTypingTracker } from './presentation/state/editorTypingTracker';
import { evalScore, stopAudio } from './presentation/state/audioActions';
import { isGridEmptyState } from './presentation/state/gridState';
import { syncGridFromScore } from './presentation/components/StepGrid';
import { getPreset, saveCustomPreset, deleteCustomPreset } from './presentation/state/presetsStore';
import { getSelectedPresetId, setSelectedPresetPersist } from './presentation/state/selectedPreset';
import { useBootstrap } from './presentation/state/useBootstrap';
import { useKeyboardShortcuts } from './presentation/state/useKeyboardShortcuts';
import { useAudioStartIndicator } from './presentation/state/useAudioStartIndicator';
import { useRouteGuards } from './presentation/state/useRouteGuards';
import { useHashRoute, openAdmin } from './presentation/state/useHashRoute';
import { installConsoleGlobals } from './presentation/components/consoleGlobals';
import { AppShellView } from './presentation/components/app/AppShellView';
import { Admin } from './presentation/pages/Admin';
import { Landing } from './presentation/components/landing/Landing';

export function App(): JSX.Element {
  const route = useHashRoute();
  return (<>
    <Show when={route() === 'landing'}><Landing /></Show>
    <Show when={route() === 'app'}><AppShell /></Show>
    <Show when={route() === 'admin'}><Admin /></Show>
  </>);
}

function AppShell(): JSX.Element {
  const audio = useBootstrap();
  const [audioStarting, setAudioStarting] = useAudioStartIndicator(audio.ctxState);
  const { onNew, onResetAll } = useRouteGuards();
  const [showSavePreset, setShowSavePreset] = createSignal(false);
  const [newPresetName, setNewPresetName] = createSignal('');
  const [mobileMode, setMobileModeSignal] = createSignal<MobileMode>(getMobileMode());
  const presetId = getSelectedPresetId;

  const undo = (): void => { void stopAudio(); dispatch({ type: 'undoScore' }); };
  const redo = (): void => { void stopAudio(); dispatch({ type: 'redoScore' }); };

  const onDeletePreset = (): void => {
    const id = presetId();
    if (!id.startsWith('custom-')) return;
    deleteCustomPreset(id);
    setSelectedPresetPersist('creep');
    const fallback = getPreset('creep');
    if (fallback) dispatch({ type: 'replaceScore', text: fallback.score });
  };
  const onToggleLayout = (): void => { setLayout(getLayout() === 'ai-primary' ? 'code-primary' : 'ai-primary'); };
  const chooseMobileMode = (m: MobileMode): void => { setMobileMode(m); setMobileModeSignal(m); };
  const onLoadPreset = (id: string): void => {
    const preset = getPreset(id);
    if (!preset) return;
    setSelectedPresetPersist(id);
    dispatch({ type: 'switchPreset', id });
    dispatch({ type: 'replaceScore', text: preset.score });
    void evalScore();
  };
  const onSaveCustomPreset = (): void => {
    const name = newPresetName().trim();
    if (!name) return;
    const preset = saveCustomPreset(name, appStore.score);
    setSelectedPresetPersist(preset.id);
    dispatch({ type: 'switchPreset', id: preset.id });
    setShowSavePreset(false);
    setNewPresetName('');
  };

  useKeyboardShortcuts({
    focusAI: () => { setTab('chat'); window.setTimeout(() => { document.querySelector<HTMLTextAreaElement>('[data-ai-textarea]')?.focus(); }, 200); },
    focusScore: () => { setTab('score'); window.setTimeout(() => { document.querySelector<HTMLElement>('.cm-content')?.focus(); }, 100); },
    undoScore: undo, redoScore: redo, openAdmin,
  });

  onMount(() => {
    installTypingTracker(dispatch);
    installConsoleGlobals();
  });

  createEffect(() => {
    if (getActiveTab() === 'step' && untrack(isGridEmptyState)) {
      syncGridFromScore();
    }
  });

  return (
    <AppShellView
      audioRunning={audio.audioRunning} audioStarting={audioStarting} ctxState={audio.ctxState}
      presetId={presetId} mobileMode={mobileMode} showSavePreset={showSavePreset} newPresetName={newPresetName}
      chooseMobileMode={chooseMobileMode} onSavePreset={() => setShowSavePreset((v) => !v)}
      onRollback={undo} onRedo={redo} onNew={onNew}
      onDeletePreset={onDeletePreset} onResetAll={onResetAll} onToggleLayout={onToggleLayout} onOpenAdmin={openAdmin}
      onLoadPreset={onLoadPreset} onSetShowSavePreset={setShowSavePreset} onSetNewPresetName={setNewPresetName}
      onSaveCustomPreset={onSaveCustomPreset}
      onPlay={() => { setAudioStarting(true); void evalScore(); }} onStop={() => { void stopAudio(); }}
    />
  );
}
