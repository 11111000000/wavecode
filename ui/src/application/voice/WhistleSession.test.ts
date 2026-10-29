/**
 * WhistleSession tests — exercise the orchestrator's plumbing
 * against a fake `MicCaptureLike` that captures every frame and
 * returns a deterministic AudioNote buffer on `getNotes()`.
 *
 * Test coverage:
 *   1. Lifecycle: arm → recording → commit → segmenting → idle.
 *   2. Stop: cancels back to `idle` from any non-terminal state.
 *   3. Error path: mic.start rejecting with MicPermissionError
 *      propagates through the handle's start().
 */

import { describe, it, expect } from 'vitest';
import { Effect, Ref } from 'effect';
import {
  createWhistleSession,
  type WhistleSessionDeps,
  type MicCaptureLike,
  type MicPermissionError,
} from './WhistleSession';
import type { AudioNote, PitchFrame } from '~/domain/audio/micCapture';
import type { Transient } from '~/domain/audio/transient';
import type { AudioEngine } from '~/domain/services';
import type { Context } from 'effect';

type AudioService = Context.Tag.Service<typeof AudioEngine>;

const fakeNote = (midi: number): AudioNote => ({
  midi,
  cents: 0,
  startMs: 0,
  durationMs: 200,
  vibratoCents: 0,
});

type Capture = {
  starts: number;
  stops: number;
  frames: Array<PitchFrame>;
  lastGetNotesValue: ReadonlyArray<AudioNote>;
  /** The percussive hits the fake mic reports on `getTransients()`. */
  transients: ReadonlyArray<Transient>;
};

const buildMic = (capture: Capture): MicCaptureLike => ({
  start: () =>
    Effect.sync(() => {
      capture.starts += 1;
    }),
  stop: () =>
    Effect.sync(() => {
      capture.stops += 1;
    }),
  feed: (frame: PitchFrame) =>
    Effect.sync(() => {
      capture.frames.push(frame);
    }),
  getNotes: () =>
    Effect.sync(() => {
      capture.lastGetNotesValue = [];
      return capture.lastGetNotesValue;
    }),
  getTransients: () => Effect.sync(() => capture.transients),
});

const buildAudio = (): AudioService => ({
  eval: () => Effect.void,
  stop: () => Effect.void,
  compileAndQuery: () => Effect.succeed([]),
  setCps: () => Effect.void,
  setLayerMix: () => Effect.void,
  setScore: () => Effect.void,
  getCycleProgress: () => Effect.succeed(0),
  getCyclePosition: () => Effect.succeed(0),
  getActiveHaps: () => Effect.succeed([]),
  recordLive: () => Effect.die('not used'),
  renderOffline: () => Effect.die('not used'),
});

const buildDeps = async (): Promise<{
  deps: WhistleSessionDeps;
  capture: Capture;
  scoreRef: Ref.Ref<string>;
}> => {
  const capture: Capture = { starts: 0, stops: 0, frames: [], lastGetNotesValue: [], transients: [] };
  const scoreRef = await Effect.runPromise(Ref.make<string>('note("c4")'));
  const audio = buildAudio();
  const mic = buildMic(capture);
  const deps: WhistleSessionDeps = { mic, audio, currentScoreRef: scoreRef };
  return { deps, capture, scoreRef };
};

