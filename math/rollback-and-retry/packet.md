---
proposition: |
  В wavecode есть две новые кнопки:
  (1) «↶ Откатить» в шапке — возвращает предыдущую версию партитуры
      (то, что было до последней замены через LLM / пресет / ручной ввод);
  (2) «Попробовать исправить» в AI-панели, рядом со строкой статуса —
      появляется при любой ошибке LLM-цикла (LLM вернул пустой ответ,
      audio eval упал на синтаксисе, LLM API error) и повторяет тот же
      запрос с теми же параметрами (instruction text, model, thinking).
antithesis: |
  (1) Кнопка «Откатить» — альтернативы: (a) git-style undo stack с N
    уровнями и Ctrl+Z; (b) «восстановить из IDB» — не покрывает случай
    «только что применил плохой LLM-edit, а до этого было хорошо»;
    (c) кнопка «Откатить» внутри AI-панели рядом с «Применить», а не
    в шапке — но юзер явно сказал «в шапке» (рядом с «Новая»).
  (2) Кнопка «Попробовать исправить» — альтернативы: (a) автоматический
    retry с backoff без UI — скрывает проблему от юзера, и часто
    воспроизводит ту же ошибку (LLM non-deterministic, но обычно
    промахивается системно); (b) кнопка «Открыть чат» — перенаправляет
    юзера писать новый запрос, но это противоречит интуиции «в чате
    retry последнего сообщения»; (c) inline-кнопка в самом сообщении
    ассистента (как в Slack) — но тогда на пузыре assistant-message
    надо навешивать action, что ломает текущий chat-bubble layout.
  Тонкий момент: «Откатить» не должен откатывать смену пресета
  (если юзер выбрал Creep, а потом нажал «Откатить» — он вернётся
  к прошлой партитуре, не к прошлому пресету). Это правильно: undo
  работает на уровне score, не на уровне preset-selection.
synthesis: |
  Score-prev = одностолбцовый snapshot: replaceScore сохраняет текущий
  score в scorePrev перед заменой. Один уровень. Этого достаточно для
  сценария «плохой LLM-edit → откат». Multi-level undo — отдельный
  пакет, не нужен пока не попросят.
  Retry = простой re-call submit() с закешированным
  { text, settings } при ошибке. Не трогаем reducer — local signal
  в AIEditPanel. Перед retry НЕ откатываем score: LLM увидит свой
  предыдущий (плохой) score в history и попробует исправить; юзер
  также имеет явный «Откатить» если не хочет ретрая.
  Layout:
    ┌── шапка ────────────────────────────────────────────────┐
    │ [Встроенные ▾] [↶ Откатить] [✦ Новая] [💾] [🗑] [🧹]    │
    └────────────────────────────────────────────────────────┘
  Кнопка «↶ Откатить» disabled когда scorePrev === ''. Без confirm
  — откат безопасен и обратим (юзер может нажать redo = новый
  LLM-edit, и scorePrev снова будет).
  В AI-панели под footer (или в status-зоне) — при err:
    `ИИ вернул пустой ответ ...   [Попробовать исправить]`
  Retry = повторный submit() с lastFailedRequest. При успехе —
  lastFailedRequest = null, кнопка исчезает. При повторной ошибке —
  lastFailedRequest обновляется, кнопка остаётся.
  History контекст НЕ теряется: appStore.messages хранит все пары
  user/assistant, и каждая новая попытка добавляет ещё одну пару
  (failed user → failed assistant). LLM видит всю историю и в
  следующий раз сделает лучше.
substrate: |
  + `wire/contract/`: новый `AppEvent { type: 'rollbackScore' }` —
    добавляется в reducer, не ломает существующие события.
  + `wire/state/`: новое поле `AppState.scorePrev: string`, initial `''`.
    `replaceScore` теперь делает `scorePrev = state.score` перед заменой.
    `rollbackScore` — обратный swap, после чего scorePrev = ''.
  + `wire/integration/extension`: App.tsx — кнопка «↶ Откатить»,
    disabled когда scorePrev === ''. AIEditPanel — local signal
    `lastFailedRequest` + кнопка «Попробовать исправить» в status-зоне.
  − ничего не удалено.
