/**
 * Voice-AI session state machine (pure reducer).
 *
 * Models the lifecycle of a single voice-AI session, from `idle`
 * through `arming` → `listening` → `transcribing` → `requesting` →
 * `applying`, with `paused` and `errored` escape hatches. The
 * reducer takes the current state plus an event and returns the
 * next state; it performs no IO and uses no wall-clock time.
 *
 * Why a separate reducer (not Effect.gen orchestration in the
 * application layer)
 * ----------------------------------------------------------
 * Three reasons:
 *   1. Testability — every transition is a deterministic function
 *      of (state, event). The transition table is exercised in
 *      `voiceSession.test.ts` with zero mocking.
 *   2. Replay — a buffered event log can rebuild the session
 *      (useful for "why did it end up errored?" debugging, and
 *      a prerequisite for future wake-word / cron-driven sessions).
 *   3. Layer purity — domain/ cannot import from
 *      `solid-js` / `effect/platform` / `@ai-sdk/*`. Effect's
 *      `Ref` lives in application/, so the reducer — which lives in
 *      domain/ — must NOT use it. The orchestrator wraps this
 *      reducer in `Ref.update` / `Stream.fold` at the application
 *      boundary.
 *
 * Barge-in is a "replace current session" signal: it returns to
 * `idle` from `listening / requesting / applying`. Effect-fibre
 * cancellation is the orchestrator's responsibility (this file
 * never sees a `Fiber`). Default mode is `'replace'`; the
 * orchestrator decides what to do after idle (re-arm in continuous,
 * stay idle otherwise).
 *
 * Glossary:
 *   - `listening`     = STT engine active, transcript growing
 *   - `transcribing`  = final chunk landed, awaiting user commit
 *                       (deferred commit on continuous mode)
 *   - `requesting`    = LLM edit prompt in flight
 *   - `applying`      = LLM returned, AudioEngine.eval in progress
 *   - `paused`        = user explicitly paused (resumable)
 *   - `errored`       = unrecoverable failure (stt-init / llm / eval)
 */

import {
  appendChunk,
  initialTranscriptState,
  type TranscriptChunk,
  type TranscriptState,
} from './Transcript';

export type VoiceSessionState =
  | { readonly tag: 'idle' }
  | { readonly tag: 'arming' }
  | { readonly tag: 'listening'; readonly transcript: TranscriptState; readonly continuous: boolean }
  | { readonly tag: 'transcribing'; readonly transcript: TranscriptState }
  | { readonly tag: 'requesting'; readonly transcript: TranscriptState; readonly continuous: boolean }
  | { readonly tag: 'applying'; readonly transcript: TranscriptState; readonly score: string; readonly continuous: boolean }
  | { readonly tag: 'paused'; readonly transcript: TranscriptState }
  | { readonly tag: 'errored'; readonly error: string; readonly transcript: TranscriptState };

export type VoiceSessionEvent =
  | { readonly type: 'arm' }
  | { readonly type: 'stt-ready' }
  | { readonly type: 'chunk'; readonly chunk: TranscriptChunk }
  | { readonly type: 'commit' }
  | { readonly type: 'request-sent'; readonly score: string }
  | { readonly type: 'applied' }
  | { readonly type: 'barge-in' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'dismiss' };

/**
 * Fresh session. `transcript` is allocated lazily so the
 * `idle` variant stays cheap to construct and to compare
 * with `===` in tests.
 */
export const initialVoiceSession = (): VoiceSessionState => ({ tag: 'idle' });

/**
 * Transition table. Every cell is explicit; missing combinations
 * (chunk in `transcribing`) return the state unchanged so the
 * reducer is total. The function is declared `const arrow` so
 * vitest can `toHaveLength`-assert on the array of cases.
 */
export const voiceSessionReducer = (
  state: VoiceSessionState,
  event: VoiceSessionEvent,
): VoiceSessionState => {
  // Pause and error are wildcard transitions — handled first so
  // the per-state branches below can assume `paused` / `errored`
  // are sinks.
  if (event.type === 'pause') {
    return pauseFrom(state);
  }
  if (event.type === 'error') {
    return errorFrom(state, event.message);
  }

  switch (state.tag) {
    case 'idle':
      return fromIdle(state, event);
    case 'arming':
      return fromArming(state, event);
    case 'listening':
      return fromListening(state, event);
    case 'transcribing':
      return fromTranscribing(state, event);
    case 'requesting':
      return fromRequesting(state, event);
    case 'applying':
      return fromApplying(state, event);
    case 'paused':
      return fromPaused(state, event);
    case 'errored':
      return fromErrored(state, event);
  }
};

const fromIdle = (
  state: { readonly tag: 'idle' },
  event: VoiceSessionEvent,
): VoiceSessionState => {
  if (event.type === 'arm') return { tag: 'arming' };
  if (event.type === 'barge-in') return state;
  return state;
};