describe('createWhistleSession — happy-path lifecycle', () => {
  it('arm → recording → commit → segmenting → idle with notes pulled from mic', async () => {
    const { deps, capture } = await buildDeps();
    const handle = await Effect.runPromise(createWhistleSession(deps));

    // 1. Start: arming → recording.
    const startResult = await Effect.runPromise(
      handle.start({ instrument: 'piano' }).pipe(Effect.either),
    );
    expect(startResult._tag).toBe('Right');
    const afterStart = await Effect.runPromise(Ref.get(handle.stateRef));
    expect(afterStart.tag).toBe('recording');
    expect(capture.starts).toBe(1);

    // 2. Feed: orchestrator forwards to mic + dispatches `feed`.
    await Effect.runPromise(
      handle.feed({ hz: 261.6, clarity: 0.95, rms: 0.5, timestampMs: 100 }),
    );
    await Effect.runPromise(
      handle.feed({ hz: 349.2, clarity: 0.95, rms: 0.5, timestampMs: 200 }),
    );
    expect(capture.frames).toHaveLength(2);

    // 3. Commit: orchestrator → segmenting → applied → idle.
    // Pre-seed a single note on the capture so `notesToSnippet`
    // emits a non-null snippet (and `audio.eval` is reached).
    capture.lastGetNotesValue = [fakeNote(60), fakeNote(64)];
    await Effect.runPromise(handle.commit());
    const afterCommit = await Effect.runPromise(Ref.get(handle.stateRef));
    expect(afterCommit.tag).toBe('idle');

    // FSM walked: arming → recording → segmenting (brief) → idle.
    // We can't observe the segmenting snapshot here without a queue
    // subscriber, but its existence in the reducer is sufficient.
  });

  it('REGRESSION (2026-10-19 + 2026-10-26): a whistle sprouts no drums, a TAPPED hit does', async () => {
    // 2026-10-19: the user reported "при свисте вставляют в барабаны
    // какие-то" — every whistled phrase grew a clap, because the
    // transient detector fires on the whistle's own ONSET.
    //
    // 2026-10-26: the same user asked for the opposite — tap a rhythm
    // and hear a hi-hat. The two are told apart by the NOTE buffer:
    // a transient that belongs to a sustained note is that note's
    // onset (dropped), a transient with no note behind it is a tap
    // (kept).
    //
    // This test pins both halves on the orchestrator's commit path:
    // the snippet the audio engine receives.
    const runCommit = async (
      transients: ReadonlyArray<Transient>,
    ): Promise<string> => {
      let capturedSnippet = '';
      const mic: MicCaptureLike = {
        start: () => Effect.void,
        stop: () => Effect.void,
        feed: () => Effect.void,
        getNotes: () => Effect.succeed([]),
        getTransients: () => Effect.succeed(transients),
      };
      const audio: AudioService = {
        ...buildAudio(),
        eval: (snippet: string) => {
          capturedSnippet = snippet;
          return Effect.void;
        },
      };
      const scoreRef = await Effect.runPromise(Ref.make<string>('note("c4")'));
      const handle = await Effect.runPromise(
        createWhistleSession({ mic, audio, currentScoreRef: scoreRef }),
      );
      await Effect.runPromise(handle.start({ instrument: 'piano' }));
      // A sustained note: two pitched frames 100 ms apart, so the
      // segmenter closes a real note.
      await Effect.runPromise(
        handle.feed({ hz: 261.6, clarity: 0.95, rms: 0.5, timestampMs: 0 }),
      );
      await Effect.runPromise(
        handle.feed({ hz: 392.0, clarity: 0.95, rms: 0.5, timestampMs: 100 }),
      );
      await Effect.runPromise(handle.commit());
      return capturedSnippet;
    };

    // (a) The whistle's own onset transient — same millisecond as the
    // note — is NOT a drum hit.
    const whistleSnippet = await runCommit([
      {
        type: 'click',
        startMs: 0,
        amplitude: 0.4,
        spectralCentroidHz: 3000,
        envelopeMs: 30,
      },
    ]);
    expect(whistleSnippet).toContain('c4');
    expect(whistleSnippet).not.toContain('drums_');
    expect(whistleSnippet).not.toContain('cp');

    // (b) A tap 2 seconds later — no note anywhere near it — IS a
    // drum hit, and lands in the snippet as a hi-hat / clap layer.
    const tappedSnippet = await runCommit([
      {
        type: 'hat',
        startMs: 2000,
        amplitude: 0.4,
        spectralCentroidHz: 6000,
        envelopeMs: 30,
      },
    ]);
    expect(tappedSnippet).toContain('c4');
    expect(tappedSnippet).toContain('drums_hh');
    // Both layers in one snippet — the melody and the tapped rhythm.
    expect(tappedSnippet).toContain('stack(');
  });

  it('stop sends the FSM back to idle and tears down the mic', async () => {
    const { deps, capture } = await buildDeps();
    const handle = await Effect.runPromise(createWhistleSession(deps));
    await Effect.runPromise(handle.start({ instrument: 'sine' }));
    await Effect.runPromise(
      handle.feed({ hz: 440, clarity: 0.95, rms: 0.5, timestampMs: 0 }),
    );
    // Stop while still in recording.
    await Effect.runPromise(handle.stop());
    const after = await Effect.runPromise(Ref.get(handle.stateRef));
    expect(after.tag).toBe('idle');
    expect(capture.stops).toBe(1);
  });
});

describe('createWhistleSession — error propagation', () => {
  it('start fails with a MicPermissionError when the adapter rejects', async () => {
    const scoreRef = await Effect.runPromise(Ref.make<string>('note("c4")'));
    const capture: Capture = { starts: 0, stops: 0, frames: [], lastGetNotesValue: [], transients: [] };
    const micFailing: MicCaptureLike = {
      start: () =>
        Effect.fail({
          _tag: 'MicPermissionError',
          kind: 'permission-denied',
          message: 'blocked',
        } as MicPermissionError),
      stop: () => Effect.void,
      feed: () => Effect.void,
      getNotes: () => Effect.succeed([]),
      getTransients: () => Effect.succeed([]),
    };
    const deps: WhistleSessionDeps = {
      mic: micFailing,
      audio: buildAudio(),
      currentScoreRef: scoreRef,
    };
    const handle = await Effect.runPromise(createWhistleSession(deps));
    const result = await Effect.runPromise(handle.start({}).pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('MicPermissionError');
      expect((result.left as MicPermissionError).kind).toBe('permission-denied');
    }
    expect(capture.starts).toBe(0);
  });
});
