---
proposition: |
  В wavecode есть 8 встроенных пресетов (Creep, Seven Nation Army, Für Elise,
  Smoke on the Water, House of the Rising Sun, Let It Be-style, Wonderwall-style,
  Mary Had a Little Lamb) — зашитые как `BUILTIN_PRESETS: ReadonlyArray<Preset>`
  в `ui/src/domain/presets.ts`; кастомные пресеты — в localStorage через
  `ui/src/presentation/state/presetsStore.ts`.
antithesis: |
  Альтернативы: (1) пустой редактор без пресетов — пользователь сам пишет
  Strudel с нуля; (2) пресеты грузятся из сети/API — внешняя зависимость
  и латентность; (3) пресеты как генерируемая фича из natural-language
  через LLM — лишний шаг для тривиального "хочу услышать паттерн прямо
  сейчас"; (4) пресеты как сэмплы (Dirt/SuperDirt) — вне Strudel-стека.
synthesis: |
  Built-in пресеты дают instant feedback: открыл wavecode → выбрал "Creep"
  → через секунду звучит узнаваемая прогрессия. Это снижает порог входа
  для live-coding и для демонстрации Strudel-стека (см. пакет
  wavecode-strudel-in-browser). Пресеты — frozen-массив в domain/,
  не генерируются рантаймом: это pure data, легко читать, легко ревьюить
  diff. Кастомные пресеты — localStorage, без backend и без регистрации;
  это та же модель, что в браузерных snippet-менеджерах.
  Если позже понадобится preset-library с тегами/поиском/шерингом —
  это отдельный пакет поверх этой структуры.
substrate: none
status: draft
axiom: A3
epistemics:
  - statement: "8 пресетов покрывают rock, classical, folk, pop-progressions"
  - statement: "custom пресеты — localStorage (KEY = 'wavecode-custom-presets-v1'), без backend"
  - statement: "BUILTIN_PRESETS — frozen ReadonlyArray в domain/, не генерируется рантаймом"
    marker: judgment
    evidence: "оператор 2026-10-01 в opencode-сессии"
---

## Intent

Пресет-каталог — это "demo-content" для wavecode. Оператор открывает
приложение и за 5 секунд слышит что-то узнаваемое, вместо того чтобы
с нуля писать mini-notation. Каждый пресет — конкретный код в Strudel,
который воспроизводит известную мелодию/прогрессию через стандартный
Strudel-стек (см. пакет `wavecode-strudel-in-browser`).

Структура каждого пресета (паттерн в файле):

- **bass** — сустейн-ноты через `<...>` (mini-notation)
- **chord pad** — аккорды в mini-notation `<[55,59,62] ...>`
- **arpeggio** — быстрые ноты, обычно `*2` (2x в цикле)
- **kick** — `s("sbd(2,4)")` — Euclidean, на 1 и 3
- **snare-like** — `s("white(2,4)").decay(.05).sustain(0)` — noise burst на 2 и 4
- **hi-hat** — `s("<white pink brown>*8").decay(.04).sustain(0)` — 8 нот на цикл

Все пресеты обёрнуты в `stack(...)` и `.slow(2)` — общий цикл ~4 сек
(rock-tempo). Параллельные паттерны с одинаковым `slow()` синхронизированы.

## What this is NOT

- **Не** набор сэмплов (Dirt, .wav файлы). Только Strudel-синтез через
  `note(...)`, `s(...)` с встроенными сигналами Strudel (`sbd`, `white`,
  `pink`, `brown`, `sawtooth`, `triangle`, `sine`).
- **Не** music-theory library. Не объясняет, почему аккорды именно такие;
  оператор, знающий теорию, увидит прогрессию в комментариях, не-знающий —
  услышит звук.
- **Не** user-uploadable из UI. Custom пресеты создаются через кнопку
  "Save" в `App.tsx` из текущего содержимого редактора. Загрузка
  пресетов из URL/файла — отдельная фича, не входит в этот пакет.
- **Не** генерируется рантаймом. Каждый пресет — зашитый JS-литерал в
  `BUILTIN_PRESETS`, отредактированный руками и прокомментированный.
- **Не** заменяет пользовательский код. После загрузки пресета оператор
  может редактировать score в редакторе (CodeMirror 6, см. пакет
  `wavecode-codemirror-6`) и потом сохранить как custom-пресет.

