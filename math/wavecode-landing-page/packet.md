# wavecode-landing-page

> **Статус:** draft
> **Источник:** запрос пользователя — «нужен красивый стильный и наполненный
> информацией лендинг, который будет ясно вводить пользователя в
> функциональность».

## Проблема

Сейчас `wavecode` — это «голый» инструмент: на root `/` сразу
монтируется SPA-редактор. Новый пользователь, открывший `https://wavecode.app/`,
оказывается в интерфейсе редактора без какого-либо контекста:

- непонятно, что это вообще такое (нет заголовка с описанием),
- непонятно, зачем живые пресеты в шапке,
- непонятно, как открыть чат с AI-агентом,
- ни слова про Strudel, Web Audio, IndexedDB, persistence,
- нет social proof и CTA.

`README.md` описывает проект, но README — это `git`-артефакт, его не видит
пользователь, зашедший на сайт. Нужна HTML-страница, которая **до** запуска
приложения вводит в функциональность.

## Сложности (до исследования)

1. **Что показывать**: Strudel mini-notation? мокап редактора? оба?
   Пресеты перечислены (8 жанров) — может, отдельную секцию с пресетами.
2. **Объём**: насколько подробный лендинг? В проекте много фич
   (AI-агент, Strudel, Web Audio, IDB persistence, URL sharing, MIDI,
   mixer, transport, step-grid, piano keyboard, record, sample-bank).
   Если всё в лоб — будет портянка.
3. **Роутинг**: статический деплой. Server-side rewrite под SPA-route
   невозможен без конфигурации хоста. Варианты:
   - hash-роутинг (`/#app`) — работает везде без настроек;
   - simple-signal без роутера — проще, но не позволяет sharing
     URL вида `https://.../app`;
   - browser-router с fallback rule — требует настройки статик-хоста.
4. **Стилистика**: уже есть «Synthwave Modern Terminal» design system
   (`ui/src/styles/tokens.css`). Лендинг должен остаться в этом языке,
   не изобретая новую палитру.
5. **Композиция**: SPA — это редактор. Не сломать существующую точку
   входа при добавлении лендинга.

## Анализ

### Варианты навигации

| Вариант | За | Против |
|---|---|---|
| **HashRouter** (`@solidjs/router`) | URL sharable (`/#app`), browser back работает корректно, статик-хостится без правил | +~10 KB к бандлу |
| **Сигнал `viewMode`** + manual URL write | 0 KB новых deps | URL пользователя не работает; back-button возвращает на лендинг в момент редактирования |
| **BrowserRouter + 404 fallback** | Стандартный HTML5 history | Любой хостинг без rewrite-правил (GitHub Pages без config, Netlify `_redirects`, etc) — 404 на `/app` |

→ Выбран **HashRouter**: единственный вариант, который работает на любом
статик-хосте без серверной конфигурации и сохраняет sharable URL.

### Объём и наполнение

Проект имеет 12+ user-facing фич. Лендинг должен быть достаточно полным,
чтобы пользователь сразу понимал что его ждёт, но не превращаться в
документацию. Решено:

- **8 смысловых секций** + footer + top-nav = ~10 anchor-якорей;
- hero + features + architecture — обязательные;
- preset showcase + mockup UI — визуальный «вау»;
- quick-start + tech-stack — для разработчиков.

### Что показывать визуально

- **Живая Strudel-секция**: показываем мини-нотацию с подсветкой синтаксиса
  статикой (без `<audio>` — браузер блокирует AudioContext до user gesture,
  автоплей всё равно не заработает на лендинге). Рядом — чипы 8 пресетов;
- **Мокап UI редактора**: HTML/CSS-копия `TopBar` + `PresetRow` +
  CodeMirror panel + Chat panel. Показывает реальный layout того, что
  увидит пользователь;
- **Architecture flow**: диаграмма pipeline из README.md
  (Browser → Effect Layer DI → LLM Client → llm.kosov.online;
  CodeMirror → @strudel/webaudio → Web Audio → Speakers);
- **Tools showcase**: иконки + однострочное описание каждой
  крупной панели (Transport, Mixer, Piano, Step Grid, MIDI I/O,
  Record/Share/Sample-Bank).

### Где расположить файлы

```
ui/src/presentation/components/landing/
├── index.ts          barrel
├── Landing.tsx       корневой компонент (composition of sections)
├── sections/
│   ├── TopNav.tsx
│   ├── Hero.tsx
│   ├── SnippetShowcase.tsx
│   ├── EditorMockup.tsx
│   ├── Features.tsx
│   ├── Architecture.tsx
│   ├── Panels.tsx
│   ├── TechStack.tsx
│   ├── QuickStart.tsx
│   └── Footer.tsx
└── icons.tsx         inline SVG-иконки для лендинга (фичи/панели)
```

