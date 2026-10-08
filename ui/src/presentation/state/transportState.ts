import { createSignal, createEffect, createRoot, untrack } from 'solid-js';
import { dispatch, appStore } from './appStore';
import type { TransportState } from '~/domain/types';

/**
 * Presentation-layer signals for transport (cps, swing).
 *
 * Read source of truth: `appStore.transportState` (Solid store, reducer).
 * Local signals mirror the store on init and on subsequent reducer updates,
 * so the UI (slider, button) can be driven imperatively without rerunning
 * the whole reactive graph on every input event.
 *
 * Sync path:
 *   - UI → reducer (debounced 100ms — slider drags fire rapid events).
 *   - cps → AudioEngine.setCps — реализован ОТДЕЛЬНО в `App.tsx` через
 *     `useTransportAudioSync()`, чтобы изолировать тесты от
 *     Effect.runPromise (которая держит vitest до разрешения microtasks).
 */

const SYNC_DEBOUNCE_MS = 100;

const initialTransport = (): TransportState => ({
  cps: appStore.transportState.cps,
  swing: appStore.transportState.swing,
});

export const [cps, setCpsSignal] = createSignal<number>(initialTransport().cps);
export const [swing, setSwingSignal] = createSignal<boolean>(initialTransport().swing);

/** Apply a TransportState seeded from the store (используется App.tsx). */
export const syncFromReducer = (next: TransportState): void => {
  setCpsSignal(next.cps);
  setSwingSignal(next.swing);
};

// UI → reducer. Чистый setTimeout (no Effect.runPromise) — тесты с real-таймерами
// могут await без риска висящего microtask в Effect.
let pendingDispatchCps: number | null = null;
let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

const flushDispatch = (): void => {
  dispatchTimer = null;
  if (pendingDispatchCps === null) return;
  const value = pendingDispatchCps;
  pendingDispatchCps = null;
  dispatch({ type: 'setCps', cps: value });
};

/** Imperative setter used by the panel. UI signal updates immediately;
 *  reducer dispatch is debounced 100ms. */
export const setCpsLocal = (next: number): void => {
  setCpsSignal(next);
  pendingDispatchCps = next;
  if (dispatchTimer !== null) clearTimeout(dispatchTimer);
  dispatchTimer = setTimeout(flushDispatch, SYNC_DEBOUNCE_MS);
};

export const toggleSwingLocal = (): void => {
  const next = !swing();
  setSwingSignal(next);
  // Swing не требует debounce — редкое событие. Synchronous dispatch.
  dispatch({ type: 'toggleSwing' });
};

/** Keep local signals in sync with external reducer updates (load preset и т.д.).
 *  `untrack` важен: если effect читает `cps()`/`swing()` внутри и
 *  setCpsSignal/setSwingSignal тоже внутри, Solid делает это реактивным
 *  (feedback loop). Реагируем ТОЛЬКО на `transportState`, не на собственные сигналы. */
createRoot(() => {
  createEffect(() => {
    const t = appStore.transportState;
    if (t.cps !== untrack(cps)) setCpsSignal(t.cps);
    if (t.swing !== untrack(swing)) setSwingSignal(t.swing);
  });
});
