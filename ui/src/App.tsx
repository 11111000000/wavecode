import {
  createSignal, onMount, onCleanup, Show, type JSX,
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
import { isGridEmptyState, loadFromScore } from './presentation/state/gridState';
import {
  getPreset, saveCustomPreset, deleteCustomPreset, resetAllBrowserData,
} from './presentation/state/presetsStore';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { useAppBootstrap } from './presentation/state/useAppBootstrap';
import { useAutoSave } from './presentation/state/useAutoSave';
import { TabBar } from './presentation/components/TabBar';
import { Toast } from './presentation/components/Toast';
import { ConsoleButton } from './presentation/components/ConsoleButton';
import { ConsoleSheet } from './presentation/components/ConsoleSheet';
import { installConsoleGlobals } from './presentation/components/consoleGlobals';
import { TopBar } from './presentation/components/app/TopBar';
import { PresetRow } from './presentation/components/app/PresetRow';
import { PanelsLayout } from './presentation/components/app/PanelsLayout';
import { BottomSheets } from './presentation/components/app/BottomSheets';
import { Admin } from './presentation/pages/Admin';
import { Landing } from './presentation/components/landing/Landing';
import { TransportPanel } from './presentation/components/TransportPanel';

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

/**
 * Tiny in-house hash router.
 *
 * Why no `@solidjs/router`
 * ------------------------
 * The landing-page commit (0e048a7) wired up `HashRouter` + two `Route`s,
 * and was rolled back by later refactors that simplified `App.tsx` to a
 * single render. The package was removed from `dependencies` so adding
 * `/admin` as a third route would require touching `package.json` —
 * which other agents own.
 *
 * For three routes (#/, #/app, #/admin) a 30-line router is cheaper
 * than pulling in `@solidjs/router` + its peer deps and threading it
 * back through `main.tsx` (also out of scope). Behavior:
 *
 *   #/         → Landing (marketing page, math/wavecode-landing-restore)
 *   #/app      → AppShell (editor)
 *   #/admin    → Admin (debug inspector)
 *   anything else → Landing (fallback — bare URL goes to marketing)
 *
 * Hash changes are observed via `hashchange` and stored in a signal so
 * the JSX re-evaluates. SSR-safe (no `window` reads outside `onMount`).
 */
type Route = 'landing' | 'app' | 'admin';
const useHashRoute = (): () => Route => {
  const readHash = (): Route => {
    if (typeof window === 'undefined') return 'landing';
    const h = window.location.hash;
    if (h === '#/admin' || h.startsWith('#/admin?')) return 'admin';
    if (h === '#/app' || h.startsWith('#/app?') || h.startsWith('#/app&')) return 'app';
    // #/, '', or anything else → landing
    return 'landing';
  };
  const [route, setRoute] = createSignal<Route>(readHash());
  onMount(() => {
    const onHash = (): void => { setRoute(readHash()); };
    window.addEventListener('hashchange', onHash);
    onCleanup(() => window.removeEventListener('hashchange', onHash));
  });
  return route;
};

export function App(): JSX.Element {
  const route = useHashRoute();
  return (
    <Show
      when={route() === 'admin' ? 'admin' : route() === 'app' ? 'app' : 'landing'}
      fallback={<Landing />}
    >
      {(which) => (
        <Show when={which() === 'admin'} fallback={<AppShell />}>
          <Admin />
        </Show>
      )}
    </Show>
  );
}

function AppShell(): JSX.Element {
  const audio = useAppBootstrap();
  useAutoSave();

  const [presetId, setPresetId] = createSignal('creep');
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
          // Auto-populate grid from current score on first open
          // (when grid is empty). Mirrors the `↓ read score` button;
          // user's mental model: open sheet → see current pattern.
          // Manual edits (taps) are preserved on subsequent opens
          // because grid is no longer empty. Packet
          // math/wavecode-step-grid-autoload-and-sync.
          if (isGridEmptyState()) {
            loadFromScore(appStore.score);
          }
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
      <div class="app-controls-row">
        <TransportPanel
          audioRunning={audio.audioRunning}
          audioStarting={audioStarting}
          onPlay={() => {
            setAudioStarting(true);
            void evalScore();
          }}
          onStop={() => {
            void stopAudio();
          }}
        />
      </div>
      <PanelsLayout />
      <BottomSheets />
      <TabBar />
      <ConsoleButton />
      <ConsoleSheet />
      <a class="wc-debug-link" href="#/admin" aria-label="Open debug inspector">
        → /admin
      </a>
    </main>
  );
}
