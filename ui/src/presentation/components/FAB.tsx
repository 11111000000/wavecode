import type { JSX, ParentProps } from 'solid-js';
import { PlayIcon, StopIcon, RecordIcon, MicIcon, WhistleIcon } from '../icons';

type Props = ParentProps<{
  onClick: () => void;
  tone?: 'primary' | 'cyan' | 'magenta';
  variant?: 'play' | 'stop' | 'record' | 'plus' | 'voice' | 'whistle';
  ariaLabel: string;
  size?: 'default' | 'mini';
  pulse?: boolean;
}>;

/**
 * FAB — Floating Action Button.
 *
 * Variants:
 *   - `play`     amber «play» glyph (default)
 *   - `stop`     cyan «stop» square
 *   - `record`   magenta «record» circle
 *   - `plus`     children-only (decoration slot)
 *   - `voice`    mic glyph for the voice-AI mini-FAB
 *   - `whistle`  eighth-note glyph for the whistle mini-FAB
 *
 * Backward-compatible: existing call sites that pass
 * `variant: 'play'` (or omit it) keep working unchanged.
 *
 * Mini variant = 40x40 for secondary actions.
 */
export function FAB(props: Props): JSX.Element {
  const icon = (): JSX.Element => {
    if (props.variant === 'play')   return <PlayIcon size={20} />;
    if (props.variant === 'stop')   return <StopIcon size={20} />;
    if (props.variant === 'record') return <RecordIcon size={20} />;
    if (props.variant === 'voice')  return <MicIcon size={20} />;
    if (props.variant === 'whistle') return <WhistleIcon size={20} />;
    return <>{props.children}</>;
  };
  return (
    <button
      type="button"
      class={`wc-fab${props.size === 'mini' ? ' wc-fab--mini' : ''}`}
      data-tone={props.tone ?? 'primary'}
      data-variant={props.variant ?? 'play'}
      data-state={props.pulse ? 'recording' : 'idle'}
      onClick={() => props.onClick()}
      aria-label={props.ariaLabel}
    >
      {icon()}
    </button>
  );
}
