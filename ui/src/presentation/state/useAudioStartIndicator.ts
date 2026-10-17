import { createSignal, onMount, onCleanup, type Accessor } from 'solid-js';

const POLL_MS = 200;
const SAFETY_TIMEOUT_MS = 2000;

export type CtxStateLike = { readonly state: string; readonly sampleRate: number | null };

export const useAudioStartIndicator = (
  ctxState: () => CtxStateLike,
): readonly [Accessor<boolean>, (next: boolean) => void] => {
  const [audioStarting, setAudioStarting] = createSignal(false);

  onMount(() => {
    const intervalId = window.setInterval(() => {
      if (ctxState().state === 'running' && audioStarting()) {
        setAudioStarting(false);
      }
    }, POLL_MS);
    const timeoutId = window.setTimeout(() => {
      if (audioStarting() && ctxState().state !== 'running') {
        setAudioStarting(false);
      }
    }, SAFETY_TIMEOUT_MS);
    onCleanup(() => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    });
  });

  return [audioStarting, setAudioStarting] as const;
};
