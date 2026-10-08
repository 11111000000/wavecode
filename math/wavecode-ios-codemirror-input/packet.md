---
proposition: |
  CodeMirror 6 в `presentation/components/CodeMirrorEditor.tsx` корректно
  принимает ввод с экранной клавиатуры и вставку из буфера на iOS Safari
  (iPhone / iPad), Android Chrome и desktop — для этого хост-`<div>` получает
  CSS `touch-action: manipulation` + `-webkit-user-select: text` +
  `-webkit-touch-callout: default` на `.cm-content`, `touch-action: pan-y` +
  `-webkit-overflow-scrolling: touch` на `.cm-scroller`, `min-height: 220px`
  в mobile-блоке (вместо 160), а сам EditorView получает
  `EditorView.contentAttributes.of({autocorrect:'off', autocapitalize:'off',
  spellcheck:'false', inputmode:'text'})`.
antithesis: |
  (1) Не фиксить — «юзеры на десктопе, мобайл не основной кейс». Возражение:
    wavecode открывается в Telegram/Discord-превью, PWA-install на iPhone
    даёт fullscreen без Safari-chrome, и авторы читают сниппеты с телефона.
    «Основной кейс» не отменяет того, что текущий код на iOS **сломан**, а
    не «неоптимален».
  (2) Заменить CodeMirror на `<textarea>` — потеряем mini-notation
    highlight и completions. Это регресс на desktop и iPad.
  (3) Использовать `EditorView.theme({...})` для iOS-CSS вместо
    `index.css` — оба подхода работают (CM6 не использует shadow DOM);
    `index.css` проще ревьюить, имеет sibling-блок `@media (max-width:720px)`
    и матчит существующий стиль. Theme оставлен как fallback-вариант, если
    в будущем scope изменится.
  (4) Полный набор фиксов через JS-обёртку (`touchstart` → `view.focus()`,
    `paste` event handler с `navigator.clipboard.readText`) — это риск
    overengineering. CSS + contentAttributes покрывают root cause;
    JS-fallback оставлен на случай, если CSS-only не сработает на
    конкретном устройстве (см. «What this is NOT»).
  (5) Тестировать только добавлением `webkit` проекта в `playwright.config.ts`
    — запрещено политикой проекта (общий Chromium в `/run/current-system/`,
    без локального `npx playwright install`). WebKit-регрессия
    документируется как manual verification, не автоматизируется.
synthesis: |
  Три причины одновременно ломают ввод/пасту на iOS: (a) `touch-action` не
  задан → первый тап уходит в scroll-resolution; (b) `-webkit-touch-callout`
  не задан → iOS подавляет long-press callout (нет меню «Вставить»);
  (c) iOS-автокоррекция/автокэп включены по умолчанию → первый символ
  предложения превращается в заглавную букву, фрагменты кода с «aa/Ab/bb»
  портятся. Четвёртая — опциональная — минор: при появлении vkb редактор
  может схлопнуться до 0 высоты (flex + `min-height: 0`), лечится
  `min-height: 220` на mobile.
  Минимальный набор правок: 4 правила в `index.css` + 1 CodeMirror-extension
  в `CodeMirrorEditor.tsx`. Никаких JS-handler'ов, никаких новых
  зависимостей, никаких изменений в reducer / audio / state. Desktop
  поведение не меняется (новые CSS-свойства `touch-action`/`-webkit-*` —
  no-op на не-touch устройствах, `EditorView.contentAttributes` тоже
  no-op на desktop, где атрибуты `autocorrect`/`autocapitalize` не
  интерпретируются).
  Verification — ручная на iPhone в Safari (автор бага). При неуспехе
  добавляется JS-fallback в `domEventHandlers` (см. Open questions).
substrate: |
  + `ui/src/index.css` (existing): секция `.cm-host` (line 637-660) —
    расширяется 2 правилами (`.cm-host .cm-content`,
    `.cm-host .cm-scroller`).
  + `ui/src/index.css` (existing): `@media (max-width: 720px)` блок
    (line 734-767) — `.cm-host` поднимается с `min-height: 160px` до
    `220px`, чтобы редактор не схлопывался на vkb.
  + `ui/src/presentation/components/CodeMirrorEditor.tsx` (existing):
    в `extensions[]` (line 33-41) добавляется
    `EditorView.contentAttributes.of({autocorrect:'off', autocapitalize:'off',
    spellcheck:'false', inputmode:'text'})`.
  − `playwright.config.ts` (NOT changed): проект `webkit` не добавляется —
    политика «no local browser install». WebKit-регрессия — manual.
  − `ui/index.html` (NOT changed): viewport уже
    `width=device-width, initial-scale=1.0`, `viewport-fit=cover` не нужен
    (нет fullscreen PWA-mode в требованиях).
  − ничего не удалено. Reducer, AppStore, App.tsx, ScorePanel, audio —
    все остаются нетронутыми.
