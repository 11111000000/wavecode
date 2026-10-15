import { onMount, createSignal, onCleanup } from 'solid-js';
import { Effect } from 'effect';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { appStore, setAppStore } from './appStore';
import { makeTrack, type Track } from '~/domain/types';
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

const DEFAULT_TRACK_ID = 'default';

/**
 * Replaces the entire tracks slice from IDB. Used at bootstrap
 * to hydrate without round-tripping through individual events
 * (no spurious undo entries from `replaceScore`).
 */
const hydrateFromIdb = (
  tracks: ReadonlyArray<Track>,
  activeId: string | null,
): void => {
  if (tracks.length === 0) return;
  const resolved = activeId !== null && tracks.some((t) => t.id === activeId)
    ? activeId
    : tracks[0]!.id;
  setAppStore((prev) => ({
    ...prev,
    tracks,
    activeTrackId: resolved,
    layerMix: [],
  }));
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
 * restore tracks + active id from IDB (or apply pending ?s=… share
 * snippet as a new track), restore StepGrid state (mode + draft +
 * lastCommitted) from IDB, register a one-shot audio preload on the
 * first user gesture, and poll the AudioContext state every 500ms
 * (drives the topbar LED + FAB tone).
 *
 * Mounts once. Idempotent in practice (import is cached; Effect
 * pipeline runs once per session).
 *
 * Returns the live audio telemetry signals so callers (TopBar, FAB)
 * can read them as props without owning the polling timer themselves.
 */
export const useAppBootstrap = (): AudioRuntime => {
  const [ctxStateSig, setCtxState] = createSignal(getAudioContextState());
  const [audioRunningSig, setAudioRunning] = createSignal(false);

  onMount(() => {
    installTransportAudioSync();
    void import('~/infrastructure/audio/SampleLoader').then((m) => m.loadAllSamples());

    void Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* Repo;
        const [tracks, activeId] = yield* Effect.all([
          repo.loadTracks(),
          repo.loadActiveTrackId(),
        ]);
        if (tracks.length > 0) {
          hydrateFromIdb(tracks, activeId);
          markIdbHasScore(true);
          hydrateSelectedPreset();
        } else {
          const pending = shareState.pendingEncoded();
          if (pending) {
            const text = decodeSnippet(pending);
            if (text) {
              startLoadingShared();
              const t = makeTrack({
                id: DEFAULT_TRACK_ID,
                title: 'Главный',
                score: text,
                state: 'active',
              });
              hydrateFromIdb([t], t.id);
              resetSelectedPreset();
              finishLoadingShared();
              setPendingShare(null);
            } else {
              setPendingShare(null);
            }
          } else {
            hydrateSelectedPreset();
          }
        }
      }).pipe(Effect.provide(AppLayer)),
    );

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

// Mark appStore as used (avoid "unused import" if linter complains
// after future refactors that drop the read).
void appStore;
