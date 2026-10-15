import { createStore, produce } from 'solid-js/store';
import { initialAppState, type AppState } from '~/domain/types';
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