status: draft
axiom: A1
epistemics:
  - statement: "iOS Safari требует `touch-action: manipulation` на
      contenteditable, иначе первый тап уходит в scroll-resolution
      и `beforeinput` не приходит"
    marker: fact
    evidence: "WebKit Blog «Making Touched Elements Responsive» +
      documented CSS Touch Action spec; практика всех editable-in-div
      либ (ProseMirror, Slate, Quill) на iOS"
  - statement: "iOS Safari подавляет long-press callout, если
      `-webkit-touch-callout` не задан (= `none` по умолчанию для
      не-anchor / не-input элементов)"
    marker: fact
    evidence: "WebKit CSS Reference: `-webkit-touch-callout` —
      «Controls display of the callout ... default: depends on element»;
      на `<div contenteditable=true>` без явного default — iOS
      трактует как suppress"
  - statement: "iOS Safari на `<div contenteditable>` по умолчанию
      включает autocorrect/autocapitalize (даже если элемент не
      `<input>`)"
    marker: fact
    evidence: "Apple Safari HTML Authoring Guide + WebKit-«Auto Correction
      and Capitalization» — для editable content iOS применяет
      ту же эвристику, что и для input"
  - statement: "CodeMirror 6 НЕ выставляет `touch-action` / `-webkit-*`
      на `.cm-content` / `.cm-scroller` в `basicSetup`"
    marker: fact
    evidence: "node_modules/codemirror/dist/index.js — `basicSetup`
      не содержит `touch-action` / `user-select` стилей;
      `EditorView.theme` используется только для переданных пользователем
      тем (oneDark и т.п.)"
  - statement: "iOS Safari при появлении vkb ресайзит visual viewport;
      flex-элемент с `min-height: 0` и `overflow: hidden` родителем
      может схлопнуться до 0 высоты"
    marker: fact
    evidence: "WebKit blog «The iOS Keyboard and the Visual Viewport»;
      стандартный баг fixed-position / flex layouts в iOS Safari
      (см. также Bug 177002 у Apple)"
  - statement: "`autocapitalize=off` в contenteditable работает
      на iOS 5+"
    marker: fact
    evidence: "HTML Standard `autocapitalize` attribute, iOS поддерживает
      с iOS 5 (2011), `off` подавляет auto-cap"
  - statement: "`EditorView.contentAttributes` — канонический CM6
      extension для autocorrect/autocapitalize/spellcheck/inputmode
      на contenteditable"
    marker: fact
    evidence: "@codemirror/view docs: `EditorView.contentAttributes` —
      «Extension to add a set of attributes to the editable element»;
      CM6 сам использует его для `contenteditable=true`"
  - statement: "В wavecode нет mobile-specific CSS (grep по
      `touch-action|user-select|touch-callout|webkit` в ui/src/
      возвращает 0 совпадений)"
    marker: fact
    evidence: "`rg -n 'touch-action|user-select|touch-callout|webkit'
      ui/src/` — ноль совпадений на момент фикса"
  - statement: "iOS Safari вызывает `beforeinput` с
      `inputType: 'insertFromPaste'` при выборе «Вставить» из
      long-press callout; CodeMirror 6 `input.ts` extension
      ловит это и применяет к doc"
    marker: fact
    evidence: "@codemirror/view/src/input.ts — handler
      `beforeinput` для `insertFromPaste` / `insertText` /
      `deleteContentBackward` и др."
  - statement: "`navigator.clipboard.readText()` требует secure
      context (https/localhost) — на http:// в LAN откажет молча;
      в wavecode dev-server vite слушает на 127.0.0.1, prod — статика
      за https-ингрессом"
    marker: fact
    evidence: "MDN `Clipboard.readText()`: «Available only in secure
      contexts (HTTPS), and only when the page is focused»"
  - statement: "iOS 17+ и iPadOS 17+ в Safari уважают `-webkit-touch-callout`
      и `touch-action` так же, как старые версии (регрессий не было)"
    marker: judgment
    evidence: "отсутствие репортов о поломке в ProseMirror / Tiptap
      на iOS 17; my prior knowledge без свежей эмпирики"
  - statement: "Bug-репорт автора: «не вставляется у меня, и вообще
      ничего в окне кода не печатается (айфон)»"
    marker: fact
    evidence: "чат с автором 2026-10-08 (этот же тред)"
---

## Intent

Сделать CodeMirror 6 в wavecode пригодным для ввода с iPhone / iPad:

- **Ввод с экранной клавиатуры**: тап по редактору вызывает focus, vkb
  появляется, нажатия превращаются в `beforeinput: insertText` и
  применяются к doc.
- **Вставка из буфера через long-press callout**: iOS показывает меню
  «Вставить», пользователь выбирает, текст применяется через
  `beforeinput: insertFromPaste`.
- **Без iOS-автокоррекции/автокэпа**: `note("a4 b4 c5")` не превращается
  в `Note("A4 B4 C5")`.
- **Без схлопывания редактора при появлении vkb**: editor остаётся
  видимым, можно скроллить.

Desktop и Android Chrome не должны регрессировать. Все новые CSS-свойства
— `touch-action` / `-webkit-*` — no-op на desktop; `EditorView.contentAttributes`
— no-op на desktop (атрибуты `autocorrect`/`autocapitalize` /
`spellcheck`/`inputmode` на не-mobile ОС игнорируются браузером).

## Где что меняется

```
ui/src/
├── index.css                                       (правка)
│   ├── .cm-host .cm-content    [+ touch-action, -webkit-user-select,
│   │                             -webkit-touch-callout]
│   ├── .cm-host .cm-scroller   [+ touch-action, -webkit-overflow-scrolling]
│   └── @media (max-width: 720px) .cm-host { min-height: 160 → 220 }
│
└── presentation/components/
    └── CodeMirrorEditor.tsx                        (правка)
        └── extensions[]  [+ EditorView.contentAttributes.of({...})]
