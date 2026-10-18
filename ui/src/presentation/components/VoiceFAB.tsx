import { Show, createSignal, type JSX } from 'solid-js';
import { FAB } from './FAB';
import { VoiceAIMiniFAB } from './VoiceAIMiniFAB';
import { WhistleMiniFAB } from './WhistleMiniFAB';
import { VoiceTranscriptOverlay } from './VoiceTranscriptOverlay';
import { voiceAIState } from '../state/voiceAIStore';
import { whistleState } from '../state/whistleStore';
import { MicIcon } from '../icons';

/**
 * VoiceFAB — top-level floating action button group that hosts the
 * voice-AI and whistle mini-FABs as a speed-dial.
 *
 *   - Tap-once-to-expand, tap-again-to-collapse.
 *   - Auto-expands while either voice-AI or whistle is in a
 *     non-idle state so the user sees the controls when something
 *     is happening.
 *
 * Always renders the primary `MicIcon` FAB; the mini-FABs render
 * conditionally inside `<Show>` keyed on `expanded() || isActive()`.
 */
export function VoiceFAB(): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);

  const isActive = (): boolean => {
    return voiceAIState().tag !== 'idle'
      || whistleState().tag !== 'idle';
  };

  const isOpen = (): boolean => expanded() || isActive();

  const onPrimaryClick = (): void => {
    setExpanded((v) => !v);
  };

  return (
    <>
      <div class="voice-fab-group" data-expanded={isOpen() ? 'true' : 'false'}>
        <Show when={isOpen()}>
          <div class="voice-mini-fab-stack voice-mini-fab-stack--top">
            <VoiceAIMiniFAB />
            <WhistleMiniFAB />
          </div>
        </Show>
        <FAB
          variant="voice"
          tone="primary"
          ariaLabel={isOpen() ? 'Скрыть голосовые режимы' : 'Голосовое управление'}
          onClick={onPrimaryClick}
          pulse={isActive()}
        >
          <MicIcon size={20} />
        </FAB>
      </div>
      <VoiceTranscriptOverlay />
    </>
  );
}
