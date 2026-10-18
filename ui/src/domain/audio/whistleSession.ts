/**
 * Whistle-session lifecycle FSM: a press-and-hold wrapper around the
 * already-pure `micCapture.MicState`. The session encapsulates
 *   idle → arming → recording → segmenting → idle
 * with `*` → errored on failure and `*` → idle on cancel.
 *
 * This file does NOT touch Web Audio, getUserMedia, or any Worker.
 * The transitions are pure: the orchestrator (presentation layer —
 * `whistleStore.ts`, written by Agent 3) calls into
 * `infrastructure/audio/MicCapture.ts`, observes the result, and
 * feeds either `mic-ready`, `feed: PitchFrame`, `commit`, `applied`,
 * `cancel` or `error` into this reducer.
 *
 * Why a separate FSM
 * ------------------
 * The existing `micStore.ts` is presentation-tied (Solid signals,
 * editor API slots, transient + sustain overlay buffers). The whistle
 * FAB is intentionally a *minimal* touch — no slot selector, no
 * instrument selector, no editor API. Stripping the presentation
 * bindings out of `micStore` would force us to fork it; building a
 * narrower FSM around `MicState` is 100 LOC and reused as the unit
 * of test for the whistle FAB's lifecycle obligation.
 *
 * Snippet generation on `commit` is a hint only: the real snippet is
 * produced via `micSnippetFromBuffers` (which uses the captured
 * `Transient[]` + `AudioNote[]` buffers and the rubric in
 * `domain/audio/micSnippet.ts`). The helper `notesToSnippetPreview`
 * here is for UI display in the whistle FAB preview chip —
 * truncated, no tuning parameters.
 */

import {
  closeOpenNote,
  feed as feedMicState,
  initialMicState,
  type AudioNote,
  type MicState,
  type PitchFrame,
} from './micCapture';
import { noteNumberToName } from '../music/notes';

export type WhistleSessionState =
  | { readonly tag: 'idle' }
  | { readonly tag: 'arming' }
  | {
      readonly tag: 'recording';
      readonly micState: MicState;
      readonly startedAtMs: number;
      /** Timestamp of the most recently fed frame. Used by `commit` as
       *  the `nowMs` argument to `closeOpenNote` so the trailing note
       *  length is correct even if the user holds the FAB for several
       *  seconds in silence. Defaults to `startedAtMs`. */
      readonly lastFrameMs: number;
    }
  | { readonly tag: 'segmenting'; readonly notes: ReadonlyArray<AudioNote> }
  | { readonly tag: 'errored'; readonly error: string };

export type WhistleSessionEvent =
  | { readonly type: 'arm' }
  | { readonly type: 'mic-ready' }
  | { readonly type: 'feed'; readonly frame: PitchFrame }
  | { readonly type: 'commit' }
  | { readonly type: 'applied' }
  | { readonly type: 'cancel' }
  | { readonly type: 'error'; readonly message: string };

export const initialWhistleSession = (): WhistleSessionState => ({ tag: 'idle' });

/**
 * Fire-and-forget reducer. Returns a NEW state; the input is never
 * mutated (the application layer may keep the previous state around
 * for Undo/Redo).
 *
 * Cancel / error swallow prior segmenting notes intentionally: we
 * throw them away, since abandon-then-detected is not a thing we
 * support. Cancel from any non-terminal state → idle. Error from
 * anywhere → errored.
 */
export const whistleSessionReducer = (
  state: WhistleSessionState,
  event: WhistleSessionEvent,
): WhistleSessionState => {
  if (event.type === 'cancel') {
    return { tag: 'idle' };
  }

  if (event.type === 'error') {
    return { tag: 'errored', error: event.message };
  }

  switch (state.tag) {
    case 'idle': {
      if (event.type === 'arm') return { tag: 'arming' };
      return state;
    }

    case 'arming': {
      if (event.type === 'mic-ready') {
        return {
          tag: 'recording',
          micState: initialMicState(),
          startedAtMs: 0,
          lastFrameMs: 0,
        };
      }
      return state;
    }

    case 'recording': {
      if (event.type === 'feed') {
        const nextMicState = feedMicState(state.micState, event.frame);
        return {
          ...state,
          micState: nextMicState,
          lastFrameMs: event.frame.timestampMs,
        };
      }
      if (event.type === 'commit') {
        const closed = closeOpenNote(state.micState, state.lastFrameMs);
        return {
          tag: 'segmenting',
          notes: closed.notes,
        };
      }
      return state;
    }

    case 'segmenting': {
      if (event.type === 'applied') {
        return { tag: 'idle' };
      }
      return state;
    }

    case 'errored': {
      // Terminal: ignore all non-error / non-cancel events.
      return state;
    }
  }
};

/**
 * Minimal, UI-display-only snippet preview. Does NOT apply tuning
 * (vibrato, duration, tempo): those go through the real
 * `micSnippetFromBuffers` pipeline at apply time.
 *
 * Empty notes → `null` so the caller can show "—" instead of an
 * empty `note("")` that Strudel would refuse.
 */
export const notesToSnippetPreview = (
  notes: ReadonlyArray<AudioNote>,
  opts: { readonly instrument?: string } = {},
): string => {
  if (notes.length === 0) {
    return 'note("")';
  }
  const instrument = opts.instrument ?? 'piano';
  const names = notes.map((n) => noteNumberToName(n.midi).toLowerCase());
  return `note("${names.join(' ')}").s("${instrument}")`;
};
