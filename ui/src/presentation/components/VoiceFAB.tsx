import { type JSX } from 'solid-js';
import { VoiceAIMiniFAB } from './VoiceAIMiniFAB';
import { RecordingPanel } from './RecordingPanel';

/**
 * VoiceFAB — the voice-input cluster in the bottom-right corner of
 * the editor.
 *
 * ONE floating control
 * -------------------
 * There used to be two: `VoiceAIMiniFAB` («Голос») and
 * `WhistleMiniFAB` («Свист»), stacked above each other. Both opened
 * the microphone, and the second one did the same work as the Mic
 * bottom sheet — which already had an instrument picker, a slot
 * picker («в конец» / «под курсор»), a live piano-roll and a
 * preview. Two buttons, one device, two ways to say the same thing.
 *
 * The whistle path is now the Mic sheet and nothing else. What is
 * left is a single button with a single meaning: press to record,
 * press again to stop. The dock below it (`RecordingPanel`) carries
 * the transcript and the one action that follows it.
 *
 * What happened to the old speed-dial
 * ----------------------------------
 * A big primary FAB that expanded into the stack was tried and
 * rejected: «жму микрофон — открывается ещё одна кнопка с
 * микрофоном, непонятно что вообще происходит». The stack was the
 * fix. The stack is gone because there is only one thing left to
 * stack.
 *
 * `VoiceTranscriptOverlay` (the old transcript chip) and
 * `VoiceAITextReview` (the old modal review) are both gone too — the
 * dock replaced them.
 */
export function VoiceFAB(): JSX.Element {
  return (
    <>
      <div class="voice-fab-group">
        <div class="voice-mini-fab-stack">
          <VoiceAIMiniFAB />
        </div>
      </div>
      <RecordingPanel />
    </>
  );
}
