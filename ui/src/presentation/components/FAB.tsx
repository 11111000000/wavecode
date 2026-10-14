import type { JSX, ParentProps } from 'solid-js';
import { PlayIcon, StopIcon, RecordIcon } from '../icons';

type Props = ParentProps<{
  onClick: () => void;
  tone?: 'primary' | 'cyan' | 'magenta';
  variant?: 'play' | 'stop' | 'record' | 'plus';
  ariaLabel: string;
  size?: 'default' | 'mini';
  pulse?: boolean;
}>;

/**
 * FAB — Floating Action Button.
 * Default: amber «play», cyan «stop», magenta «record».
 * Mini-вариант: 40x40 (для secondary actions).
 */
export function FAB(props: Props): JSX.Element {
  const icon = (): JSX.Element => {
    if (props.variant === 'play')   return <PlayIcon size={20} />;
    if (props.variant === 'stop')   return <StopIcon size={20} />;
    if (props.variant === 'record') return <RecordIcon size={20} />;
    return <>{props.children}</>;
  };
  return (
    <button
      type="button"
      class={`wc-fab${props.size === 'mini' ? ' wc-fab--mini' : ''}`}
      data-tone={props.tone ?? 'primary'}
      data-state={props.pulse ? 'recording' : 'idle'}
      onClick={() => props.onClick()}
      aria-label={props.ariaLabel}
    >
      {icon()}
    </button>
  );
}
