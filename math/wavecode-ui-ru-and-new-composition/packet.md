---
proposition: |
  Весь видимый текст UI wavecode — на русском (панели, кнопки, хинты, плейсхолдеры,
  лейблы полей статуса); в шапке есть явная кнопка «Новая композиция», которая
  сбрасывает score на пустой шаблон-комментарий и очищает историю диалога;
  в AI-панели история сообщений видна всегда (как в мессенджере), а поле
  ввода с кнопкой «Применить» приклеено к нижнему краю панели — chat-style.
antithesis: |
  (1) Полная i18n-библиотека (i18next, react-intl) — overkill для одного языка,
    плюс затягивает стек и bundle; (2) оставить английский в коде, переводить
    только через CSS `content` — хрупко и не покрывает aria-label; (3) хранить
    «Новая композиция» как preset в `BUILTIN_PRESETS` — мусорный пресет
    среди настоящих; (4) чат-стиль только визуально (textarea всё ещё сверху,
    история ниже) — нет, тогда теряется сам смысл messenger-интуиции;
    (5) перенести ввод вниз, но оставить кнопку «Очистить» — она конфликтует
    с новой кнопкой «Новая композиция» и дублирует её частично (оба
    обнуляют работу), плюс в мессенджерах нет кнопки «очистить поле».
  Тонкая замена — переименовать «Очистить» в «Отменить ввод» (только ввод,
    не всю работу) оставить можно, но пользователь явно сказал «наверное
    убрать», и кнопка «Новая» эту роль закрывает на уровне приложения.
synthesis: |
  Один русский язык = плоские строки прямо в JSX (`<h2>Партитура</h2>`), без
  рантайм-локализации. Никаких новых зависимостей, никакого bundle-bloat,
  каждый перевод grepp'ается в исходниках — ревью видит, что именно видит
  пользователь. Кнопка «Новая композиция» = новый `AppEvent::clearMessages`
  + `replaceScore` с шаблоном-комментарием `// Начни новую композицию
  здесь\n` (score сбрасывается в IDB через существующий createEffect —
  никакого нового кода persistence); локальный signal `history` в AIEditPanel
  тоже сбрасывается (иначе новые user/assistant-пары не попадут в глобальный
  store). Чат-стиль в AI-панели = flex-layout с фиксированным footer'ом
  (textarea + кнопка), а контейнер сообщений — `flex: 1; overflow-y: auto`
  с auto-scroll вниз при новом сообщении. Кнопка «Очистить» убрана —
  пользователь явно сказал «наверное вообще убрать», и в чат-стиле она
  лишняя: пользователь может стереть текст в textarea вручную или нажать
  «Новая композиция» для сброса всего.
substrate: |
  + `wire/integration/extension`: panel-inner структура меняется с
    `textarea → controls → status → <details>history` на
    `messages (scroll) → status → footer (textarea + button)`. Селектор
    `[data-ai-textarea]` остаётся — на нём завязан `focusAI` keyboard
    shortcut.
  + `wire/contract/`: новый `AppEvent { type: 'clearMessages' }` — добавлен
    в reducer, не ломает существующие события.
  − `wire/contract/`: УДАЛена кнопка «Очистить» — нет семантики, которую
    она одна покрывала (см. antithesis (5)).
status: applied
axiom: A4
witness:
  applied_at: 2026-10-05
  commit: <filled on apply>
