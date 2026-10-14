---
proposition: |
  Текущая палитра wavecode — `#0a0a0e` + `--amber: #ffaa3b` +
  `--cyan: #5eead4` + `--magenta: #f472b6`. Амбер — primary tone
  для действий, focus, active-tab, brand-LED, button-fill (≈100
  использований в `components.css` + 4 местах градиентов:
  `landing.css:218, 590, 1374`, `index.html:42`).

  Проблема, которую называет пользователь: `#ffaa3b` — это
  практически PornHub-orange (`#ff9900` ± 12 единиц по hue).
  В сочетании с глубоким чёрным фоном получается тот же
  агрессивный high-contrast duo, что и у PornHub. Это **не**
  музыкальный язык, не гармония — это сигнал тревожности.

  Чтобы уйти — нужно либо:
    (a) **сместить hue** primary: выбрать другой цвет (фиолетовый,
        индиго, teal), оставив spectrum-идентичность логотипа
        через 4-stop gradient;
    (b) **демутить orange**: тянуть `--amber` в сторону золота
        (`#facc15`-`#fbbf24`), чтобы уйти из оранжевой зоны
        спектра (≥40° hue). Сохраняет бренд, минимально
        ломает токены;
    (c) **полная перебалансировка**: primary → cool, spectrum
        остаётся как accent-семантика (live/record), плюс
        новый «тёплый» акцент для tone/warmth отходит в
        lower-prominence tier.

  Также: текущая палитра называется «Synthwave Modern Terminal»
  (см. `wavecode-modern-mobile-redesign`). Это — позиционирование,
  не только тон. Новое имя должно отражать выбор.

  Решение не применять до явного одобрения юзером. Этот пакет
  — анализ + 3 конкретных направления с hexcode-картами и
  семантическим маппингом. После выбора — отдельный applied-пакет
  с конкретным diff-ом.
