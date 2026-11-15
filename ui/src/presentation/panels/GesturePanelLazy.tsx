import { lazy, type Component } from 'solid-js';

/**
 * Lazy wrapper around GesturePanel.
 *
 * The gesture feature is opt-in: the camera (and the MediaPipe tracker
 * behind it) is only touched when the user opens the panel AND flips the
 * «Управление руками» toggle. Keeping the panel in its own chunk means the
 * cold-start bundle does not carry the tracker glue for users who never
 * raise a hand.
 *
 * `lazy` expects a `{ default: Component }` shape, so the named export is
 * mapped to `default` — the same pattern as `VisualizerPanelLazy.tsx` and
 * `CodeMirrorEditor.tsx`.
 */
export const GesturePanelLazy: Component = lazy(() =>
  import('./GesturePanel').then((m) => ({ default: m.GesturePanel })),
);
