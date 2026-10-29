/**
 * Voice-AI transcript state: pure value object that accumulates
 * Web Speech API chunks (interim / final) and exposes a UI-friendly
 * view (`interim`, `final`, timings).
 *
 * The transcript reducer in `voiceSession.ts` consumes this, and the
 * intent classifier in `voiceIntentClassifier.ts` reads it to decide
 * routing. The chunk stream itself comes from an `STTEngine`
 * implementation in `application/voice/` — this file owns only the
 * data shape and the merge rules.
 *
 * Why pure
 * --------
 * Two distinct chunk kinds (interim = partial, gets replaced; final =
 * committed) need clearly defined merge semantics so the overlay UI
 * and the LLM router agree on what "the user's utterance" means at
 * every instant. Encoding the merge in a pure reducer makes it
 * trivially testable and replayable from a buffered chunk log.
 *
 * Glossary:
 *   - TranscriptChunk       = one emission from the STT engine
 *   - TranscriptState       = full accumulation so far
 *   - `chunks`              = ordered chunk log (interim + final), kept
 *                             for debugging / history. UI does not
 *                             render this directly.
 *   - `interim`             = text of the most recent interim chunk,
 *                             or '' if the last chunk was final
 *   - `final`               = space-separated concatenation of every
 *                             final chunk's text so far
 *   - `startedAtMs`         = wall-clock ms when the session opened
 *     `stoppedAtMs`         = wall-clock ms when the session closed
 *                             (null until `idle` after applied/error)
 *   - `lang`                = BCP-47 tag the STT engine is using
 */

export type TranscriptLang = 'ru-RU' | 'en-US' | string;

export type TranscriptConfidence = number;

export type TranscriptChunk =
  | {
      readonly kind: 'interim';
      readonly text: string;
      readonly confidence: TranscriptConfidence;
      readonly lang: TranscriptLang;
      readonly timestampMs: number;
    }
  | {
      readonly kind: 'final';
      readonly text: string;
      readonly confidence: TranscriptConfidence;
      readonly lang: TranscriptLang;
      readonly timestampMs: number;
    };

export type TranscriptState = {
  readonly chunks: ReadonlyArray<TranscriptChunk>;
  readonly interim: string;
  readonly final: string;
  readonly startedAtMs: number | null;
  readonly stoppedAtMs: number | null;
  readonly lang: TranscriptLang;
};

/**
 * Default language is `'ru-RU'` because the voice-AI FAB is shipped
 * with Russian voice input by default (see
 * `decisions/wavecode-voice-fab.yaml` outcome
 * `voice-ai-fab-press-and-hold`). Pass an explicit tag for English /
 * other locales.
 *
 * `startedAtMs` is null until the first chunk arrives — the session
 * reducer flips it to wall-clock time on the first chunk event.
 */
export const initialTranscriptState = (
  lang: TranscriptLang = 'ru-RU',
): TranscriptState => ({
  chunks: [],
  interim: '',
  final: '',
  startedAtMs: null,
  stoppedAtMs: null,
  lang,
});

/**
 * Merge one chunk into the transcript.
 *
 * Rules (must match every test in `Transcript.test.ts`):
 *   - Empty text on either kind → noop. STT engines occasionally emit
 *     empty chunks during silence / reconnect, those should not
 *     disturb state.
 *   - kind === 'interim' → append to log; `interim` reflects this
 *     chunk's text; `final` untouched. Two consecutive interims
 *     simply OVERWRITE the `interim` field — only the most recent
 *     interim is surfaced.
 *   - kind === 'final' → append to log; the text becomes the next
 *     entry in `final` (space-joined with a single space; if the new
 *     text starts or ends with whitespace, it's trimmed so we don't
 *     grow double-spaces over a long session); `interim` is cleared.
 *   - `startedAtMs` is stamped on the first non-empty chunk if not
 *     already set.
 *
 * Returns the same object reference when the chunk is a noop so
 * callers can cheaply detect "nothing changed" via referential
 * equality (useful for `createMemo` / Solid signal gating).
 */
export const appendChunk = (
  state: TranscriptState,
  chunk: TranscriptChunk,
): TranscriptState => {
  const text = chunk.text.trim();
  if (text.length === 0) return state;

  if (chunk.kind === 'interim') {
    if (state.interim === text && state.chunks[state.chunks.length - 1] === chunk) {
      return state;
    }
    if (state.interim === text) {
      return {
        ...state,
        chunks: [...state.chunks, chunk],
        startedAtMs: state.startedAtMs ?? chunk.timestampMs,
      };
    }
    return {
      ...state,
      chunks: [...state.chunks, chunk],
      interim: text,
      startedAtMs: state.startedAtMs ?? chunk.timestampMs,
    };
  }

  // chunk.kind === 'final'
  const nextFinal = state.final.length === 0 ? text : `${state.final} ${text}`;
  return {
    ...state,
    chunks: [...state.chunks, chunk],
    final: nextFinal,
    interim: '',
    startedAtMs: state.startedAtMs ?? chunk.timestampMs,
  };
};

/**
 * Mark the session as stopped at `nowMs`. Used by the session
 * reducer on `idle` (after `applied` in non-continuous mode, or
 * after `dismiss` from `errored`). Does NOT clear the transcript
 * — the orchestrator decides whether to retain history.
 */
export const markStopped = (
  state: TranscriptState,
  nowMs: number,
): TranscriptState => (state.stoppedAtMs === nowMs ? state : { ...state, stoppedAtMs: nowMs });

/**
 * The whole take as ONE line of text — what the user sees in the
 * composer's field and what the LLM receives.
 *
 * Why `final` and `interim` are JOINED and not one-or-the-other
 * ---------------------------------------------------------
 * The two fields carry different halves of the same utterance set,
 * and which half depends on the engine:
 *
 *   - `final` accumulates the chunks the engine COMMITTED: one per
 *     finished take (server relay) or one per finished utterance
 *     (Web Speech). It is space-joined and never shrinks.
 *   - `interim` is the engine's LIVE view of the take that is still
 *     being captured. The server relay re-transcribes the audio
 *     accumulated since the last flush, so its interim covers the
 *     current take only; Web Speech reports the partial of the
 *     current utterance.
 *
 * So while a SECOND take is being recorded, `final` holds the first
 * take and `interim` holds the second — showing only one of them
 * loses half of what the user said. `final + interim` is the union,
 * and it never duplicates: within one take the interim REPLACES the
 * previous interim (see `appendChunk`), and the final clears the
 * interim when it lands.
 */
export const transcriptText = (state: TranscriptState): string => {
  const final = state.final.trim();
  const interim = state.interim.trim();
  if (final.length > 0 && interim.length > 0) return `${final} ${interim}`;
  return final.length > 0 ? final : interim;
};
