import { lazy, type Component } from 'solid-js';
import type { CodeMirrorEditorApi } from './CodeMirrorEditorImpl';

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onReady?: (api: CodeMirrorEditorApi) => void;
};

/**
 * Lazy wrapper вокруг CodeMirrorEditorImpl.
 *
 * CodeMirror 6 (~400KB gzip со всеми extension-ами) подгружается только
 * при первом обращении к score tab. До этого момента пользователь уже
 * видит topbar + preset-row + аудио-pill — initial paint не блокируется
 * парсером/лесером/LSP-ish подсказками CodeMirror.
 *
 * ScorePanel рендерит <CodeMirrorEditor /> как обычный компонент —
 * <Suspense> boundary от Solid автоматически обрабатывает ожидание
 * dynamic-import (Solid render tree = sync, но lazy создаёт
 * Resource-like pending state, который читает родительский Suspense).
 *
 * `lazy` ожидает `{ default: Component }` shape, поэтому маппим named
 * export → default. Тип Props объявлен здесь, чтобы вызывающий код
 * получал IntelliSense даже до загрузки chunk-а.
 */
export const CodeMirrorEditor: Component<Props> = lazy(() =>
  import('./CodeMirrorEditorImpl').then((m) => ({ default: m.CodeMirrorEditor })),
);

export type { CodeMirrorEditorApi };
