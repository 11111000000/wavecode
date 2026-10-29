import { createStore } from 'solid-js/store';
import { initialAppState, type AppState } from '~/domain/types';
import { reduceAppEvent, type AppEvent } from '~/application/reducer';

/**
 * Solid-js/store для AppState.
 * Mutations — ТОЛЬКО через reduceAppEvent (pure fn).
 * Presentation не знает про infrastructure — только через domain reducer.
 *
 * Why a flat `setAppStore(reduceAppEvent(...))` and not `produce(...)`:
 * `reduceAppEvent` is a pure function that returns a fresh, structurally
 * shared object (its inner spreads already reuse unchanged sub-trees).
 * `solid-js/store`'s `setAppStore(next)` does the same diff-tracking that
 * `produce` would, but on the immutable result — fine-grained reactivity
 * on `appStore.dialogs[id]` still works because we pass a new outer
 * object with the same nested references. The previous `produce + Object.assign`
 * approach was structurally identical to this but went through the
 * mutable-Proxy dance for no benefit: `reduceAppEvent` never touched
 * the draft in place, so `Object.assign` was a shallow surface mutation
 * that could leave nested arrays/objects referentially stale.
 */

export const [appStore, setAppStore] = createStore<AppState>(initialAppState);

export const dispatch = (event: AppEvent): void => {
  setAppStore((prev) => reduceAppEvent(prev, event));
};