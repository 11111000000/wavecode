/**
 * `micChannelMutex` — pure state machine for "who owns the mic?":
 *   - `micDirect`         — at most one (single AudioContext + MediaStream)
 *   - `speechApiInternal` — many allowed (Chrome shares it internally,
 *                            doesn't conflict with our AudioContext)
 *   - `midi`              — many allowed (virtual placeholder for
 *                            future MIDI-learn wiring; mutex exists so
 *                            the future code doesn't have to be retrofitted)
 *
 * This module is intentionally a plain reducer (no Effect.Ref, no
 * services). The application layer in `voice/` wraps it in
 * `Effect.Ref` and publishes a `Stream` for the presentation layer.
 * Keeping the reducer pure makes it (a) trivial to test, (b) replayable
 * across micro-rollback / undo (see also `decision.yaml` outcome
 * `mic-mutex-correct`).
 *
 * Concurrency model
 * -----------------
 * `acquire` is *synchronous*: it inspects the current `state` and
 * returns either an updated state or a `MicBusyError`. Callers that
 * want transactional semantics wrap this in `Effect.Ref.modify` and
 * retry on busy. We DO NOT do CAS loops here — the decision packet
 * is explicit that domain stays side-effect-free.
 *
 * Why a structured `MicBusyError` instead of throwing
 * ---------------------------------------------------
 * Effect code at the application layer wants `Either<MicBusy, ...>`,
 * not exceptions. Returning the error as a value (alongside the
 * unchanged `next: MicMutexState` for the caller's transactional
 * bookkeeping) makes the type system enforce exhaustive handling at
 * the presentation boundary.
 */

import type { MicChannel, MicChannelKind, MicChannelOwner, MicBusyError } from './MicChannel';

export type MicMutexState = {
  readonly micDirect: MicChannel | null;
  readonly speechApiInternal: ReadonlyArray<MicChannel>;
  readonly midi: ReadonlyArray<MicChannel>;
};

export type AcquireResult =
  | { readonly ok: true; readonly channel: MicChannel; readonly next: MicMutexState }
  | { readonly ok: false; readonly error: MicBusyError; readonly next: MicMutexState };

export type AcquireRequest = {
  readonly kind: MicChannelKind;
  readonly owner: MicChannelOwner;
  readonly sessionId: string;
  readonly nowMs: number;
};

export const initialMicMutexState = (): MicMutexState => ({
  micDirect: null,
  speechApiInternal: [],
  midi: [],
});

const buildChannel = (req: AcquireRequest): MicChannel => ({
  kind: req.kind,
  owner: req.owner,
  sessionId: req.sessionId,
  acquiredAtMs: req.nowMs,
});

/**
 * Try to take an empty mic-channel slot.
 *
 * Rules:
 *   - `mic-direct` requires `state.micDirect === null`. Otherwise returns
 *     a `MicBusyError` whose `conflictingChannel` is the existing owner.
 *   - `speech-api-internal` always succeeds (Chrome shares it).
 *   - `midi` always succeeds (virtual, no physical resource contention).
 *
 * On `ok: false`, `next` is returned unchanged so the caller can
 * hand it back to `Effect.Ref.set` cleanly without rolling back
 * their own bookkeeping.
 */
export const acquire = (state: MicMutexState, requested: AcquireRequest): AcquireResult => {
  const { kind } = requested;

  if (kind === 'mic-direct') {
    if (state.micDirect !== null) {
      const error: MicBusyError = {
        _tag: 'MicBusy',
        conflictingChannel: state.micDirect,
        requestedBy: requested.owner,
      };
      return { ok: false, error, next: state };
    }
    const channel = buildChannel(requested);
    const next: MicMutexState = { ...state, micDirect: channel };
    return { ok: true, channel, next };
  }

  if (kind === 'speech-api-internal') {
    const channel = buildChannel(requested);
    const next: MicMutexState = {
      ...state,
      speechApiInternal: [...state.speechApiInternal, channel],
    };
    return { ok: true, channel, next };
  }

  // kind === 'midi'
  const channel = buildChannel(requested);
  const next: MicMutexState = {
    ...state,
    midi: [...state.midi, channel],
  };
  return { ok: true, channel, next };
};

/**
 * Drop every channel owned by `sessionId`, across all three kinds.
 * Idempotent: a sessionId that never acquired is a no-op (returned
 * state has the same contents; we still return a fresh object so
 * downstream Effect.Ref observability distinguishes "no-op" from
 * "no-input"). The freshness is intentional: callers can compare
 * identity to decide whether to fire any "released" downstream event.
 */
export const release = (state: MicMutexState, sessionId: string): MicMutexState => {
  const filteredSpeech = state.speechApiInternal.filter((c) => c.sessionId !== sessionId);
  const filteredMidi = state.midi.filter((c) => c.sessionId !== sessionId);
  const micDirect = state.micDirect !== null && state.micDirect.sessionId === sessionId
    ? null
    : state.micDirect;

  if (
    filteredSpeech.length === state.speechApiInternal.length
    && filteredMidi.length === state.midi.length
    && micDirect === state.micDirect
  ) {
    return state;
  }

  return {
    micDirect,
    speechApiInternal: filteredSpeech,
    midi: filteredMidi,
  };
};

/** Flatten the three kinds into a single ordered list (micDirect first
 *  if present, then speech-api-internal in acquisition order, then midi).
 *  Used by `MicMutexStore` to expose "active owners" to the UI for
 *  diagnostics badges. */
export const currentOwners = (state: MicMutexState): ReadonlyArray<MicChannel> => {
  const out: MicChannel[] = [];
  if (state.micDirect !== null) out.push(state.micDirect);
  for (const c of state.speechApiInternal) out.push(c);
  for (const c of state.midi) out.push(c);
  return out;
};
