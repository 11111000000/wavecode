import type { JSX, ParentProps } from 'solid-js';

type Props = ParentProps<{
  tone?: 'idle' | 'running' | 'recording' | 'warn' | 'err' | 'ok' | 'stopped';
  label: string;
}>;

/**
 * LEDPill — компактный status-pill в духе DAW-транспорта.
 * ● idle / ▶ running / ● rec — с pulse для running/recording.
 */
export function LEDPill(props: Props): JSX.Element {
  return (
    <span class="wc-led" data-tone={props.tone ?? 'idle'}>
      {props.label}
    </span>
  );
}