status: applied
axiom: A4
witness:
  applied_at: 2026-10-05
  commit: 25e83e0
amendment: null
epistemics:
  - statement: "replaceScore уже сохраняет score в scorePrev перед заменой"
    marker: fact
    evidence: "reducer.ts:case 'replaceScore' — добавить scorePrev = state.score"
  - statement: "audio eval падает на синтаксисе Strudel — Strudel выкидывает ReferenceError"
    marker: fact
    evidence: "LiveAudioEngine.ts:194-199 — wrap try/catch на repl.evaluate, lastEvalErr
    попадает в setDebug, и AIEditPanel.tsx:88 ловит это в catch audioErr"
  - statement: "юзер сказал «в чат-стиле кнопка retry»"
    marker: judgment
    evidence: "запрос 2026-10-05: «если ошибка синтаксиса получается это нужна показывать
    кнопку попробовать исправить которая отправляет э ещё раз тот же самый запрос»"
  - statement: "юзер сказал «кнопка Отмена, откатиться на предыдущую итерацию»"
    marker: judgment
    evidence: "запрос 2026-10-05: «если что-то пошло не так отменить откатиться
    на предыдущую итерацию»"
  - statement: "юзер подтвердил: «при каждой отправке запросов вся история отправляются»"
    marker: judgment
    evidence: "запрос 2026-10-05 — текущее поведение slice(-10) уже правильное,
    менять не нужно"
---

## Intent

Юзер больше не теряет работу при плохом LLM-edit и не пишет заново
инструкцию при ошибке.

## Worked example

```ts
// ui/src/application/reducer.ts
case 'replaceScore':
  return { ...state, scorePrev: state.score, score: event.text };

case 'rollbackScore':
  if (!state.scorePrev) return state;
  return { ...state, score: state.scorePrev, scorePrev: '' };

// ui/src/App.tsx
<button
  type="button"
  class="preset-btn"
  onClick={onRollback}
  disabled={!appStore.scorePrev}
  title="Вернуть предыдущую версию партитуры"
>
  ↶ Откатить
</button>

// ui/src/presentation/panels/AIEditPanel.tsx
const [lastFailedRequest, setLastFailedRequest] = createSignal<
  { text: string; settings: ReturnType<typeof getLLMSettings> } | null
>(null);

// on LLM error / empty / audio error:
setLastFailedRequest({ text, settings: currentSettings });

// в status-зоне:
<Show when={status().kind === 'err' && lastFailedRequest()}>
  <button
    type="button"
    class="ai-retry-btn"
    onClick={() => {
      const r = lastFailedRequest();
      if (!r) return;
      setInstruction(r.text);
      void submit(r.text);
    }}
  >
    Попробовать исправить
  </button>
</Show>

// submit() принимает optional override text:
const submit = async (overrideText?: string) => {
  const text = (overrideText ?? instruction()).trim();
  ...
};
```

## What this is NOT

- Не multi-level undo stack. Один уровень.
- Не redo. Если юзер откатил, потом LLM-edit — предыдущая
  предыдущей потеряна. Это OK: «Откатить» для emergency-возврата.
- Не redo-кнопка в шапке — не просили.
- Не auto-retry без UI. Юзер всегда видит ошибку и сам решает
  «попробовать ещё раз» или «откатить».
- Не «Поправить автоматически» (юзер не просил, и LLM часто
  делает хуже).

## Notes

- Кнопка «↶ Откатить» в шапке — рядом с «Новая», чтобы оба
  действия (откат / новая) были в одной зоне.
- Кнопка «Попробовать исправить» в AI-панели: на той же строке,
  что и `ai-status`, справа. Стиль — accent border, как «Применить».
- LLM уже видит предыдущий (плохой) assistant-message в history
  при retry — даём ему шанс исправить.
- Не делать auto-stopAudio на retry: пользователь сам решает
  продолжать ли играть (audio eval пересоздаст pattern).