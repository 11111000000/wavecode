/**
 * Rule-based voice-intent classifier (MVP).
 *
 * Takes the current `TranscriptState` and a `ClassifierContext`,
 * returns a `ClassificationResult`. The MVP implementation makes
 * exactly one decision: "is there a finalised utterance, and is it
 * confident enough to route to the LLM-edit path?". Everything else
 * returns a typed-failure result so the orchestrator can show
 * appropriate UI ("не расслышал", "повторите", etc.).
 *
 * Why rule-based first (not LLM-in-the-loop)
 * ------------------------------------------
 * The classifier sits in `domain/`, which MUST stay free of
 * `@ai-sdk/*` / `idb-keyval` / `effect/platform` imports — the
 * dependency-direction rule (see `ui/eslint.config.js`) prevents an
 * LLM call from here. Routing decisions also need to be cheap and
 * synchronous so the barge-in reducer can fire inside the same
 * micro-tick as a final chunk.
 *
 * Future packages will swap this function for an LLM-routed
 * classifier (model picks one of the seven VoiceIntent kinds) and
 * possibly thread additional context (`currentScore`) into the
 * prompt. The signature is the public contract — adding routes
 * must NOT require callers to change. See
 * `decisions/wavecode-voice-fab.yaml` outcome
 * `extension-points-stable`.
 */

import type { TranscriptState } from './Transcript';
import type { VoiceIntent } from './VoiceIntent';

export type ClassifierContext = {
  /** Wall-clock ms at the moment of classification. Used to stamp
   *  `timestampMs` on the emitted intent so downstream metrics
   *  (barge-in latency, end-to-end latency) have a stable anchor. */
  readonly now: number;
  /** Current Strudel score text. Reserved for future
   *  LLM-router versions that need to look at "is there a stack?"
   *  to disambiguate, e.g., "play" (transport) vs "play the bass"
   *  (edit-score). The MVP rule-based classifier ignores this. */
  readonly currentScore: string;
  /** From voice settings. Default `'replace'` means a new utterance
   *  cancels the previous one (barge-in). The classifier itself
   *  doesn't act on this — the session reducer does — but the
   *  field lives on the context so future LLM-routed versions can
   *  decide e.g. "queue" mode = paraphrase-then-append rather than
   *  overwrite. */
  readonly bargeInMode: 'replace' | 'queue' | 'ignore';
};

export type ClassificationResult =
  | { readonly ok: true; readonly intent: VoiceIntent }
  | {
      readonly ok: false;
      readonly reason: 'no-speech' | 'too-low-confidence' | 'unrecognized';
    };

/**
 * Minimum confidence the MVP requires to route to the LLM-edit
 * path. Below this we surface "не расслышал" rather than spending a
 * token round-trip on a half-formed utterance. Tuneable in future
 * but kept literal here so tests pin the value.
 */
export const MIN_CONFIDENCE = 0.5;

/**
 * Compute the confidence for the routing decision.
 *
 * We use the LAST `final` chunk's confidence if there is any final
 * chunk in `state.chunks`; otherwise we average the interims
 * (webkitspeech emits low-confidence interim partials, so the
 * average is usually well below MIN_CONFIDENCE for noise).
 *
 * This must stay pure: no `chunk.confidence` mutation, no Date.now.
 */
const aggregateConfidence = (state: TranscriptState): number => {
  let lastFinal: number | null = null;
  let interimSum = 0;
  let interimCount = 0;
  for (const c of state.chunks) {
    if (c.kind === 'final') {
      lastFinal = c.confidence;
    } else {
      interimSum += c.confidence;
      interimCount += 1;
    }
  }
  if (lastFinal !== null) return lastFinal;
  if (interimCount > 0) return interimSum / interimCount;
  return 0;
};

/**
 * Classify the current transcript.
 *
 * Decision tree:
 *   1. `state.final.trim()` is empty → `{ ok: false, reason: 'no-speech' }`.
 *      Even an interim-only transcript is "no speech" for routing
 *      purposes — we don't act on partials.
 *   2. aggregated confidence < MIN_CONFIDENCE → `{ ok: false, reason: 'too-low-confidence' }`.
 *   3. Otherwise → `{ ok: true, intent: EditScoreIntent }` with
 *      `instruction = state.final.trim()`. Every finalised utterance
 *      in the MVP is treated as an LLM-edit instruction.
 *
 * The signature returns `ok: false | true`, not an exception, so the
 * session reducer can switch on it without try/catch (the orchestrator
 * maps the reason to UI).
 */
export const classifyTranscript = (
  transcript: TranscriptState,
  ctx: ClassifierContext,
): ClassificationResult => {
  const instruction = transcript.final.trim();
  if (instruction.length === 0) {
    return { ok: false, reason: 'no-speech' };
  }
  const confidence = aggregateConfidence(transcript);
  if (confidence < MIN_CONFIDENCE) {
    return { ok: false, reason: 'too-low-confidence' };
  }
  // currentScore and bargeInMode are reserved for future LLM-routed
  // versions; the MVP intentionally ignores them but the type
  // signature forces callers to surface them so the contract is
  // stable when we swap implementations.
  void ctx.currentScore;
  void ctx.bargeInMode;
  return {
    ok: true,
    intent: {
      kind: 'edit-score',
      instruction,
      confidence,
      timestampMs: ctx.now,
    },
  };
};
