/**
 * Event-name + payload type for the `wavecode:sample-progress`
 * CustomEvent. Lives in its own file so presentation-layer modules
 * (SampleProgressBadge, Toast) can import the constant WITHOUT
 * transitively pulling in `@strudel/webaudio` (which is heavy and
 * pulls @kabelsalat/web → Vitest cannot load it).
 *
 * SampleLoader dispatches this event on `window` after every buffer
 * load and once on bank completion.
 */

export type SampleProgressStatus = 'idle' | 'loading' | 'loaded' | 'error';

export type SampleProgressEvent = {
  readonly loaded: number;
  readonly total: number;
  readonly status: SampleProgressStatus;
};

export const SAMPLE_PROGRESS_EVENT = 'wavecode:sample-progress';