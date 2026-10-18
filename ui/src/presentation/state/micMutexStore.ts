/**
 * micMutexStore — presentation-layer signals + actions wrapping the
 * pure `micChannelMutex` reducer in `domain/audio/micChannelMutex.ts`.
 *
 * Why this lives in presentation/state/ (not in the orchestrator's
 * Effect.Ref)
 * -----------------------------------------------------------------
 * The reducer is intentionally side-effect-free so it can be called
 * synchronously from the mini-FAB pointer handlers (no Fiber, no
 * Promise). The presentation layer is where Solid signals belong, so
 * the same module owns both the reducer-call AND the signal mirror
 * — keeping UI subscriptions and the reducer ref-count in the same
 * mental model as `micStore` and `pianoRecStore`.
 *
 * Concurrency
 * -----------
 * Acquire is synchronous: the orchestrator's Effect-based
 * `VoiceAISession` and `WhistleSession` will eventually build a
 * `Ref`-backed wrapper. For the MVP, the minifabs call
 * `acquireMic()` directly on pointerdown; another owner that wins
 * the race means we get a typed `MicBusyError` back which the UI
 * can show as a toast ("микрофон занят другим режимом").
 *
 * Idempotent release: `releaseMic(sessionId)` drops every channel
 * with that sessionId across all three kinds. A sessionId that
 * never acquired is a no-op (per the domain contract).
 */

import { createSignal } from 'solid-js';
import {
  initialMicMutexState,
  acquire,
  release,
  type MicMutexState,
} from '~/domain/audio/micChannelMutex';
import type {
  MicChannelKind,
  MicChannelOwner,
  MicBusyError,
} from '~/domain/audio/MicChannel';

export const [micMutexState, setMicMutexState] = createSignal<MicMutexState>(
  initialMicMutexState(),
);

/**
 * Acquire-request shape — narrower than `AcquireRequest` from the
 * domain module because callers always set `nowMs` via
 * `performance.now()` here (no clock-injection in presentation).
 */
export type AcquireMicInput = {
  readonly kind: MicChannelKind;
  readonly owner: MicChannelOwner;
  readonly sessionId: string;
};

/** Outcome of `acquireMic`. Mirrors the `AcquireResult` shape but
 *  drops the `next` field — the store updates its own signal. */
export type AcquireMicResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: MicBusyError };

/**
 * Try to claim an empty mic-channel slot. Synchronous: returns the
 * typed result right after updating `micMutexState` (when ok).
 */
export const acquireMic = (
  requested: AcquireMicInput,
): AcquireMicResult => {
  const result = acquire(micMutexState(), {
    kind: requested.kind,
    owner: requested.owner,
    sessionId: requested.sessionId,
    nowMs: performance.now(),
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  setMicMutexState(result.next);
  return { ok: true };
};

/**
 * Drop every channel owned by `sessionId` across all three kinds.
 * Idempotent — safe to call on a sessionId that never acquired.
 */
export const releaseMic = (sessionId: string): void => {
  const next = release(micMutexState(), sessionId);
  if (next !== micMutexState()) {
    setMicMutexState(next);
  }
};

/**
 * Convenience: true if `mic-direct` is taken OR any speech-api owner
 * is in flight. `speech-api-internal` is the friendly case (Chrome
 * shares it with anything), so we DO include it here — the answer
 * to "is the mic busy?" is "yes, someone is listening".
 */
export const isMicBusy = (): boolean => {
  const s = micMutexState();
  return s.micDirect !== null
    || s.speechApiInternal.length > 0
    || s.midi.length > 0;
};

/** Test-only: reset the store back to `initialMicMutexState`. */
export const resetMicMutexForTests = (): void => {
  setMicMutexState(initialMicMutexState());
};
