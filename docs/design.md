# wavecode — Design System

> Phosphor-amber REPL с моноширинным UI, ASCII-волной как логотипом,
> SVG-иконками и CRT-фактурой. Решение зафиксировано в
> `math/wavecode-redesign-repl-phosphor/packet.md`.

## Принципы

1. **Mono-first.** Весь интерфейс — моноширинный шрифт JetBrains Mono.
   Sans-serif не используется даже для заголовков. Это отделяет
   wavecode от generic dark-theme редакторов и усиливает семиотику
   «это программа / REPL / инструмент».
2. **Один источник правды.** Палитра, шрифты, spacing, motion
   вынесены в `ui/src/styles/tokens.css`. Любая правка цвета —
   только там; в компонентах читаем через `var(--…)`.
3. **SVG-иконки вместо emoji.** 14 inline-компонент в
   `ui/src/presentation/icons/index.tsx`. Все используют
   `currentColor`, рендерятся одинаково на всех ОС.
4. **Никакого украшательства без функции.** Glow — только на
   `[data-active]`, scanlines — фоном с opacity 0.04, ASCII-волна —
   один раз в title bar.
5. **Sharp shapes by default.** `--radius: 0` на всех углах, кроме
   pill-бейджей. Это читается как «инструмент / терминал».

## Слойная архитектура CSS

```
tokens.css        ← custom properties (палитра, шрифты, spacing, motion)
base.css          ← reset, html/body, CRT scanlines, focus ring
components.css    ← новые «wc-*» компоненты
icons.css         ← стили для SVG-иконок (currentColor)
legacy.css        ← shim для старых селекторов в новой палитре
```

Каскад: `index.css` импортирует слои в порядке сверху-вниз; внутри
слоя — обычный specificity-каскад. Migration plan: компоненты
постепенно переходят с legacy-classes на `.wc-*` классы; shim
остаётся как страховочная сетка.

## Палитра

| Token | HEX | Использование |
|---|---|---|
| `--bg-base` | `#0c0d0e` | основной фон |
| `--bg-elev` | `#15110d` | панели, header |
| `--bg-screen` | `#0a0807` | экран редактора, transport-panel |
| `--fg` | `#f4a62b` | основной текст |
| `--fg-dim` | `#b8801e` | вторичный текст |
| `--amber` | `#ffb547` | primary actions, glow |
| `--ok` | `#94e344` | running, online, success |
| `--warn` | `#ffd87a` | предупреждения |
| `--err` | `#ff5c3a` | ошибки, удаление |
| `--border` | `#2a201a` | разделители |
| `--border-strong` | `#4a3a2a` | видимые границы |

Контраст fg/bg-base: 9.4:1 (WCAG AAA для body text).
Амбер — это не ретро-имитация, а семантический выбор primary action.

## Шрифты

```css
--font-mono: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', Menlo,
             'DejaVu Sans Mono', Consolas, monospace;
--font-sans: 'IBM Plex Sans', 'Inter', system-ui, -apple-system, sans-serif;
```

JetBrains Mono — открытая SIL OFL 1.1, через Google Fonts CDN
(preconnect в `ui/index.html`). Fallback — все OS-моно-шрифты.

## Движения

- `--dur-fast: 80ms` — hover, border-color, focus-ring
- `--dur-base: 160ms` — раскрытие/сворачивание панелей, toggle
- `--dur-slow: 320ms` — крупные изменения layout (не используется
  широко; конкретные transitions могут переопределять)
- `--ease: cubic-bezier(0.2, 0.6, 0.2, 1)` — дефолт; никакого
  `linear` для UI motion
- `@media (prefers-reduced-motion: reduce)` — все duration → 0

## Spacing scale (4-step)

`--space-2xs (2px)` → `--space-xs (4px)` → `--space-sm (8px)` →
`--space-md (12px)` → `--space-lg (16px)` → `--space-xl (24px)` →
`--space-2xl (32px)`. Используется через `gap`, `padding`, `margin`.

## Иконки

Все иконки в `presentation/icons/index.tsx`, ~14 компонент:

`PlayIcon`, `StopIcon`, `RecordIcon`, `StepIcon`, `PianoIcon`,
`SaveIcon`, `TrashIcon`, `ShareIcon`, `UndoIcon`, `RedoIcon`,
`ResetIcon`, `NewIcon`, `PhoneIcon`, `SpeakerIcon`.

Каждая — `<svg viewBox="0 0 16 16">`, `fill="none"`, `stroke="currentColor"`,
`stroke-width="1.5"`, `stroke-linecap="square"`, `stroke-linejoin="miter"`.

Размер — `width/height: 14px` (default) или 18px через prop `size`.
Цвет — через `color` родителя (`currentColor`).

## Glow / состояния

| Состояние | Стиль |
|---|---|
| `default` | border + color из токенов |
| `hover` | brighter foreground, `--border-strong` |
| `active/pressed` | `--bg-elev` фон |
| `data-tone="amber"` | amber border + bg-fill on hover + `--shadow-glow` |
| `data-state="running"` | `--ok` foreground + border + `--ok-soft` |
| `data-state="recording"` | `--err` + `--err-soft` + pulse animation |
| `disabled` | `opacity: 0.4`, `cursor: not-allowed` |

## Как добавить новую кнопку

```tsx
import { SomeIcon } from '../icons';

<button
  type="button"
  class="ctrl-btn"
  data-tone="amber"
  onClick={…}
  disabled={…}
>
  <SomeIcon />
  <span>Действие</span>
</button>
```

## Как НЕ надо делать

- Хардкодить цвета (`#ff6b6b`, `rgba(255, 107, 107, 0.12)`) — только
  через `var(--…)` из `tokens.css`.
- Использовать emoji как иконки — `PlayIcon`/etc из icons module.
- Добавлять border-radius > 0 — UI терминальный, sharp только.
- Игнорировать `prefers-reduced-motion` — transitions должны
  отключаться.

## Status: applied

Пакет: `math/wavecode-redesign-repl-phosphor`.
Migrated: App.tsx (header, controls, ASCII-wave title), index.html
(boot screen, JetBrains Mono CDN), ui/src/styles/{tokens,base,
components,icons,legacy}.css — все 5 слоёв в production.
