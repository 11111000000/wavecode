import type { JSX, ParentProps } from 'solid-js';

type Props = ParentProps<{
  onClick: () => void;
  ariaLabel: string;
  tone?: 'primary' | 'cyan' | 'magenta' | 'ghost';
  active?: boolean;
  badge?: number;
  size?: 'default' | 'lg';
}>;

/**
 * IconButton — 44×44 touch-friendly icon button.
 * Используется во всех местах, где emoji-icon раньше.
 */
export function IconButton(props: Props): JSX.Element {
  return (
    <button
      type="button"
      class="wc-icon-btn"
      data-tone={props.tone ?? 'ghost'}
      data-active={props.active ? 'true' : 'false'}
      data-size={props.size}
      onClick={() => props.onClick()}
      aria-label={props.ariaLabel}
      aria-pressed={props.active}
    >
      {props.children}
      {props.badge !== undefined && props.badge > 0 ? (
        <span class="wc-icon-btn__badge">{props.badge}</span>
      ) : null}
    </button>
  );
}
