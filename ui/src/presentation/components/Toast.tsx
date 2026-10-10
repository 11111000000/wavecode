import type { JSX, ParentProps } from 'solid-js';
import { Show, createSignal, onCleanup, onMount } from 'solid-js';

type Props = ParentProps<{
  message: string;
  tone?: 'idle' | 'ok' | 'warn' | 'err';
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}>;

/**
 * Toast — non-modal notification, auto-dismiss.
 * В отличие от chat-status, toast перекрывает UI и привлекает внимание.
 */
export function Toast(props: Props): JSX.Element | null {
  const [show, setShow] = createSignal(true);
  let timer: number | undefined;

  onMount(() => {
    const ms = props.durationMs ?? 4000;
    if (ms > 0) {
      timer = window.setTimeout(() => setShow(false), ms);
    }
    onCleanup(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
  });

  return (
    <Show when={show()}>
      <div class="wc-toast" data-tone={props.tone ?? 'idle'} role="status" aria-live="polite">
        <span>{props.message}</span>
        {props.children}
        {props.actionLabel && props.onAction ? (
          <button
            type="button"
            class="wc-toast__action"
            onClick={() => {
              props.onAction!();
              setShow(false);
            }}
          >
            {props.actionLabel}
          </button>
        ) : null}
      </div>
    </Show>
  );
}
