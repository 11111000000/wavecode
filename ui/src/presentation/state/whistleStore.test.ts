import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Ref } from 'effect';
import {
  whistleState,
  whistleError,
  setWhistleState,
  startWhistle,
  commitWhistle,
  stopWhistle,
  __setWhistleHandleForTests,
  __resetWhistleForTests,
} from './whistleStore';
import type { WhistleSessionHandle } from '~/application/voice/WhistleSession';
import type { WhistleSessionState } from '~/domain/audio/whistleSession';
import { initialWhistleSession } from '~/domain/audio/whistleSession';
import { acquireMic, releaseMic } from './micMutexStore';

/**
 * whistleStore tests — exercise the presentation-layer wrapping of
 * the application `WhistleSession` orchestrator. The fake handle
 * mirrors the production `initWhistle` subscribe-to-stream behaviour
 * by calling `setWhistleState` synchronously after each transition,
 * so the public signals reflect the FSM just like a real run.
 *
 * Coverage:
 *   1. Initial state — idle / null error.
 *   2. Start/stop lifecycle walks the FSM via the fake handle.
 *   3. Commit walks back to idle.
 *   4. Mic-direct contention: a second start fails with MicBusyError
 *      when another mic-direct owner holds the channel.
 */

/** Build a minimal handle whose transitions update the Solid signal
 *  directly (mirrors the production stream subscription in
 *  `initWhistle`). */
const installFake = (): WhistleSessionHandle => {
  const stateRef = Ref.unsafeMake<WhistleSessionState>(initialWhistleSession());
  const setState = (next: WhistleSessionState): void => {
    Effect.runSync(Ref.set(stateRef, next));
    setWhistleState(next);
  };
  const handle: WhistleSessionHandle = {
    stateRef,
    start: () =>
      Effect.sync(() => {
        setState({
          tag: 'recording',
          micState: {
            openNote: null,
            notes: [],
            lastClosedMs: null,
            notesPrunedCount: 0,
          },
          startedAtMs: 0,
          lastFrameMs: 0,
        });
      }),
    stop: () =>
      Effect.sync(() => {
        setState({ tag: 'idle' });
      }),
    feed: () => Effect.void,
    commit: () =>
      Effect.sync(() => {
        setState({ tag: 'idle' });
      }),
    stream: Effect.runSync(
      Effect.succeed(
        (async function* () {
          yield* [];
        })() as never,
      ),
    ) as never,
  } as WhistleSessionHandle;
  __setWhistleHandleForTests(handle);
  return handle;
};

beforeEach(() => {
  __resetWhistleForTests();
});

describe('whistleStore — initial state', () => {
  it('starts in the idle tag with null error', () => {
    expect(whistleState().tag).toBe('idle');
    expect(whistleError()).toBeNull();
  });
});

describe('whistleStore — start / stop lifecycle', () => {
  it('start walks the FSM to recording, stop returns to idle', async () => {
    installFake();
    await Effect.runPromise(startWhistle({ sessionId: 'sess-1' }));
    expect(whistleState().tag).toBe('recording');

    await Effect.runPromise(stopWhistle());
    expect(whistleState().tag).toBe('idle');
  });

  it('commit returns to idle after a recording session', async () => {
    installFake();
    await Effect.runPromise(startWhistle({ sessionId: 'sess-c1' }));
    await Effect.runPromise(commitWhistle());
    expect(whistleState().tag).toBe('idle');
  });
});

describe('whistleStore — mic mutex contention', () => {
  it('start fails with MicBusyError when another mic-direct owner holds the channel', async () => {
    installFake();
    acquireMic({
      kind: 'mic-direct',
      owner: { kind: 'loop-recorder', sessionId: 'loop-1' },
      sessionId: 'loop-1',
    });
    try {
      let captured: unknown = null;
      await Effect.runPromise(
        startWhistle({ sessionId: 'whistle-1' }).pipe(
          Effect.catchAll((err) => {
            captured = err;
            return Effect.void;
          }),
        ),
      );
      expect(captured).not.toBeNull();
      expect((captured as { readonly _tag?: string })._tag).toBe('MicBusy');
    } finally {
      releaseMic('loop-1');
    }
  });
});
