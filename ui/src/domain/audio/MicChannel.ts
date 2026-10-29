/**
 * Mic channel abstraction: an open owner-side slot for a mic-related
 * resource. Encodes the rule that a single MediaStream (or any
 * "mic-direct" physical capture device) can belong to only one session
 * at a time, while Chrome's built-in `SpeechRecognition` API uses the
 * browser's internal pipeline and coexists with our own AudioContext.
 *
 * This file is intentionally minimal: it is the value layer for the
 * `micChannelMutex` state machine (`micChannelMutex.ts`). No IO, no
 * Effect types here — the application layer wires
 * `Effect.Ref<MicMutexState>` around the pure `acquire`/`release`
 * reducers.
 *
 * Owner kinds
 * -----------
 * The four owners currently in scope map 1:1 to the four FAB/panel
 * entry points declared in `decisions/wavecode-voice-fab.yaml`:
 *   - `voice-ai`      → VoiceAIMiniFAB (mp3 path: STTEngine)
 *   - `whistle`       → WhistleMiniFAB (existing micSnippet flow)
 *   - `loop-recorder` → LoopRecorder panel (mic to loop)
 *   - `midi-learn`    → MIDI learn-assign (mic-triggered mapping)
 *
 * Channel kinds
 * -------------
 *   - `mic-direct`           → a single AudioContext + MediaStream owned
 *                              exclusively by one session.
 *   - `speech-api-internal`  → Chrome's `SpeechRecognition`; the browser
 *                              pipeline (does NOT take our MediaStream),
 *                              so multiple owners are allowed.
 *   - `midi`                 → virtual placeholder (MIDI learn doesn't
 *                              actually capture audio — kept here so the
 *                              future MIDI-derived flow doesn't collide
 *                              with mic-direct and is observable through
 *                              the same state machine).
 */

export type MicChannelKind = 'mic-direct' | 'speech-api-internal' | 'midi';

export type MicChannelOwner =
  | { readonly kind: 'voice-ai'; readonly sessionId: string }
  | { readonly kind: 'whistle'; readonly sessionId: string }
  | { readonly kind: 'loop-recorder'; readonly sessionId: string }
  | { readonly kind: 'midi-learn'; readonly sessionId: string };

export type MicChannel = {
  readonly kind: MicChannelKind;
  readonly owner: MicChannelOwner;
  readonly sessionId: string;
  readonly acquiredAtMs: number;
};

/** Tagged busy-error returned by `acquire` when a single-owner slot is
 *  already taken. Carries the *conflicting* channel so the caller can
 *  decide: cancel it (force-release), show "микрофон занят другим
 *  режимом", or queue the request. */
export type MicBusyError = {
  readonly _tag: 'MicBusy';
  readonly conflictingChannel: MicChannel;
  readonly requestedBy: MicChannelOwner;
};

export const isMicBusyError = (e: unknown): e is MicBusyError =>
  typeof e === 'object'
  && e !== null
  && (e as { readonly _tag?: unknown })._tag === 'MicBusy';

/** Only one mic-direct owner at a time. Enforced by `acquire` in
 *  `micChannelMutex.ts`. Doc constant — not used at runtime. */
export const MIC_DIRECT_SINGLE_OWNER = true as const;

/** Chrome's `SpeechRecognition` uses its own internal audio path and
 *  does not take ownership of the MediaStream we open via
 *  `getUserMedia`. So speech-api-internal channels can co-exist with a
 *  mic-direct owner. Doc constant — not used at runtime. */
export const SPEECH_API_CAN_COEXIST_WITH_MIC_DIRECT = true as const;
