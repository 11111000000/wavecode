import { Show, type JSX } from 'solid-js';
import {
  voiceAIState,
  voiceAITranscript,
} from '../state/voiceAIStore';

/**
 * VoiceTranscriptOverlay — floating transcript display above the
 * FAB group. Visible only while voice-AI is active (or errored).
 *
 *   - `listening` / `transcribing` → 🎙️ слышу: <interim|final>
 *   - `errored`                   → ⚠ <error message>
 *   - everything else             → hidden
 *
 * Position: floating bottom-center, just above the FAB. CSS in
 * `ui/src/styles/components.css` provides the
 * `.voice-transcript-overlay` rules so overlay stays out of the
 * critical UI (TabBar, panels, FAB).
 */
export function VoiceTranscriptOverlay(): JSX.Element {
  return (
    <Show
      when={(() => {
        const tag = voiceAIState().tag;
        return tag === 'listening'
          || tag === 'transcribing'
          || tag === 'requesting'
          || tag === 'applying'
          || tag === 'errored';
      })()}
    >
      <div class="voice-transcript-overlay" data-state={voiceAIState().tag}>
        <Show
          when={voiceAIState().tag !== 'errored'}
          fallback={
            <>
              <span class="voice-transcript-overlay__icon">⚠</span>
              <span class="voice-transcript-overlay__error">
                {(() => {
                  const s = voiceAIState();
                  return s.tag === 'errored'
                    ? s.error
                    : 'Ошибка голосового ввода';
                })()}
              </span>
            </>
          }
        >
          <span class="voice-transcript-overlay__icon">🎙️</span>
          <span class="voice-transcript-overlay__text">
            {voiceAITranscript().interim
              || voiceAITranscript().final
              || '…'}
          </span>
        </Show>
      </div>
    </Show>
  );
}
