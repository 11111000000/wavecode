import { splitProps, type Component } from 'solid-js';

type Props = {
  tone?: 'amber' | 'cyan' | 'magenta';
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onInput: (v: number) => void;
  ariaLabel?: string;
};

/**
 * BigSlider — touch-friendly slider с glow-thumb.
 * Height: 48px (touch-target). Track height 6px, thumb 28×28.
 */
export const BigSlider: Component<Props> = (props) => {
  const [local] = splitProps(props, ['value', 'onInput', 'min', 'max', 'step', 'ariaLabel', 'tone']);
  const handle = (e: Event & { currentTarget: HTMLInputElement }): void => {
    local.onInput(parseFloat(e.currentTarget.value));
  };
  return (
    <input
      type="range"
      class="wc-slider-big"
      data-tone={local.tone ?? 'amber'}
      min={local.min ?? 0}
      max={local.max ?? 1}
      step={local.step ?? 0.01}
      value={local.value}
      onInput={handle}
      aria-label={local.ariaLabel}
    />
  );
};
