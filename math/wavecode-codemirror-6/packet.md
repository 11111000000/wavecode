---
proposition: |
  Редактор score в wavecode — CodeMirror 6 с кастомным расширением для
  Strudel mini-notation (highlight + completions).
antithesis: |
  Monaco Editor (VS Code engine) даёт IntelliSense, готовый JS-парсер и
  inline error markers — больше готовых фич «из коробки». Альтернатива —
  textarea без подсветки (минимум зависимостей, но плохой DX). CodeMirror 6
  требует писать свои extensions для mini-notation.
synthesis: |
  CodeMirror 6 (~200KB gzip) легче Monaco (~2MB), интегрируется через
  vanilla API в любой фреймворк (Solid, Svelte, vanilla). Tree-sitter
  grammar для JS уже встроена; mini-notation overlay реализуется через
  StateField + Decoration (~100 строк). Completions — статический JSON из
  ~200 Strudel-функций. Monaco избыточен: IntelliSense нам не нужен
  (score-файл редактирует и LLM-агент, и человек; LLM не использует
  IntelliSense; human-валидация через Lint diagnostics).
substrate: none
status: draft
axiom: A3
epistemics:
  - statement: "CodeMirror 6 ~200KB gzip vs Monaco ~2MB"
  - statement: "Monaco React-биндинги (@uiw/react-codemirror) не нужны — vanilla API"
---

## Intent

CodeMirror 6 в `<div ref={editorRef}>` через vanilla `EditorView`. Кастомный
extension для Strudel mini-notation: regex-highlight на `<bd sd>`, `*`, `~`, `[ ]`, `:`.
Completions из статического списка Strudel-функций.

## What this is NOT

- Не Monaco. Monaco тяжелее и не даёт преимуществ для нашего use case.
- Не Ace Editor. Устарел, слабая экосистема.
- Не textarea без подсветки. Mini-notation визуально сложная, нужна подсветка.
- Не ProseMirror / TipTap. Они для rich-text, не для кода.

## Worked example

```ts
// ui/src/presentation/editor/CodeMirrorEditor.ts
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { miniNotationDecorations } from './miniNotationDecorations';
import { strudelCompletions } from './strudelCompletions';

export function mountEditor(parent: HTMLElement, doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      miniNotationDecorations,
      strudelCompletions,
      EditorView.updateListener.of((v) => {
        if (v.docChanged) emit(v.state.doc.toString());
      }),
    ],
  });
  return new EditorView({ state, parent });
}
```

## Notes

- Зависимости: `@codemirror/state`, `@codemirror/view`, `@codemirror/language`,
  `@codemirror/commands`, `@codemirror/search`, `@codemirror/autocomplete`,
  `@codemirror/lint`, `@codemirror/theme-one-dark`, `@lezer/highlight`,
  `@lezer/common`.
- Vite manualChunks выделяет `codemirror` в отдельный chunk для лучшего
  кэширования (см. vite.config.ts).
- Lint diagnostics: `@codemirror/lint` интегрируется с диагностиками из
  `application/lint/` (синтаксис JS + проверка Strudel-pattern).