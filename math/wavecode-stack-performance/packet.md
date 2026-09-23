---
proposition: |
  UI-слой wavecode использует Solid.js 1.8 вместо React для достижения
  максимальной производительности и минимального потребления ресурсов
  в сценарии live-coding с LLM-стримом.
antithesis: |
  React имеет крупнейшую экосистему готовых компонентов и самый
  большой пул разработчиков. Solid.js требует писать больше своего
  кода (нет готовых resizable-panels, dropdowns, dialogs) и его
  сигнальная модель менее привычна React-разработчикам. Если
  бы мы делали типовой CRUD-админку, React был бы прагматичнее.
synthesis: |
  Live-coding с AI-агентом — это сценарий с частыми малыми обновлениями
  UI (LLM-стрим по чанкам, live-обновление score при edit_score,
  hot-reload паттернов из Strudel runtime). Fine-grained реактивность
  Solid обновляет конкретные DOM-узлы без virtual-DOM diff — это
  быстрее React на порядок в таких сценариях. Bundle ~7 KB против
  ~40 KB у React+ReactDOM. Экосистема нам не нужна: пишем свои
  компоненты (панели, чат, редактор — всё специфично). Если
  понадобится — `@solidjs/testing-library` для тестов, минимум
  усилий для миграции. State management через встроенный
  `solid-js/store` (createStore / createSignal) — отдельная
  зависимость не нужна.
substrate: none
status: draft
axiom: A4
epistemics:
  - statement: "use case — live-coding с LLM-стримом, частые обновления UI"
    marker: judgment
    evidence: "оператор 2026-09-23 в opencode-сессии: 'Интерфейс должен быть максимально быстр'"
  - statement: "Solid.js быстрее React на fine-grained обновлениях"
    marker: hypothesis
    evidence: "бенчмарки Solid.js (https://krausest.github.io/js-framework-benchmark/) показывают преимущество в сценариях с частыми малыми обновлениями, но не измерено на нашем конкретном use case"
  - statement: "Bundle Solid ~7 KB vs React+ReactDOM ~40 KB"
    marker: fact
    evidence: "npm package size на январь 2026"
---

## Intent

UI рендерится через Solid.js. Fine-grained реактивность, минимум
runtime overhead, максимальная скорость обновления UI в сценарии
live-coding с AI-агентом.

## What this is NOT

- Не React. Заменён на Solid.
- Не Preact (рассматривался как альтернатива для React-совместимости,
  отклонён в пользу Solid для максимальной производительности).
- Не использует JSX runtime от React (использует `solid-js` JSX).
- Не использует Zustand / Jotai / Redux — встроенный `solid-js/store`.

## Worked example

```tsx
// presentation/components/ChatMessage.tsx (Solid)
import { createSignal, createEffect, For } from 'solid-js';

export function ChatMessage(props: { msg: Message }) {
  return (
    <div class="chat-message">
      <span class="role">{props.msg.role}</span>
      <p>{props.msg.content}</p>
    </div>
  );
}

// presentation/state/chat.ts (solid-js/store)
import { createStore } from 'solid-js/store';

export const [chatState, setChatState] = createStore({
  messages: [] as Message[],
  streaming: false,
});
```

Тесты:
```ts
import { render } from '@solidjs/testing-library';

it('renders message', () => {
  const { getByText } = render(() => <ChatMessage msg={fakeMsg} />);
  expect(getByText('hello')).toBeInTheDocument();
});
```

## Notes

- Supersedes использование React в `wavecode-scope` (которое упоминало
  React+Zustand в стеке).
- Зависимости Solid:
  - `solid-js` (runtime + JSX + store)
  - `@solidjs/testing-library` (для vitest)
  - Vite уже настроен на JSX через `vite-plugin-solid` (добавляется
    в vite.config.ts в следующей итерации).
- ESLint остаётся без `eslint-plugin-react-hooks`/`react-refresh`,
  добавляется `eslint-plugin-solid` (опционально).
- CodeMirror 6 интегрируется через vanilla API — `EditorView` mount
  в DOM-элемент, не требует React-обёрток.