const fromArming = (
  state: { readonly tag: 'arming' },
  event: VoiceSessionEvent,
): VoiceSessionState => {
  if (event.type === 'stt-ready') {
    return {
      tag: 'listening',
      transcript: initialTranscriptState(),
      continuous: false,
    };
  }
  if (event.type === 'arm') return { tag: 'arming' };
  if (event.type === 'barge-in') return { tag: 'idle' };
  return state;
};

const fromListening = (
  state: {
    readonly tag: 'listening';
    readonly transcript: TranscriptState;
    readonly continuous: boolean;
  },
  event: VoiceSessionEvent,
): VoiceSessionState => {
  if (event.type === 'arm') {
    // Re-arm drops the current transcript and goes back through
    // `arming`. The orchestrator decides whether to cancel the
    // STT stream first; the reducer just resets state.
    return { tag: 'arming' };
  }
  if (event.type === 'chunk') {
    const nextTranscript = appendChunk(state.transcript, event.chunk);
    if (event.chunk.kind === 'final') {
      return {
        tag: 'transcribing',
        transcript: nextTranscript,
      };
    }
    if (nextTranscript === state.transcript) return state;
    return {
      tag: 'listening',
      transcript: nextTranscript,
      continuous: state.continuous,
    };
  }
  if (event.type === 'barge-in') {
    return { tag: 'idle' };
  }
  return state;
};

const fromTranscribing = (
  state: { readonly tag: 'transcribing'; readonly transcript: TranscriptState },
  event: VoiceSessionEvent,
): VoiceSessionState => {
  if (event.type === 'commit') {
    return {
      tag: 'requesting',
      transcript: state.transcript,
      continuous: false,
    };
  }
  if (event.type === 'barge-in') return { tag: 'idle' };
  if (event.type === 'chunk') {
    // Intermediate final chunks between the first final and the
    // user commit are still useful for the transcript log (they
    // may carry a confidence update), so we run `appendChunk` for
    // final but NOT change the state tag.
    if (event.chunk.kind === 'final') {
      const next = appendChunk(state.transcript, event.chunk);
      if (next === state.transcript) return state;
      return { tag: 'transcribing', transcript: next };
    }
    return state;
  }
  return state;
};

const fromRequesting = (
  state: {
    readonly tag: 'requesting';
    readonly transcript: TranscriptState;
    readonly continuous: boolean;
  },
  event: VoiceSessionEvent,
): VoiceSessionState => {
  if (event.type === 'request-sent') {
    return {
      tag: 'applying',
      transcript: state.transcript,
      score: event.score,
      continuous: state.continuous,
    };
  }
  if (event.type === 'barge-in') return { tag: 'idle' };
  return state;
};

const fromApplying = (
  state: {
    readonly tag: 'applying';
    readonly transcript: TranscriptState;
    readonly score: string;
    readonly continuous: boolean;
  },
  event: VoiceSessionEvent,
): VoiceSessionState => {
  if (event.type === 'applied') {
    if (state.continuous) {
      return {
        tag: 'listening',
        transcript: initialTranscriptState(state.transcript.lang),
        continuous: true,
      };
    }
    return { tag: 'idle' };
  }
  if (event.type === 'barge-in') {
    // Cancel-and-replace: drop the in-flight eval result and the
    // transcript; the orchestrator handles the AudioEngine revert
    // and re-arm decision.
    return { tag: 'idle' };
  }
  return state;
};

const fromPaused = (
  state: { readonly tag: 'paused'; readonly transcript: TranscriptState },
  event: VoiceSessionEvent,
): VoiceSessionState => {
  if (event.type === 'resume') {
    return {
      tag: 'listening',
      transcript: state.transcript,
      continuous: true,
    };
  }
  if (event.type === 'dismiss') return { tag: 'idle' };
  return state;
};

const fromErrored = (
  state: { readonly tag: 'errored'; readonly error: string; readonly transcript: TranscriptState },
  event: VoiceSessionEvent,
): VoiceSessionState => {
  if (event.type === 'dismiss') return { tag: 'idle' };
  if (event.type === 'arm') return { tag: 'arming' };
  return state;
};

const pauseFrom = (state: VoiceSessionState): VoiceSessionState => {
  switch (state.tag) {
    case 'listening':
      return { tag: 'paused', transcript: state.transcript };
    case 'transcribing':
      return { tag: 'paused', transcript: state.transcript };
    case 'requesting':
      return { tag: 'paused', transcript: state.transcript };
    case 'applying':
      return { tag: 'paused', transcript: state.transcript };
    case 'paused':
      return state;
    case 'errored':
      return state;
    case 'arming':
      return state;
    case 'idle':
      return state;
  }
};

const errorFrom = (
  state: VoiceSessionState,
  message: string,
): VoiceSessionState => {
  if (state.tag === 'errored') {
    if (message === state.error) return state;
    return { tag: 'errored', error: message, transcript: state.transcript };
  }
  switch (state.tag) {
    case 'idle':
    case 'arming':
      return { tag: 'errored', error: message, transcript: initialTranscriptState() };
    case 'listening':
    case 'transcribing':
    case 'requesting':
    case 'applying':
    case 'paused':
      return { tag: 'errored', error: message, transcript: state.transcript };
  }
};