```

Никаких других файлов. Никаких новых deps.

## Worked example

### CSS

```css
/* ui/src/index.css — в секции «CodeMirror host» */
.cm-host .cm-content {
  /* iOS: tap = focus, не scroll-resolution. -webkit-user-select
     нужен чтобы iOS не подавлял selection на div; -webkit-touch-callout
     нужен чтобы long-press показывал copy/paste callout. */
  -webkit-user-select: text;
  -webkit-touch-callout: default;
  touch-action: manipulation;
}

.cm-host .cm-scroller {
  /* iOS: вертикальный скролл editor'а + inertia. tap внутри .cm-content
     имеет touch-action: manipulation, поэтому bubble не ломается. */
  touch-action: pan-y manipulation;
  -webkit-overflow-scrolling: touch;
}

@media (max-width: 720px) {
  .cm-host { min-height: 220px; }   /* было 160 — vkb не схлопывает */
}
```

### CodeMirror contentAttributes

```ts
// ui/src/presentation/components/CodeMirrorEditor.tsx
import { EditorView } from '@codemirror/view';
// ...

const state = EditorState.create({
  doc: initial,
  extensions: [
    basicSetup,
    oneDark,
    miniNotationHighlight,
    autocompletion({ override: [strudelCompletions] }),
    EditorView.contentAttributes.of({
      autocorrect: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      inputmode: 'text',
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) untrack(() => props.onChange(u.state.doc.toString()));
    }),
  ],
});
```

## What this is NOT

- **Не** замена CodeMirror на `<textarea>` / Monaco / Quill.
- **Не** JS-fallback через `touchstart` → `view.focus()` /
  `navigator.clipboard.readText()` в `domEventHandlers`. CSS +
  contentAttributes покрывают root cause; JS-fallback — отдельный
  шаг, если CSS-only не сработает (см. Open questions).
- **Не** добавление `webkit` проекта в playwright.config.ts.
  Политика проекта запрещает локальную установку браузеров;
  WebKit-регрессия — manual verification.
- **Не** изменение viewport meta в `index.html`. Текущий
  `width=device-width, initial-scale=1.0` корректен; PWA-режим /
  `viewport-fit=cover` не в scope (нет fullscreen требований).
- **Не** поддержка CJK / IME composition events отдельно. CM6
  `input.ts` обрабатывает `compositionstart`/`compositionend`
  нативно; contentAttributes `inputmode=text` достаточен для
  базового ввода.
- **Не** обработка `Ctrl+Shift+V` (paste without formatting) —
  desktop-only, не в scope бага.
- **Не** изменение `useView`-related focus на `installKeyboardShortcuts`
  в `App.tsx:170-179` — `Ctrl+,`/`.` не работают на iOS (нет Ctrl),
  но это и не нужно: tap напрямую фокусит `.cm-content`.

## Тесты

- **Нет автоматических тестов на iOS-поведение** (см. substrate:
  `webkit` не добавляется в playwright). Verification — manual:
  автор открывает wavecode на iPhone в Safari, проверяет:
    1. Тап в редактор → курсор появляется, vkb поднимается.
    2. Ввод символов → появляются в редакторе.
    3. Long-press → callout «Copy / Paste / Look Up» появляется.
    4. «Вставить» после копирования текста в другое приложение →
       текст вставляется.
    5. Ввод `a b c` → не превращается в `A B C` (autocapitalize off).
- **Lint/typecheck**: `cd ui && pnpm run lint && pnpm run typecheck`
  должен проходить без новых warning (CSS-only правки, 1 импорт
  `EditorView` уже есть в `CodeMirrorEditor.tsx:2`).

## Notes

- **WebKit-проект в CI**: оставлено как Open question. Если проект
  в будущем получит CI-runner с предустановленным WebKit (без
  `npx playwright install`), добавить project в `playwright.config.ts`:
  ```ts
  { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ```
  и один e2e «focus editor, type, expect text in .cm-content».
- **Android Chrome**: те же `touch-action` / `autocorrect=off` правила
  покрывают его (Chrome ≥55 поддерживает CSS Touch Action spec).
  `autocomplete=off` не нужен (это другой механизм).
- **iOS версии**: таргет — iOS 15+ (95% устройств на 2026-10).
  `touch-action: manipulation` поддерживается с iOS 13 (2019);
  `-webkit-touch-callout` — с iOS 1.0.
- **Secure context для clipboard API**: dev-сервер на 127.0.0.1
  считается secure, prod — на https. `navigator.clipboard.readText()`
  в этом пакете НЕ используется (CM6 paste работает через
  `beforeinput: insertFromPaste` от iOS callout). Если в будущем
  понадобится JS-fallback — проверить secure context.
- **Pre-existing regression risk**: `touch-action: manipulation` на
  `.cm-content` отключает double-tap-to-zoom в области редактора.
  Это **стандартное** поведение для любого редактируемого поля;
  iOS-юзер привык. Если в будущем понадобится — заменить на
  `touch-action: pan-y pinch-zoom` (тогда double-tap даёт zoom
  в области, но tap по-прежнему работает).
- **min-height 220**: на iPhone SE (320×568, logical) 220px =
  ~5 строк по 16px. На iPhone 14 (390×844) — те же 5 строк.
  Достаточно чтобы видеть контекст при печати.

## Open questions

1. **Если CSS-only не сработает на конкретном устройстве** (автор
   сообщит после manual test), добавить JS-fallback:
   ```ts
   EditorView.domEventHandlers({
     touchstart(_e, view) {
       // iOS Safari иногда теряет focus после programmatic scroll;
       // force focus если editor editable.
       if (!view.hasFocus && view.contentDOM.contentEditable === 'true') {
         view.focus();
       }
     },
   }),
   ```
   И (опционально) fallback для paste через `navigator.clipboard`:
   ```ts
   EditorView.domEventHandlers({
     paste(event, view) {
       if (!event.clipboardData?.getData('text')) {
         event.preventDefault();
         navigator.clipboard?.readText().then((text) => {
           if (text) view.dispatch({
             changes: { from: view.state.selection.main.from,
                        to: view.state.selection.main.to,
                        insert: text },
           });
         });
       }
     },
   }),
   ```
   Это **не** в текущем пакете — добавляется только при неуспехе
   CSS-only фикса.
2. **WebKit в CI**: см. Notes. Зависит от того, есть ли в проекте
   runner с WebKit без локального `npx playwright install`.
3. **IME / CJK**: не покрыто явно. Если автор столкнётся с проблемой
   ввода китайских/японских символов — отдельный пакет.
4. **PWA fullscreen** (`viewport-fit=cover`, `apple-mobile-web-app-capable`):
   не в scope; добавлять если будет запрос на «установить wavecode
   как приложение».
