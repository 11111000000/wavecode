/**
 * micAudioContext — the ONE AudioContext the microphone path uses,
 * created inside a user gesture.
 *
 * Why this module exists
 * -----------------------
 * WebKit (iOS Safari AND Chrome for iOS — both are WebKit) refuses to
 * start an `AudioContext` that was created outside a user gesture:
 * the context comes up `suspended`, and `resume()` is only allowed
 * while the *transient* user activation is still alive. The
 * activation does NOT survive an `await` — `getUserMedia()` resolves
 * in a later task, after the permission prompt, so by the time the
 * mic stream arrives the gesture is long gone.
 *
 * The consequence is a silent, error-free failure: the context stays
 * suspended, `AnalyserNode.getFloatTimeDomainData()` returns zeroes,
 * and the app looks like it is listening while it hears nothing.
 * That is exactly what the whistle did on the iPhone — the level
 * meter stayed at zero, no note ever appeared, and no error was
 * raised anywhere.
 *
 * The fix is the classic one: create the context AND resume it
 * synchronously inside the click handler, before any `await`. The
 * click handlers call {@link primeMicAudioContext}; the capture code
 * calls {@link takeMicAudioContext} and gets that very context.
 *
 * Why the context is NOT the output context
 * -----------------------------------------
 * `LiveAudioEngine.unlockAudioContext()` owns
 * `window.__wavecodeAudioCtx` — the context Strudel/superdough plays
 * through. The mic context is deliberately separate: a mic stream
 * must never be able to touch the output graph (the sample-bank
 * regression documented in `MicCapture.ts` — sharing made the
 * analyser tap install path get skipped, and the drums stopped
 * playing). The mic context is never connected to `destination`, so
 * it cannot feed back into the speakers.
 *
 * Ownership
 * ---------
 * Whoever *takes* the context owns it and closes it (the whistle
 * capture closes it on `stop()`, the STT level meter closes it on
 * `dispose()`). A context that was primed but never taken is closed
 * by the next {@link primeMicAudioContext} call, so a stray prime
 * cannot leak an AudioContext for the lifetime of the page.
 */

/** The `AudioContext` constructor, with the legacy WebKit prefix. */
const audioContextCtor = (): typeof AudioContext | null => {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const legacy = (globalThis as unknown as {
    readonly webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;
  return legacy ?? null;
};

type PrimedContext = {
  readonly ctx: AudioContext;
  /** Set once somebody took it — the owner closes it from then on. */
  taken: boolean;
};

let primed: PrimedContext | null = null;

/**
 * True when the context is actually processing audio.
 *
 * `state === 'running'` is the only honest answer to "will this
 * context deliver samples?" — a suspended context hands the
 * analyser an array of zeroes.
 */
export const isAudioContextRunning = (ctx: AudioContext): boolean =>
  ctx.state === 'running';

/**
 * Create the mic AudioContext and try to start it.
 *
 * Call this SYNCHRONOUSLY from a click/pointer handler. Creating the
 * context is enough on WebKit (the constructor starts it when the
 * gesture is live); `resume()` is the belt-and-braces for the
 * browsers that come up suspended.
 */
export const createMicAudioContext = (): AudioContext | null => {
  const Ctor = audioContextCtor();
  if (Ctor === null) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      /* the gesture may be gone — the caller reports it */
    });
  }
  return ctx;
};

/**
 * Prime the mic context from inside a user gesture.
 *
 * Safe to call on every press: the previous primed-but-unused context
 * is closed first, so at most one spare context exists at a time.
 */
export const primeMicAudioContext = (): void => {
  if (primed !== null && !primed.taken) {
    void primed.ctx.close().catch(() => {
      /* already closed */
    });
    primed = null;
  }
  const ctx = createMicAudioContext();
  if (ctx === null) return;
  primed = { ctx, taken: false };
};

/**
 * Take the primed context, if there is one.
 *
 * Returns `null` when nobody primed — the caller then creates its
 * own context, which on iOS means it may come up suspended.
 */
export const takeMicAudioContext = (): AudioContext | null => {
  if (primed === null) return null;
  const p = primed;
  primed = null;
  p.taken = true;
  return p.ctx;
};

/**
 * The context the mic path should use: the primed one when there is
 * one, a fresh one otherwise.
 *
 * Prefer this over `takeMicAudioContext()` in code that cannot
 * guarantee it runs inside the gesture (the STT level meter runs
 * after `getUserMedia()` resolves — long after the gesture is gone).
 */
export const ensureMicAudioContext = (): AudioContext | null => {
  const taken = takeMicAudioContext();
  if (taken !== null) return taken;
  return createMicAudioContext();
};

/**
 * Make sure the context is actually running, awaiting the resume.
 *
 * `ctx.resume()` is async: the state flips on the next microtask, so
 * a synchronous `state` check right after the call still says
 * `suspended`. Awaiting it is the only way to tell "starting" from
 * "refused".
 */
export const ensureAudioContextRunning = async (
  ctx: AudioContext,
): Promise<boolean> => {
  if (isAudioContextRunning(ctx)) return true;
  try {
    await ctx.resume();
  } catch {
    /* not allowed — the caller decides what to do about it */
  }
  return isAudioContextRunning(ctx);
};

/** Test-only: drop the primed context and forget it. */
export const __resetMicAudioContextForTests = (): void => {
  primed = null;
};
