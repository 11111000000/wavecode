# wavecode — Design System

> **Статус документа.** Описывает **фактически выпущенную** визуальную
> систему: «Chroma Indigo Spectrum» (`ui/src/styles/tokens.css`).
> Прежняя версия этого файла описывала выведенную из обращения
> «phosphor-amber REPL / CRT» — она больше не соответствует коду.
>
> Целевое направление развития — минималистичный, «дзенский» интерфейс:
> [`2026-11-15-zen-ui-plan.md`](2026-11-15-zen-ui-plan.md).
> Доказательная база — [`2026-11-15-zen-ui-audit.md`](2026-11-15-zen-ui-audit.md).
> Решение — [`decisions/wavecode-zen-minimal-ui.yaml`](../decisions/wavecode-zen-minimal-ui.yaml).

## Слои CSS

Каскад объявлен декларативно в `ui/src/index.css:30-37`:

```
tokens      палитра, поверхности, типографика, motion, radius, z-scale
base        reset, Geist, focus-ring, скроллбары, safe-area, prefers-*
components  wc-*, app-*, score-*, transport-*, ai-*, mixer-*, step-grid-*, …
sheets      bottom-sheet, side-drawer, snap-points, drag-handle, scroll-lock
icons       иконки и их анимации
landing     страница-лендинг (#/)
```

Первый в объявлении `@layer` = низший приоритет. Благодаря слоям
каскад не зависит от порядка `@import` и от накопленной специфичности.

## Палитра

Токены живут только в `ui/src/styles/tokens.css`. Вне него — ни одного
цветового литерала.

| Токен | HEX | Роль |
|---|---|---|
| `--surface-0` | `#0a0a0e` | базовый фон |
| `--surface-1` | `#11121a` | панели |
| `--surface-2` | `#181a25` | приподнятые блоки |
| `--surface-3` / `--surface-4` | `#1f2230` / `#272a3b` | тосты, модалки |
| `--fg` / `--fg-dim` / `--fg-ghost` | `#f4f4f5` / `#a1a1aa` / `#52525b` | три уровня текста |
| `--primary` | `#a78bfa` | действия, активное состояние, фокус |
| `--cyan` | `#5eead4` | «звучит» / live |
| `--magenta` | `#f472b6` | «пишет» / record |
| `--warm` | `#fbbf24` | темп и метроном |
| `--ok` / `--err` | `#4ade80` / `#fb7185` | статус |
| `--border` / `--border-strong` | `#27272a` / `#3f3f46` | волосяные линии |

Производные: `--primary-soft`, `--cyan-soft`, `--magenta-soft`, `--ok-soft`,
`--err-soft`, `--warm-soft` — 14 %-ные подложки активных состояний.

## Типографика

- `--font-sans` — Geist / Inter / system-ui. Весь интерфейс.
- `--font-mono` — Geist Mono / JetBrains Mono. **Только** код, нотация, числа.
- Размеры: `--fs-3xs` 9 → `--fs-display` 22 px. Целевой диапазон в
  новом языке — 11/12/13/14/18/24 px (см. план, фаза 1).
- Интерлиньяж `--lh-tight/base/relaxed`, трекинг `--ls-tight/base/wide/caps`.

## Отступы

Шкала `--space-3xs…--space-4xl`: 2, 4, 6, 8, 12, 16, 24, 32, 48, 64 px.
Рабочие значения в UI — 4 / 8 / 12 / 16 / 24 / 32 / 48. Промежутки между
смысловыми блоками — 24 px, внутри блока — 8–12 px: расстояние, а не рамка,
выражает структуру.

## Движение

- Длительности: `--dur-2xs` 60, `--dur-xs` 100, `--dur-sm` 160, `--dur-md` 240,
  `--dur-lg` 320, `--dur-xl` 480, `--dur-sheet` 380 ms.
- Кривые: `--ease` (по умолчанию), `--ease-out`, `--ease-in`, `--ease-spring`.
- `prefers-reduced-motion: reduce` обнуляет все длительности
  (`tokens.css:287-297`) — состояния при этом сохраняются.
- `prefers-contrast: more` усиливает границы (`tokens.css:300-305`).
- Целевое правило: бесконечная анимация разрешена только у играющего
  транспорта; всё остальное — по событию.

## Тени и слои

`--shadow-pop`, `--shadow-overlay`, `--shadow-inset`, `--shadow-fab` и четыре
glow-тени (`--shadow-glow-primary/warm/cyan/magenta`). В целевом языке glow
и `--*-glow` удаляются, у листов и модалок остаётся одна тень.

z-scale: `base 0 · body 1 · sticky 10 · fab 20 · tabbar 30 · sheet 40 ·
modal 60 · toast 80 · consent-gate 90`.

## Иконки

`ui/src/presentation/icons/index.tsx` — 42 компонента, все
`<svg viewBox="0 0 16 16">`, `fill="none"`, `stroke="currentColor"`,
`stroke-width="1.5"`, `stroke-linecap/linejoin: round`, `aria-hidden="true"`.
Цвет наследуется от родителя, размер по умолчанию 14 px, варианты
16 / 20 / 24 px через `--icon-size-*`. Эмодзи как иконки не используются.

## Как добавить контрол

```tsx
import { SomeIcon } from '../icons';

<button type="button" class="wc-btn" onClick={…} disabled={…}>
  <SomeIcon />
  <span>Действие</span>
</button>
```

Обязательно: цвет, отступы, радиус и длительность — только из `tokens.css`;
у интерактивного элемента есть видимый `:focus-visible`; цель ≥ 24×24 px
(на мобильном — `--touch-target: 44px`); состояние выражено цветом или
текстом, а не анимацией.

## Как не надо делать

- Хардкодить цвета, радиусы, размеры шрифта — только `var(--…)`.
- Снимать фокус (`outline: none`) без равноценной замены.
- Добавлять свечение, градиентную подложку, scanline, «стекло».
- Делать бесконечную анимацию без смысла.
- Держать у элемента размер меньше `--touch-target` на мобильном.
- Прятать инструмент за хоткеем, которого нигде не видно.

## Известный долг и как его проверять

`scripts/check-zen-ui.mjs` измеряет висящие токены, литералы цвета,
паритет `:hover` / `:focus-visible`, `outline: none`, бесконечные анимации и
число классов-поверхностей; базовая линия — `scripts/zen-ui-baseline.json`.
Текущее состояние и целевые значения — в
[`2026-11-15-zen-ui-audit.md`](2026-11-15-zen-ui-audit.md) и
[`2026-11-15-zen-ui-plan.md`](2026-11-15-zen-ui-plan.md).