antithesis: |
  (1) «Это всё субъективно, пользователь думает что PornHub но
  для других это просто оранжевый». Возражение: #ffaa3b попадает
  в hue-range 30-40°, который ВСЕ UI-эксперты связывают с
  «alert/danger/high-saturation-warm» — PornHub-association это
  частный случай более широкого кластера. Уход из этого диапазона
  в любую сторону (к жёлтому <30° или к оранжево-красному >50°)
  убирает проблему.
  (2) «Просто тонируй вниз (--amber: #cc884a)». Возражение:
  desaturated amber = brown-orange, выглядит как грязный кирпич.
  Не работает. Hue-shift единственный чистый путь.
  (3) «Сделай одну замену через CSS-фильтр». Возражение:
  фильтр `hue-rotate()` сдвигает ВСЕ цвета включая skin tones,
  серый шрифт, тени. Нельзя использовать для surgical rebrand.
  Нужна замена token-уровне, downstream-trickle через ~100 правил.
  (4) «Spectrum остался с amber→cyan→magenta? Нельзя ломать
  логотип». Возражение: логотип — это static asset, можно заменить
  SVG без semantic-цены. И spectrum-идентичность сохраняется
  через 4-stop gradient с любой стартовой hue, если оставить
  multi-hue природу. amber не сакралён, в логотипе он «первый
  из spectrum-цветов», не «единственно-верный primary».
  (5) «Просто переименуй токен --amber в --warm». Возражение:
  переименование = 0 эффекта. Проблема не в имени, а в hue на
  экране.
synthesis: |
  3 направления, каждое — полная hexcode-карта + семантический
  маппинг + описание характера. Юзер выбирает; после выбора —
  отдельный applied-пакет с диффом.

  ─────────────────────────────────────────────────────────────
  **A. «Chroma Indigo»** — фиолетово-индиго primary, spectrum
  сдвинут в cool-zone, amber заменён violet.
  ─────────────────────────────────────────────────────────────

  Концепция: «Synth → Modular → Sound Design». Чем-то
  напоминает палитру Vital / VCV Rack / Splice.
  Violet в UI = «code/flow», spectrum gradient violet→cyan→magenta
  читается как осциллограф обратной-polarity формы.

  Hex-карта (vs. текущая):
    --primary:     #a78bfa  (violet-400)       ← было #ffaa3b (amber)
    --primary-soft:rgba(167,139,250,.14)
    --primary-glow:rgba(167,139,250,.45)
    --live:        #5eead4  (cyan)              ← без изменений
    --record:      #f472b6  (magenta)           ← без изменений
    --warm:        #facc15  (gold)              ← НОВЫЙ токен (замена amber-семантики)
    --ok:          #4ade80  (без изменений)
    --err:         #fb7185  (без изменений)
    --surface-0:   #08080e  (cool black, −1% blue) ← было #0a0a0e
    --surface-1..4:scale по cool-blue тонированию

  Semantic mapping:
    primary (was amber):  кнопки, focus ring, active tab,
                          brand-LED, default border-active
    live (cyan):          playing-state, ok-process, scene-A
    record (magenta):     record-state, danger/AI-tag, error
    warm (gold):          «now playing» marker, BPM dot, hover
                          accent — там, где нужно визуально
                          «тёплое сияние», но НЕ как доминанта
    OK/warn/err:          без изменений (state semantics)

  Spectrum gradient (logo, hero, mockup):
    violet → cyan → magenta → violet (4-stop) или
    violet → cyan → magenta (3-stop сохраняем)

  Теряется: мало. Amber из 100 мест превращается в warm (#facc15,
  yellow), не violet. То есть: 95% — primary становится violet,
  а там где amber был «warm playable accent» (BPM-dot, hotkey
  indicator) — становится gold.

  Цена: ~100 строк правок в components.css (sed s/var(--amber)/var(--primary)/),
  3 места градиентов, 1 место в SVG логотипа.

  ─────────────────────────────────────────────────────────────
  **B. «Studio Gold»** — минимальная интервенция: amber → gold,
  фон чуть теплее. Сохраняет 100% лого и spectrum-идентичность.
  ─────────────────────────────────────────────────────────────

  Концепция: «Pro Studio Warm». Логика и Ableton имеют
  warm-cool баланс, не cold-only. Gold на amoled-warm-black =
  теплее, менее porn-association (yellow в Web считается
  «premium» тоном, orange — «alert»).

  Hex-карта:
    --amber:      #facc15  (gold-400)        ← было #ffaa3b
                                          (hue 48° → 50°, но
                                          drop saturation ~35%)
    --amber-soft: rgba(250, 204, 21, 0.14)
    --amber-glow: rgba(250, 204, 21, 0.45)
    --cyan:       #5eead4  (без изменений)
    --magenta:    #f472b6  (без изменений)
    --surface-0:  #0c0a0d  (warm black, +1% red) ← было #0a0a0e

  Что не меняется: имя токена (--amber, --amber-soft, --amber-glow),
  spectrum gradient во ВСЕХ местах (логотип, hero, mockup,
  визуализации). ~100 строк правок = 0; только 3 строки в
  tokens.css.

  ─────────────────────────────────────────────────────────────
  **C. «Aurora Mood»** — полная перебалансировка: violet primary,
  emerald playing, rose record, orchid-warm replacing amber.
  ─────────────────────────────────────────────────────────────

  Концепция: «Native Instruments / Output depth». Cold-spectrum,
  4-цветная семантика (cool-orchid/live-orchid/warm-orchid),
  плюс emerald для «live/data» вместо cyan — ассоциация с
  oscilloscope-grid и DAW-семантикой.

  Hex-карта:
    --primary:     #818cf8  (indigo-400)     ← cool primary
    --primary-soft:rgba(129,140,248,.14)
    --primary-glow:rgba(129,140,248,.45)
    --live:        #34d399  (emerald-400)    ← было cyan
    --record:      #fb7185  (rose)           ← small shift из magenta
    --warm:        #c084fc  (orchid-purple)  ← spectrum-tone
    --surface-0:   #07091a  (indigo-tinted deep)
    --surface-1..4:слабее к indigo, не к zinc-нейтрали

  Теряется больше: spectrum (логотип с 4-точками gradient
  indigo→emerald→rose→orchid вместо amber→cyan→magenta).
  Emerald вместо cyan пересекается с «ok» semantic (#4ade80) —
  риск конфликта, нужно решить через naming или shift ok →
  другой green.

  Цена: max. Весь CSS-каскад переосмыслен, ~200 строк правок,
  логотип переписан, brand-name может поменяться.

  ─────────────────────────────────────────────────────────────
  **Рекомендация: A. Chroma Indigo.**
  ─────────────────────────────────────────────────────────────

  Причины:
  - Решает проблему PornHub-orange полностью (violet — другой
    hue, другой emotion-channel).
  - Сохраняет spectrum-идентичность (логотип переезжает с
    amber→cyan→magenta на violet→cyan→magenta, всё ещё
    spectrum).
  - Характер соответствует «музыкальной природе»: violet
    ассоциируется с синтезом, генерацией гармоник, plugins
    и модульностью — в общем, с тем, чем приложение ЯВЛЯЕТСЯ.
  - Цена: средняя. Миграция ~110 строк, логотип 3 места.
  - Gold (warm) остаётся как 4-й tone, не даёт холодной
    палитре стать one-tone-cold.

  Альтернатива B: если юзер хочет минимальную интервенцию
  и сохранить spectrum-identity 100%. Gold-porn-association
  ниже, чем orange-porn; много софта использует жёлтый как
  primary (Sublime Text, классический VS Code).

  Альтернатива C: если юзер хочет радикально новый look —
  есть риск потерять текущую аудиторию.
status: applied
axiom: A1
---

## Анализ: что именно в текущей палитре «PornHub-shaped»

### Геометрия проблемы

| Что | Где | Эффект |
|-----|-----|--------|
| `--amber: #ffaa3b` | `tokens.css:32` | PornHub = #ff9900 ± 12 hue |
| 100× `var(--amber)` | `components.css:39, 41, 102, 142, 182, 184, 302, 306, 312, 315, 320, 347, 358, 413, 422, 424, 465, 480, 509, 511, 512, 527, 594, 602, 660, 661, 769, 770, 883, 908, 932, 935, 936, 960, 1088, 1089, 1098, 1133, 1134, 1223, 1231, 1234, 1329, 1330, 1375, 1425, 1427, 1428, 1569, 1570, 1571, 1909, 2179, 2184, 2255, 2256, 2379, 2396, 2401, 2405, 2410, 2414, 2420, 2446, 2490, 2492, 2493, 2494, 2516, 2537, 2583, 2588, 2786, 2787, 2864, 2865, 2866, 2870, 3052, 3060, 3271, 3272, 3273, 3276, 3282, 3283, 3287, 3358` | Каждая кнопка/focus/active-tab = orange |
| Лого spectrum | `favicon.svg:4-7`, `icons/index.tsx:380-385`, `landing/icons.tsx:179-184` | 4-stop gradient с amber первой |
| Hero gradient | `landing.css:218`, `landing.css:590`, `landing.css:1374`, `components.css:2583` | Amber в 4-х крупных градиентах |
| Boot loader | `index.html:42` | Token определён в critical-CSS |

### Почему ВООБЩЕ возникла эта ассоциация

Amber #ffaa3b:
- Hue: **35°** (orange-yellow, в Web-культуре маркирует «alert»
  и «high-energy warm»).
- Saturation: 100%, Lightness 60% — экстремально насыщенный.
- Contrast на amoled black (#0a0a0e): **~10:1** (AAA, но
  визуально агрессивный — глаз не отдыхает).

PornHub orange #ff9900:
- Hue: **33°**, Saturation 100%, Lightness 50%.
- Разница с нашим amber — 2° hue + 10% lightness. **Близнецы.**

Сравнение с «добрососедскими» brand identity:
- FL Studio: `#f78c1a` — orange в DAW-пространстве ВОСПРИНИМАЕТСЯ
  как конкретный brand. Нам это не нужно.
- GitHub Primer: blue-violet (`#656d76` + `#0969da`), тёплый
  action — нет.
- Sublime Text: gold (`#ffc600` Hue 47°), cool tool feel.

### Где живёт «spectrum-идентичность»

Не в amber как таковом, а в:
- Multi-hue gradient (3 цвета разных hue-семейств: warm-cool-hot).
- Цвета выбраны из разных секторов wheel с достаточным интервалом
  (≈120° между amber и cyan, ≈120° между cyan и magenta).
- Glow-эффект создаёт пульсацию-«звук».

Это сохраняемо: можно заменить amber на любой hue первой позиции,
если spectrum остаётся triadic/4-stop.

### Где живёт amber-семантика vs amber-эстетика

**Семантика** (не визуальный, а логический layer):
- «primary action» — кнопка, focus, brand-LED.
- «warm/playable» — BPM, hotkey, «warm» tone knob.

Эта семантика НЕ привязана к #ffaa3b. Она привязана к «primary /
warm» как абстракция. Выбор A оставляет семантику, выбирает другой
hue. Выбор B меняет только hue внутри той же семантики. Выбор C
расширяет семантику до 4-stroke (primary/live/record/warm).

### Что теряет каждое направление

| Потеря / Цена | A | B | C |
|---|---|---|---|
| Строк кода (LOC) | ~110 | ~3 | ~200 |
| Файлов тронуто | 5 (tokens, components, base, landing, index.html, 3 SVG) | 1 (tokens) | 7+ |
| Brand identity shift | средний | нет | большой |
| Risk regression | low-medium | near-zero | medium |
| Зависит от одобрения spectrum design | да | нет | да |

## Альтернативная гипотеза: «зачем менять всё, можно меньше»

Если юзер не хочет violet и большой дифф — minimum viable:

1. `--amber: #facc15` (gold-400) — drop saturation 100→85, lift lightness
   60→66. Два hue в одной семье, но PornHub-shift минус 60% восприятия.
2. `--surface-0: #0a0a0a` (нейтральный black, без теплого tilt).
3. Никаких других правок.

LOC: 2 строки в tokens.css + 2 дублирующие в `index.html:42-44`.
Время: 30 минут включая deploy. Эффект: уход из оранжевой
ассоциации, сохранение spectrum identity 100%, сохранение
warm/cool баланса.

Это суб-направление B. Включено как B в голосовании.

## Sequence (зависит от выбора)

| # | Scope | Файлы | Diff | Risk |
|---|-------|-------|------|------|
| (выбор A) 1 | token rebrand: `--amber → --primary=#a78bfa`, добавить `--warm=#facc15` | tokens.css | +5 / -2 | low |
| 2 | sed компонент: `--amber → --primary` (~95 мест) | components.css | ~95 | low |
| 3 | 5 мест градиентов с amber-first | landing.css, components.css:2583 | ~10 | low |
| 4 | 3 SVG: spectrum amber→cyan→magenta → violet→cyan→magenta | icons/index.tsx, favicon.svg, landing/icons.tsx | ~10 | low |
| 5 | boot loader token copy в index.html | index.html | ~3 | low |
| 6 | manual visual diff на production | n/a | n/a | n/a |

Для выбора B: только (1) + дополнительно `--amber-soft/glow` через
s/hue/ в tokens.css.

Для выбора C: всё что в A, плюс `--cyan → --live=#34d399`,
`--magenta → --record=#fb7185`, новый `--warm=#c084fc`,
surface-scale tilt в индиго.

## Verification (после apply)

- Lighthouse / a11y: фокус-кольца `--primary` на dark-surface,
  3:1 min для не-текстовых элементов (WCAG 1.4.11).
- WebPageTest / axe-core: text contrast (labels на primary-background
  через `--fg-inverse` а не светлый текст).
- Visual regression: 3 скриншота (landing/desktop, app/desktop,
  app/mobile) сохраняются в `math/wavecode-palette-rebalance/
  baseline/`, сравниваются вручную или через playwright visual diff.
- Manual: открыть production, убедиться что нигде не «вырвиглазно»
  и не «похоже на PornHub».

## Supersedes

- `math/wavecode-modern-mobile-redesign/packet.md` — частично:
  палитра переопределена, mobile/layout/typography/intent — без
  изменений. Новая version — «Synthwave Modern Terminal → Indigo
  Spectrum» (или окончательное имя из applied-пакета).
- `math/wavecode-logo-modern/packet.md` — частично: spectrum gradient
  заменён, square-tile/lifecycle/pulse-LED — сохраняется.
- `math/wavecode-css-consolidate/packet.md` — без изменений (cascade
  ordering работает на любых tokens).
- `math/wavecode-ui-design-overhaul/packet.md` — без изменений (UI pass
  на color-tokens не зависит).

## Связь с другими проблемами

Текущий WAVE-Palette не PornHub-проблема изолированно. Сосед:
- `wavecode-css-consolidate` решает порядок cascade, не цвет.
- `wavecode-ui-minimal-pass` (2026-10-13) — UI density pass, не про
  палитру.

Если перебалансировка палитры согласована — следующий логичный пакет:
`wavecode-token-semantic-decoupling`, который вводит `--action`,
`--attention`, `--positive`, `--negative` (semantic) поверх
`--primary`, `--warm`, `--live`, `--record` (role), чтобы в будущем
re-palette не заставлял править каждое semantic-место отдельно.
Это не блокирует этот пакет, но облегчает next rebrand.
