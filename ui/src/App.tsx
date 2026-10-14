import {
  createSignal, createEffect, onMount, onCleanup, Show, untrack, type JSX,
} from 'solid-js';
import { Effect } from 'effect';
import {
  installKeyboardShortcuts,
  setMobileMode,
  setTab, getMobileMode, getActiveTab,
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
import {
  getSelectedPresetId, setSelectedPresetPersist, resetSelectedPreset,
} from './presentation/state/selectedPreset';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { useAppBootstrap } from './presentation/state/useAppBootstrap';
import { useAutoSave } from './presentation/state/useAutoSave';
import { TabBar } from './presentation/components/TabBar';
import { Toast } from './presentation/components/Toast';
import { ConsoleSheet } from './presentation/components/ConsoleSheet';
import { installConsoleGlobals } from './presentation/components/consoleGlobals';
import { TopBar } from './presentation/components/app/TopBar';
import { TransportBar } from './presentation/components/TransportBar';
import { PanelsLayout } from './presentation/components/app/PanelsLayout';
import { Admin } from './presentation/pages/Admin';
import { Landing } from './presentation/components/landing/Landing';

const NEW_COMPOSITION_TEMPLATE = '// Начни новую композицию здесь\n';

const confirmReset = (): boolean => window.confirm(
  'Сбросить ВСЕ настройки и очистить локальное хранилище?\n(localStorage + IDB score/messages)',
);
const onResetAll = (): void => {
  if (!confirmReset()) return;
  resetAllBrowserData();
  resetSelectedPreset();
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
    <>
      <Show when={route() === 'landing'}>
        <Landing />
      </Show>
      <Show when={route() === 'app'}>
        <AppShell />
      </Show>
      <Show when={route() === 'admin'}>
        <Admin />
      </Show>
    </>
  );
}

function AppShell(): JSX.Element {
  const audio = useAppBootstrap();
  useAutoSave();

  const presetId = getSelectedPresetId;
  const [showSavePreset, setShowSavePreset] = createSignal(false);
  const [audioStarting, setAudioStarting] = createSignal(false);
  const [mobileMode, setMobileModeSignal] = createSignal<MobileMode>(getMobileMode());
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
      openAdmin: () => { window.history.pushState(null, '', '#/admin'); window.dispatchEvent(new HashChangeEvent('hashchange')); },
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

  // Auto-load grid from current score when user opens Step tab.
  // Replaces the onBeforeOpenStep prop that BottomToolstrip used to receive.
  // Runs once per switch to 'step' (Solid effect with [untrack] guard).
  createEffect(() => {
    if (getActiveTab() === 'step' && untrack(isGridEmptyState)) {
      loadFromScore(appStore.score);
    }
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
        sampleStatus={getSampleStatus()}
        chooseMobileMode={(m) => {
          setMobileMode(m);
          setMobileModeSignal(m);
        }}
        onSavePreset={() => setShowSavePreset((v) => !v)}
        onRollback={undo}
        onRedo={redo}
        onNew={() => {
          if (!confirmNew()) return;
          void stopAudio();
          dispatch({ type: 'replaceScore', text: NEW_COMPOSITION_TEMPLATE });
          dispatch({ type: 'clearMessages' });
          setSelectedPresetPersist('creep');
        }}
        onDeletePreset={() => {
          const id = presetId();
          if (!id.startsWith('custom-')) return;
          deleteCustomPreset(id);
          setSelectedPresetPersist('creep');
          const fallback = getPreset('creep');
          if (fallback) dispatch({ type: 'replaceScore', text: fallback.score });
        }}
        onResetAll={onResetAll}
        onToggleLayout={() => {
          const cur = getLayout();
          setLayout(cur === 'ai-primary' ? 'code-primary' : 'ai-primary');
        }}
        onOpenAdmin={() => { window.history.pushState(null, '', '#/admin'); window.dispatchEvent(new HashChangeEvent('hashchange')); }}
      />
      <TransportBar
        presetId={presetId()}
        showSavePreset={showSavePreset()}
        newPresetName={newPresetName()}
        audioRunning={audio.audioRunning}
        audioStarting={audioStarting}
        onLoadPreset={(id) => {
          const preset = getPreset(id);
          if (!preset) return;
          setSelectedPresetPersist(id);
          dispatch({ type: 'replaceScore', text: preset.score });
          void evalScore();
        }}
        onShowSavePreset={(v) => setShowSavePreset(v)}
        onNewPresetName={(v) => setNewPresetName(v)}
        onSavePreset={() => {
          const name = newPresetName().trim();
          if (!name) return;
          const preset = saveCustomPreset(name, appStore.score);
          setSelectedPresetPersist(preset.id);
          setShowSavePreset(false);
          setNewPresetName('');
        }}
        onPlay={() => {
          setAudioStarting(true);
          void evalScore();
        }}
        onStop={() => {
          void stopAudio();
        }}
      />
      <PanelsLayout />
      <TabBar />
      <ConsoleSheet />
    </main>
  );
}
