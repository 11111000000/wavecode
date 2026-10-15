import { createStore, produce } from 'solid-js/store';
import { initialAppState, type AppState, type Message, type Track } from '~/domain/types';
import { reduceAppEvent, type AppEvent } from '~/application/reducer';

/**
 * Solid-js/store для AppState.
 * Mutations — ТОЛЬКО через reduceAppEvent (pure fn) внутри produce().
 * Presentation не знает про infrastructure — только через domain reducer.
 */

export const [appStore, setAppStore] = createStore<AppState>(initialAppState);

export const dispatch = (event: AppEvent): void => {
  setAppStore(produce((draft) => {
    const next = reduceAppEvent(draft as AppState, event);
    Object.assign(draft, next);
  }));
};

/**
 * Convenience accessors for the active track. Callers should
 * prefer these over `appStore.tracks.find(...)` so the
 * active-track lookup pattern stays consistent.
 */
export const getActiveTrack = (): Track | undefined =>
  appStore.tracks.find((t) => t.id === appStore.activeTrackId);

export const getActiveScore = (): string =>
  getActiveTrack()?.score ?? '';

export const getActiveMessages = (): ReadonlyArray<Message> =>
  getActiveTrack()?.messages ?? [];