## Worked example

Полный код пресета Creep (Radiohead) из `ui/src/domain/presets.ts`:

```js
// Creep (Radiohead) — G → B → C → Cm chord progression
stack(
  // Bass: root notes
  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),
  // Chord pad: 4 chords, 1 per cycle step
  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("triangle").gain(0.2).lpf(1500),
  // Arpeggio: chord tones spread over 8 notes per cycle (*2)
  n("<55 67 59 67 62 67 59 67>*2").s("sawtooth").gain(0.12).lpf(1500),
  // Kick on 1 and 3
  s("sbd(2,4)").gain(0.5),
  // Snare-like: white noise burst on 2 and 4
  s("white(2,4)").decay(.05).sustain(0).gain(0.22),
  // Hi-hat: 8 per cycle
  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.18)
).slow(2)
```

Этот score выполняется Strudel-рантаймом в Web Worker через
`evalScope(score, webaudio)` (см. пакет `wavecode-strudel-in-browser`).
Звук идёт через Web Audio API в браузере, без backend.

## Preset catalogue

Все пресеты в `BUILTIN_PRESETS` (порядок в файле, не алфавит):

| ID | Название | Исполнитель | Стиль |
|---|---|---|---|
| `creep` | Creep | Radiohead | rock, G→B→C→Cm progression |
| `seven-nation-army` | Seven Nation Army | White Stripes | rock-riff, E-E-E-G-E-F#-D |
| `fur-elise` | Für Elise | Beethoven | classical, opening E-D#-E-D#-E-B-D-C-A |
| `smoke-on-the-water` | Smoke on the Water | Deep Purple | rock-riff, G-Bb-C-Db |
| `house-of-the-rising-sun` | House of the Rising Sun | Traditional | folk, Am-C-D-F (i-iii-iv-VI) |
| `let-it-be-style` | Let It Be (chords) | Beatles-style | pop, I-V-vi-IV (C-G-Am-F) |
| `wonderwall-style` | Wonderwall (chords) | Oasis-style | pop, Em7-G-Dsus4-A7sus4 |
| `mary-had-a-little-lamb` | Mary Had a Little Lamb | Traditional | kids-song, E-D-C-D-E-E-E-D-D-D-E-G-G |

Приписка "style" в `Let It Be (chords)` и `Wonderwall (chords)` — это
важно: пресет передаёт **прогрессию аккордов**, не точную аранжировку
конкретной песни. Точное воспроизведение потребовало бы сэмплов и
Dirt-инфраструктуры, чего в этом пакете нет (см. `wavecode-strudel-in-browser`).

## Notes

Архитектура пресетов:

```
ui/src/domain/presets.ts                    ← frozen ReadonlyArray<Preset>
        ↓ export BUILTIN_PRESETS
ui/src/presentation/state/presetsStore.ts   ← Solid.js signal + localStorage
        ↓ allPresets() = [...BUILTIN, ...custom()]
ui/src/App.tsx                              ← <select class="preset-select">
                                                + save/delete кнопки
```

- `domain/presets.ts` — pure data, тип `Preset` экспортируется оттуда,
  используется и в store, и в App. Никаких side-effects.
- `presentation/state/presetsStore.ts` — Solid signal `customPresets()`,
  ключ localStorage: `'wavecode-custom-presets-v1'`. Функции:
  - `allPresets(): Preset[]` — конкатенация built-in + custom
  - `getPreset(id): Preset | undefined`
  - `saveCustomPreset(name, score): Preset` — id `custom-<base36-timestamp>`
  - `deleteCustomPreset(id): void`
  - `resetAllBrowserData(): void` — чистит и кастомные пресеты
- `App.tsx` — default `presetId = 'creep'`, при выборе пресета
  `dispatch({ type: 'replaceScore', text: preset.score })`.

Дифф будущих изменений: правки в `presets.ts` читаются как обычный
JS-diff по строкам, не как сгенерированный рантайм-контент.
Каждая строка пресета прокомментирована прямо в `score` через
`// ...` — комментарий попадает в редактор кода (Strudel mini-notation
поддерживает `//`-комментарии).

Зависимости: `@strudel/core`, `@strudel/webaudio`, `@strudel/mini-notation`,
`@strudel/transpiler` (для парсинга JS-score в паттерны).