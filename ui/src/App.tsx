import {
  createSignal, onMount, onCleanup, type JSX,
} from 'solid-js';
import { Effect } from 'effect';
import {
  installKeyboardShortcuts,
  setMobileMode,
  openKindSheet, closeKindSheet, setTab, getMobileMode,
  getLayout, setLayout,
  getSampleStatus,
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
import { Toast } from './presentation/components/Toast';
import { ConsoleButton } from './presentation/components/ConsoleButton';
import { ConsoleSheet } from './presentation/components/ConsoleSheet';
import { installConsoleGlobals } from './presentation/components/consoleGlobals';
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

  // Лендинг передаёт выбранный пресет через ?preset=<id>.
  // Подхватываем его в onMount, чтобы не было вспышки "creep" при заходе.
  const initialPresetId = (() => {
    try {
      const p = new URLSearchParams(window.location.search).get('preset');
      if (p && getPreset(p)) return p;
    } catch { /* malformed URL — игнорируем */ }
    return 'creep';
  })();

  const [presetId, setPresetId] = createSignal(initialPresetId);
  // Если пришли с лендинга — сразу подставить score в редактор.
  // Пользователь сам нажмёт ▶, потому что autoplay без user gesture
  // браузер блокирует (AudioContext.resume требует click/keydown).
  if (initialPresetId !== 'creep') {
    const preset = getPreset(initialPresetId);
    if (preset) {
      dispatch({ type: 'replaceScore', text: preset.score });
    }
  }
  const [showSavePreset, setShowSavePreset] = createSignal(false);
  const [showStepGrid, setShowStepGrid] = createSignal(false);
  const [showPiano, setShowPiano] = createSignal(false);
  const [audioStarting, setAudioStarting] = createSignal(false);
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

  // Audio start indicator: 2s safety timeout resets audioStarting if
  // AudioContext never reaches 'running'.
  onMount(() => {
    const startTimer = window.setInterval(() => {
      if (audio.ctxState().state === 'running' && audioStarting()) {
        setAudioStarting(false);
      }
    }, 200);
    const timeoutId = window.setTimeout(() => {
      if (audioStarting() && audio.ctxState().state !== 'running') {
        setAudioStarting(false);
      }
    }, 2000);
    onCleanup(() => {
      window.clearInterval(startTimer);
      window.clearTimeout(timeoutId);
    });
  });

  onMount(() => {
    installConsoleGlobals();
  });

  return (
    <main class="app wc-app">
      <Toast />
      <TopBar
        audioRunning={audio.audioRunning()}
        audioStarting={audioStarting()}
        ctxState={audio.ctxState}
        presetId={presetId()}
        mobileMode={mobileMode()}
        showMobileMenu={showMobileMenu()}
        sampleStatus={getSampleStatus()}
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
        onToggleLayout={() => {
          const cur = getLayout();
          setLayout(cur === 'ai-primary' ? 'code-primary' : 'ai-primary');
        }}
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
          if (audio.audioRunning()) { void stopAudio(); } else { setAudioStarting(true); void evalScore(); }
        }}
        tone={audio.audioRunning() ? 'magenta' : 'amber'}
        variant={audio.audioRunning() ? 'stop' : 'play'}
        ariaLabel={audio.audioRunning() ? 'Стоп' : 'Запуск'}
      />
      <BottomSheets />
      <TabBar />
      <ConsoleButton />
      <ConsoleSheet />
    </main>
  );
}
