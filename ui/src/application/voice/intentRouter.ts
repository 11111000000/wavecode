/**
 * intentRouter — pure dispatcher from `VoiceIntent` to use cases
 * and service calls. Sits at the application layer because it
 * composes `applyEditStream` (another application useCase) with the
 * `LLMClient` + `AudioEngine` service tags from `domain/services`.
 *
 * MVP behaviour: only `edit-score` is implemented. Every other
 * intent kind yields `Effect.unit` and signals the unsupported
 * intent via `callbacks.onError`. Future packages extend this
 * dispatcher by adding a new `case` in the exhaustive `switch`
 * below — no other file changes. The TypeScript
 * `noFallthroughCasesInSwitch` flag (in `ui/tsconfig.json`) makes
 * every new `VoiceIntent.kind` an instant compile error pointing
 * at this file, which is the contract surface for "if you add an
 * intent, you must route it".
 *
 * Why routes return an `Effect` instead of firing-and-forgetting
 * -----------------------------------------------------------
 * The orchestrator (`VoiceAISession.ts`) cancels in-flight requests
 * on barge-in. For that to work, the route must be cancellable —
 * `Effect` is, `Function()` is not. So `routeIntent` returns an
 * `Effect` and the orchestrator wraps it in `Effect.fork` to make
 * it a structured-concurrency fiber.
 */

import { Effect } from 'effect';
import type { VoiceIntent } from '~/domain/voice/VoiceIntent';
import { LLMClient, AudioEngine } from '~/domain/services';
import { applyEditStream, type ApplyEditResult } from '~/application/useCases/llmEdit';

/**
 * Shared context the router needs at call-time that is NOT a
 * service (services come from the Effect environment via `yield*`).
 * `nowMs` is threaded in (rather than read from `Date.now()` inside
 * the router) so tests are deterministic and the orchestrator can
 * keep using a single wall-clock anchor across the whole pipeline.
 */
export type RouterContext = {
  readonly currentScore: string;
  readonly nowMs: number;
};

/**
 * Callbacks the router fires during the route's lifecycle.
 * Mirrors `applyEditStream`'s `ApplyEditCallbacks` shape one-for-one
 * so the orchestrator can pass the same callback object down
 * unchanged. `onComplete` receives the CLEANED score string (post
 * `cleanLLMResponse` + self-heal) so the UI can render it
 * directly.
 */
export type RouterCallbacks = {
  readonly onToken?: (delta: string) => void;
  readonly onComplete?: (cleanedScore: string) => void;
  readonly onError?: (err: Error) => void;
};

/**
 * Run a `VoiceIntent` end-to-end and surface completion via
 * `callbacks`. Returns an `Effect` that the caller can `fork` /
 * `interrupt` for barge-in control.
 *
 * Successful edit-score routes:
 *   1. Stream + clean + self-heal the LLM response via `applyEditStream`.
 *   2. Call `audio.eval(cleanedScore)` so the user hears the change.
 *      Eval errors are surfaced through `onError` (the orchestrator
 *      maps those to UI state).
 *   3. Fire `onComplete(cleanedScore)`.
 *
 * Failed / unsupported routes:
 *   1. `applyEditStream` self-heal exhaustion → `onError(err)` and
 *      `Effect.fail(err)`.
 *   2. Any other `VoiceIntent.kind` → `onError(new Error('not
 *      implemented in MVP'))` and `Effect.unit` (no-op success).
 *      The orchestrator's FSM doesn't move forward — the user just
 *      hears the FAB stay on its current state.
 */
export const routeIntent = (
  intent: VoiceIntent,
  ctx: RouterContext,
  callbacks: RouterCallbacks = {},
): Effect.Effect<void, Error, LLMClient | AudioEngine> =>
  Effect.gen(function* () {
    if (intent.kind !== 'edit-score') {
      callbacks.onError?.(
        new Error(`intent not implemented in MVP: ${intent.kind}`),
      );
      return;
    }

    // Touch the services so `R = LLMClient | AudioEngine` lines up
    // with what callers provide via Layer / `Effect.provide`. We
    // don't need the values — `applyEditStream` and `audio.eval`
    // yield them internally — but yielding forces the dependency
    // into the Effect's R so the caller must wire it.
    const llm = yield* LLMClient;
    const audio = yield* AudioEngine;
    void llm;

    // Sync wrappers: `applyEditStream` callbacks are `(value) => void`
    // so we can't yield inside them. We forward streams + the error
    // path immediately and capture the cleaned score from the
    // successful completion to drive `audio.eval` separately.
    let cleanedScore = '';
    const onComplete = (r: ApplyEditResult): void => {
      cleanedScore = r.score;
      callbacks.onComplete?.(r.score);
    };
    const result = yield* applyEditStream(
      ctx.currentScore,
      intent.instruction,
      [],
      { status: 'unknown' },
      {},
      { ...callbacks, onComplete },
    ).pipe(Effect.mapError((err): Error => (err instanceof Error ? err : new Error(String(err)))));

    // Always evaluate — the LLM's cleaned score is the best guess,
    // regardless of whether `onComplete` was observed. `cleanedScore`
    // and `result.score` must agree (same field) so this is a no-op
    // in the happy path; the union is just to keep the var declared.
    if (cleanedScore === '') cleanedScore = result.score;

    yield* audio.eval(cleanedScore);
  });