amendment: null
epistemics:
  - statement: "wavecode — pure frontend SPA, оператор — русскоязычный"
    marker: fact
    evidence: "AGENTS.md стек, README.md scope (локальный live-coding),
    правки коммитов на русском (см. `feat(ui): ...`) за 2026-09..10"
  - statement: "кнопка «Новая» нужна как явное действие, не только preset"
    marker: judgment
    evidence: "запрос пользователя 2026-10-05 — «Нужна кнопочка для
    создания новой композиции»"
  - statement: "поле ввода внизу — чат-интуиция"
    marker: judgment
    evidence: "запрос пользователя 2026-10-05 — «поле ввода для отправки
    нейросети нужно перенести вниз ... было интуитивно»"
  - statement: "Старый `<details>`-блок с историей закрыт по умолчанию"
    marker: fact
    evidence: "ui/src/presentation/panels/AIEditPanel.tsx:157
    (`<details class='ai-history' open={false}>`) + index.css:399
    (комментарий «stays closed by default so it doesn't push the textarea
    out»)"
  - statement: "AI-панель имеет max-height 35vh"
    marker: fact
    evidence: "ui/src/index.css:230 (`max-height: 35vh`) — footer
    помещается даже при свернутой остальной части"
---

## Intent

UI перестаёт быть англоязычным прототипом и становится русским продуктом.
AI-панель перестаёт быть «form с hidden history» и становится «chat с input
снизу». «Очистить» удаляется как избыточная кнопка (её покрывает «Новая
композиция» на уровне приложения и Backspace в textarea на уровне поля).

## Worked example

```tsx
// ui/src/App.tsx — в шапке рядом с пресетами:
<button
  type="button"
  class="preset-btn"
  onClick={onNewComposition}
  title="Очистить партитуру и историю"
>
  ✦ Новая
</button>

// ui/src/application/reducer.ts — новый event:
case 'clearMessages':
  return { ...state, messages: [] };

// ui/src/presentation/panels/AIEditPanel.tsx — чат-стиль:
return (
  <div class="ai-edit-panel-inner">
    <div class="ai-messages" ref={messagesRef}>
      <For each={appStore.messages}>{(m) => <MessageItem m={m} />}</For>
    </div>
    <Show when={status().msg}>
      <div class={`ai-status ai-status-${status().kind}`}>{status().msg}</div>
    </Show>
    <div class="ai-footer">
      <textarea data-ai-textarea ... />
      <div class="ai-controls-row1">
        <select model><select thinking>
        <button onClick={submit}>{busy() ? '⏳ Применяю…' : '✦ Применить'}</button>
      </div>
    </div>
  </div>
);

// ui/src/index.css — footer-стиль:
.ai-edit-panel-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 !important;
}
.ai-messages {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px 16px;
}
.ai-footer {
  flex-shrink: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
}
```

## What this is NOT

- Не i18n-библиотека и не locale-таблица. Один язык = плоские строки в JSX.
- Не preset «blank» в `BUILTIN_PRESETS` — это явное действие, не музыка.
- Не удаление истории сообщений навсегда (только reset для новой композиции;
  пользователь сам может захотеть видеть историю следующей).
- Не изменение persistence: `replaceScore` уже сохраняет в IDB через
  `createEffect` в `App.tsx`; `clearMessages` тоже сохранится, потому что
  `repo.saveMessages` уже подключён через аналогичный effect (если нет —
  дописать в `App.tsx`).

## Notes

- Auto-scroll: `createEffect(() => appStore.messages.length, messagesRef,
  ({ scrollHeight }) => ref.scrollTop = scrollHeight)` — не нужен
  библиотечный скролл-anchor, встроенный DOM API достаточен.
- `[data-ai-textarea]` остаётся на textarea — на нём focusAI из
  uiState.ts:73, менять не нужно.
- Кнопка «Очистить» УДАЛЕНА из DOM; в DOM её CSS-класса нет, cleanup
  не нужен.
- «Новая» ставит score на `// Начни новую композицию здесь\n` (с
  переводом строки) — комментарий без кода, юзер сразу видит подсказку
  в CodeMirror (Strudel мини-нотация не парсит `//`-комментарии, ничего
  не звучит, нет ошибок eval).
- Перевод текстов — greppable в исходниках: «Партитура», «ИИ», «Состояние»,
  «Запуск», «Стоп», «Применить», «Сохранить», «Удалить», «Сбросить»,
  «Новая», «Отладка», «Копировать», «Журналы», «Ошибки», «триггеры»,
  «cps», «вы», «ИИ», «агент», «аудио», «партитура», «сообщения».