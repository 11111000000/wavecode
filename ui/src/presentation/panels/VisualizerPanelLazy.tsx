import { lazy, type Component } from 'solid-js';

/**
 * Lazy wrapper вокруг VisualizerPanel.
 *
 * VisualizerPanel (~14 KB raw, ~5 KB gz) — canvas-scope визуализация
 * для wavecode (spectrum / wave / radial / beat modes + track-overview
 * ribbon). Большинство пользователей открывают её только когда уже
 * наигрались — нет смысла грузить её JS в cold-start bundle.
 *
 * Импортируется из `BottomSheets.tsx` через `<Suspense>` boundary
 * (Solid render-tree синхронный, но `lazy()` создаёт Resource-like
 * pending state, который родительский `<Suspense>` подхватывает
 * автоматически). Первое открытие вкладки `Визуализация` запускает
 * `import('./VisualizerPanel')`, после этого chunk кешируется в
 * ServiceWorker (workbox `CacheFirst` для `assets/*.js`, см.
 * vite.config.ts).
 *
 * `lazy` ожидает `{ default: Component }` shape, поэтому маппим named
 * export → default, как в `CodeMirrorEditor.tsx` (уже используется
 * этот паттерн — симметрия).
 */
export const VisualizerPanelLazy: Component = lazy(() =>
  import('./VisualizerPanel').then((m) => ({ default: m.VisualizerPanel })),
);