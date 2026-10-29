/**
 * Voice intent tagged union: every routing decision the voice-AI
 * pipeline can produce lands here as one of seven `kind`s. The
 * classifier (`voiceIntentClassifier.ts`) emits one, and the
 * application-layer `intentRouter` consumes them.
 *
 * Why a tagged union (not inheritance / interfaces)
 * -------------------------------------------------
 * The router dispatches on `kind` and is exhaustive by construction
 * (TypeScript's `noFallthroughCasesInSwitch` is set in tsconfig).
 * Adding a new intent type = add a case to the union + a route in
 * the router. Adding a new intent type via interface inheritance
 * would force a runtime `instanceof` check that breaks across
 * module boundaries; the tagged union survives `structuredClone`,
 * `postMessage`, and Effect's serialisation for free.
 *
 * `confidence` (where present) is the STT engine's own word-level
 * confidence for the utterance. The router may use it to decide
 * whether to confirm "did you mean X?" before executing a
 * destructive intent. `timestampMs` is always wall-clock from
 * `classifierCtx.now`.
 *
 * Glossary:
 *   - EditScoreIntent  = "make the score do X" (LLM-edit path)
 *   - ClarifyIntent    = "I don't understand, ask the user"
 *   - TransportIntent  = play / stop / pause / set CPS
 *   - PresetIntent     = load / save / delete a preset
 *   - SystemIntent     = undo / redo / reset score
 *   - WhistleIntent    = capture / commit / cancel a whistle snippet
 *   - HelpIntent       = open help / search docs for `query`
 */

export type EditScoreIntent = {
  readonly kind: 'edit-score';
  readonly instruction: string;
  readonly confidence: number;
  readonly timestampMs: number;
};

export type ClarifyIntent = {
  readonly kind: 'clarify';
  readonly question: string;
  readonly timestampMs: number;
};

export type TransportIntent = {
  readonly kind: 'transport';
  readonly action: 'play' | 'stop' | 'pause';
  readonly value?: number;
  readonly timestampMs: number;
};

export type PresetIntent = {
  readonly kind: 'preset';
  readonly action: 'load' | 'save' | 'delete';
  readonly target: string;
  readonly timestampMs: number;
};

export type SystemIntent = {
  readonly kind: 'system';
  readonly action: 'undo' | 'redo' | 'reset';
  readonly timestampMs: number;
};

export type WhistleIntent = {
  readonly kind: 'whistle';
  readonly mode: 'capture' | 'commit' | 'cancel';
  readonly timestampMs: number;
};

export type HelpIntent = {
  readonly kind: 'help';
  readonly query: string;
  readonly timestampMs: number;
};

export type VoiceIntent =
  | EditScoreIntent
  | ClarifyIntent
  | TransportIntent
  | PresetIntent
  | SystemIntent
  | WhistleIntent
  | HelpIntent;

// One type guard per case. These exist so consumers can do
// `if (isEditScoreIntent(intent)) { ... }` and have TypeScript narrow
// the rest of the block. They're cheap (single object-shape check)
// and let us exhaustively switch without `as` casts.

export const isEditScoreIntent = (i: VoiceIntent): i is EditScoreIntent =>
  i.kind === 'edit-score';

export const isClarifyIntent = (i: VoiceIntent): i is ClarifyIntent =>
  i.kind === 'clarify';

export const isTransportIntent = (i: VoiceIntent): i is TransportIntent =>
  i.kind === 'transport';

export const isPresetIntent = (i: VoiceIntent): i is PresetIntent =>
  i.kind === 'preset';

export const isSystemIntent = (i: VoiceIntent): i is SystemIntent =>
  i.kind === 'system';

export const isWhistleIntent = (i: VoiceIntent): i is WhistleIntent =>
  i.kind === 'whistle';

export const isHelpIntent = (i: VoiceIntent): i is HelpIntent =>
  i.kind === 'help';