Стили — отдельный CSS-файл `ui/src/styles/landing.css`, импортируется
в `index.css` после `components.css` (порядок: tokens → base →
components → sheets → legacy → **landing**).

### Боди и overflow

`body { overflow: hidden }` + `.app { height: 100% }` (для полноэкранного
редактора). Лендинг должен скроллиться вертикально. Решение — на
`<Landing>` ставим class `wc-landing-active` на `<body>` через
`onMount`/`onCleanup`, и в landing.css:

```css
body.wc-landing-active { overflow: auto; min-height: 100vh; }
body.wc-landing-active #root { height: auto; min-height: 100vh; }
```

Тело редактора правил мы не трогаем — на `/app` класс снимается, и
старая логика SPA работает как раньше.

### Страница загрузки

`index.html` имеет boot loader с логотипом wavecode. После mount Solid
он стирается. Этот boot loader должен оставаться нейтральным (не
говорить «boot 1.1», чтобы не выдавать editor-фрейм до запуска).
Обновлю строку на «wavecode · loading…».

## Решение

Реализовать отдельный landing-маршрут в Solid-router:

1. **Зависимость**: `npm install @solidjs/router@^0.15` — total
   +~12 KB gzip. Подходит под «pure-frontend SPA, без backend» и не
   добавляет серверных зависимостей.
2. **Точка входа**: `ui/src/main.tsx` оборачивает `App` и `Landing`
   в `<HashRouter>`. Routes: `/` → `<Landing />`, `/app` → `<App />`.
3. **App.tsx** остаётся как был (внутри редактора ничего не меняем).
4. **TopBar**: добавляется ссылка `← На главную` для возврата на лендинг
   (только при наличии referrer-логики, чтобы не мешать новой сессии).
5. **Лендинг-секции**: 8 смысловых секций + footer — Hero / Snippet
   showcase / Editor mockup / Features (6 карточек) / Architecture
   flow / Panels showcase / Tech stack / Quick start / Footer.
6. **Стили**: всё в духе Synthwave Modern Terminal — spectrum
   amber/cyan/magenta на amoled-black, Geist Sans + Geist Mono,
   мягкие свечения (--shadow-glow-*), радиусы --radius-md/lg,
   spring-easing. Никаких emoji.
7. **Бутстрап**: `index.html` boot loader — мелкая правка,
   универсальная фраза вместо «boot 1.1».
8. **Routing discipline**: hash-маршруты `#/` и `#/app`. SHA-параметр
   `?s=...` (URL-share score, уже реализован через `parseShareUrl`)
   сохраняем — если на лендинге есть `?s=...`, кнопка «Открыть» отдаёт
   payload в редактор.

## Что НЕ делается в этом пакете

- Никаких добавочных deps кроме `@solidjs/router`.
- Никаких правок эффектов (domain/application/infrastructure) — это
  чисто presentation.
- Никаких изменений в App.tsx, кроме потенциальной косметики для
  unified-стиля (TopBar back-link).
- Без бэкенда, без серверной логики.
- Без мокинга AudioContext. Лендинг **не играет** звук; если хочется
  превью — клик «Открыть редактор» отдаст snippet в редактор, где
  браузер уже разрешит AudioContext после user gesture.

## Альтернативы (отвергнутые)

1. **Главная = редактор, лендинг = `/about`**. Пользователь, который
   пришёл по ссылке `/`, ничего не узнает о проекте. Хуже discovery.
2. **Один SPA без роутера, переключение через signal**. URL `/`
   всегда одинаковый; sharing `/app` невозможен; back-button ломается.
3. **Server-side rewrites + BrowserRouter**. Требует конфигурации
   статик-хоста. Для «деплой как статический SPA» это лишний шаг.
4. **Web Components / vanilla HTML для лендинга**. Ломает стилевую
   систему (пришлось бы дублировать токены). Solid SPA — единая
   точка истины.

## Witness (что нужно приложить при applied)

- Скриншоты лендинга на desktop / tablet / mobile breakpoints;
- `npm run build` без warnings;
- `npm run typecheck` без ошибок;
- `npm run lint` без new-errors в `src/presentation/components/landing/`;
- (опц.) playwright e2e: «клик по «Открыть редактор» рендерит `wc-app`».
