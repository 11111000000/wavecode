import {
  createSignal, onMount, type JSX,
} from 'solid-js';
import { Effect } from 'effect';
import { DebugPanel } from './presentation/panels/DebugPanel';
import {
  installKeyboardShortcuts,
  setMobileMode,
  openKindSheet, closeKindSheet, setTab, getMobileMode,
  type MobileMode,
} from './presentation/state/uiState';
import { appStore, dispatch } from './presentation/state/appStore';
import { installTypingTracker } from './presentation/state/editorTypingTracker';
import { evalScore, stopAudio } from './presentation/state/audioActions';
import {
  getPreset, saveCustomPreset, deleteCustomPreset, resetAllBrowserData,
} from './presentation/state/presetsStore';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { useAppBootstrap } from './presentation/state/useAppBootstrap';
import { useAutoSave } from './presentation/state/useAutoSave';
import { TabBar } from './presentation/components/TabBar';
import { FAB } from './presentation/components/FAB';
import { TopBar } from './presentation/components/app/TopBar';
import { PresetRow } from './presentation/components/app/PresetRow';
import { PanelsLayout } from './presentation/components/app/PanelsLayout';
import { BottomSheets } from './presentation/components/app/BottomSheets';

const NEW_COMPOSITION_TEMPLATE = '// Начни новую композицию здесь\n';

const confirmReset = (): boolean => window.confirm(
  'Сбросить ВСЕ настройки и очистить локальное хранилище?\n(localStorage + IDB score/messages)',
);
const onResetAll = (): void => {
  if (!confirmReset()) return;
  resetAllBrowserData();
  void Effect.runPromise(
    Effect.gen(function* () {
      const repo = yield* Repo;
      yield* repo.saveScore('');
      yield* repo.saveMessages([]);
    }).pipe(Effect.provide(AppLayer)),
  ).then(() => window.location.reload());
};

const confirmNew = (): boolean => window.confirm(
  'Создать новую композицию?\nТекущая партитура и история диалога сбросятся.',
);

export function App(): JSX.Element {
  const audio = useAppBootstrap();
  useAutoSave();

  const [presetId, setPresetId] = createSignal('creep');
  const [showSavePreset, setShowSavePreset] = createSignal(false);
  const [showStepGrid, setShowStepGrid] = createSignal(false);
  const [showPiano, setShowPiano] = createSignal(false);
  const [mobileMode, setMobileModeSignal] = createSignal<MobileMode>(getMobileMode());
  const [showMobileMenu, setShowMobileMenu] = createSignal(false);
  const [newPresetName, setNewPresetName] = createSignal('');

  onMount(() => {
    installTypingTracker(dispatch);
    installKeyboardShortcuts({
      focusAI: () => {
        setTab('chat');
        window.setTimeout(() => {
          const ta = document.querySelector<HTMLTextAreaElement>('[data-ai-textarea]');
          ta?.focus();
        }, 200);
      },
      focusScore: () => {
        setTab('score');
        window.setTimeout(() => {
          const cm = document.querySelector<HTMLElement>('.cm-content');
          cm?.focus();
        }, 100);
      },
      undoScore: () => { void stopAudio(); dispatch({ type: 'undoScore' }); },
      redoScore: () => { void stopAudio(); dispatch({ type: 'redoScore' }); },
    });
  });

  const undo = (): void => { void stopAudio(); dispatch({ type: 'undoScore' }); };
  const redo = (): void => { void stopAudio(); dispatch({ type: 'redoScore' }); };

  return (
    <main class="app wc-app">
      <TopBar
        audioRunning={audio.audioRunning()}
        ctxState={audio.ctxState}
        presetId={presetId()}
        mobileMode={mobileMode()}
        showMobileMenu={showMobileMenu()}
        chooseMobileMode={(m) => {
          setMobileMode(m);
          setMobileModeSignal(m);
          setShowMobileMenu(false);
        }}
        setShowMobileMenu={(v) => setShowMobileMenu(v)}
        onSavePreset={() => setShowSavePreset((v) => !v)}
        onRollback={undo}
        onRedo={redo}
        onNew={() => {
          if (!confirmNew()) return;
          void stopAudio();
          dispatch({ type: 'replaceScore', text: NEW_COMPOSITION_TEMPLATE });
          dispatch({ type: 'clearMessages' });
          setPresetId('creep');
        }}
        onDeletePreset={() => {
          const id = presetId();
          if (!id.startsWith('custom-')) return;
          deleteCustomPreset(id);
          setPresetId('creep');
          const fallback = getPreset('creep');
          if (fallback) dispatch({ type: 'replaceScore', text: fallback.score });
        }}
        onResetAll={onResetAll}
      />
      <PresetRow
        presetId={presetId()}
        showStepGrid={showStepGrid()}
        showPiano={showPiano()}
        showSavePreset={showSavePreset()}
        newPresetName={newPresetName()}
        onLoadPreset={(id) => {
          const preset = getPreset(id);
          if (!preset) return;
          setPresetId(id);
          dispatch({ type: 'replaceScore', text: preset.score });
          void evalScore();
        }}
        onToggleStepGrid={() => {
          if (showStepGrid()) { setShowStepGrid(false); closeKindSheet('step'); return; }
          setShowPiano(false);
          closeKindSheet('piano');
          setShowStepGrid(true);
          openKindSheet('step', 'full');
        }}
        onTogglePiano={() => {
          if (showPiano()) { setShowPiano(false); closeKindSheet('piano'); return; }
          setShowStepGrid(false);
          closeKindSheet('step');
          setShowPiano(true);
          openKindSheet('piano', 'full');
        }}
        onShowSavePreset={(v) => setShowSavePreset(v)}
        onNewPresetName={(v) => setNewPresetName(v)}
        onSavePreset={() => {
          const name = newPresetName().trim();
          if (!name) return;
          const preset = saveCustomPreset(name, appStore.score);
          setPresetId(preset.id);
          setShowSavePreset(false);
          setNewPresetName('');
        }}
      />
      <PanelsLayout />
      <FAB
        onClick={() => {
          if (audio.audioRunning()) { void stopAudio(); } else { void evalScore(); }
        }}
        tone={audio.audioRunning() ? 'magenta' : 'amber'}
        variant={audio.audioRunning() ? 'stop' : 'play'}
        ariaLabel={audio.audioRunning() ? 'Стоп' : 'Запуск'}
      />
      <BottomSheets />
      <TabBar />
      <DebugPanel />
    </main>
  );
}
