import { onMount, createSignal, onCleanup } from 'solid-js';
import { Effect } from 'effect';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { dispatch } from './appStore';
import {
  setPendingShare, markIdbHasScore, startLoadingShared, finishLoadingShared, shareState,
} from './shareState';
import { decodeSnippet } from '~/domain/urlCodec';
import { installTransportAudioSync } from './useTransportAudioSync';
import { ensureAudioLoaded, getAudioContextState } from '~/infrastructure/audio/LiveAudioEngine';
import {
  hydrateSelectedPreset, resetSelectedPreset,
} from './selectedPreset';
import { useGridStateAutoSave } from './useGridStateAutoSave';
import {
  setGridDirect,
  setLastCommittedGrid,
  setModeDirect,
} from './gridState';

export type AudioRuntime = {
  readonly ctxState: () => { state: string; sampleRate: number | null };
  readonly audioRunning: () => boolean;
};

const restoreFromIdbOrShare = (): void => {
  void Effect.runPromise(
    Effect.gen(function* () {
      const repo = yield* Repo;
      const saved = yield* repo.loadScore();
      if (saved) {
        dispatch({ type: 'replaceScore', text: saved });
        hydrateSelectedPreset();
        markIdbHasScore(true);
        return;
      }
      const pending = shareState.pendingEncoded();
      if (pending) {
        const text = decodeSnippet(pending);
        if (text) {
          startLoadingShared();
          dispatch({ type: 'replaceScore', text });
          resetSelectedPreset();
          finishLoadingShared();
          setPendingShare(null);
        } else {
          setPendingShare(null);
        }
      } else {
        // No IDB score, no pending share: hydrate from whatever's in
        // localStorage (first-ever launch writes 'creep' default).
        hydrateSelectedPreset();
      }
    }).pipe(Effect.provide(AppLayer)),
  );
};

/**
 * Restore StepGrid state from IDB (mode + draft + lastCommitted).
 * Runs once on mount, before any user-visible state could be
 * observed. If no state was saved (first launch), we keep the
 * defaults (mode=view, empty grids).
 */
const restoreGridState = (): void => {
  void Effect.runPromise(
    Effect.gen(function* () {
      const repo = yield* Repo;
      const saved = yield* repo.loadGridState();
      if (saved) {
        setModeDirect(saved.mode);
        setGridDirect(saved.draftGrid);
        setLastCommittedGrid(saved.lastCommittedGrid);
      }
    }).pipe(Effect.provide(AppLayer)),
  );
};

const installAudioPreloadOnFirstGesture = (): void => {
  let preloaded = false;
  const preload = (): void => {
    if (preloaded) return;
    preloaded = true;
    void ensureAudioLoaded();
    window.removeEventListener('pointerdown', preload, true);
    window.removeEventListener('keydown', preload, true);
  };
  window.addEventListener('pointerdown', preload, { capture: true, passive: true });
  window.addEventListener('keydown', preload, { capture: true, passive: true });
};

/**
 * App-level bootstrap: install transport sync, lazy-load sample banks,
 * restore the saved score from IDB (or apply pending ?s=… share snippet),
 * restore StepGrid state (mode + draft + lastCommitted) from IDB,
 * register a one-shot audio preload on the first user gesture, and poll
 * the AudioContext state every 500ms (drives the topbar LED + FAB tone).
 *
 * Mounts once. Idempotent in practice (import is cached; Effect pipeline
 * runs once per session).
 *
 * Returns the live audio telemetry signals so callers (TopBar, FAB) can
 * read them as props without owning the polling timer themselves.
 */
export const useAppBootstrap = (): AudioRuntime => {
  const [ctxStateSig, setCtxState] = createSignal(getAudioContextState());
  const [audioRunningSig, setAudioRunning] = createSignal(false);

  onMount(() => {
    installTransportAudioSync();
    void import('~/infrastructure/audio/SampleLoader').then((m) => m.loadAllSamples());
    restoreFromIdbOrShare();
    restoreGridState();
    useGridStateAutoSave();
    installAudioPreloadOnFirstGesture();

    const pollId = window.setInterval(() => {
      const s = getAudioContextState();
      setCtxState(s);
      setAudioRunning(s.state === 'running');
    }, 500);
    onCleanup(() => window.clearInterval(pollId));
  });

  return { ctxState: ctxStateSig, audioRunning: audioRunningSig };
};
