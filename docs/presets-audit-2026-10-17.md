# Аудит встроенных пресетов wavecode — 2026-10-17

> **TL;DR.** Из 18 встроенных пресетов 5 — структурно
> сломанные/полупустые и подлежат переработке или удалению; 7
> приемлемые, но нуждаются в косметике; 6 — ок.
>
> **Trap** (`trap-modern`) — однозначно удалить: мало слоёв, без
> гармонии, без настоящего 808-roll'а. Заменить двумя новыми:
> `trap-atlanta` (полноценная 808 + hats + sparse lead) и
> `lofi-chill` (если готовы добавлять — даёт нужный чилл-плейлист).
>
> **Creep** и **Bossa Nova** нужно перевести с MIDI-чисел на
> `chord().voicing()` и `note("a4 b4 ...")` — трудно читать, легко
> ошибиться; звучит тот же аккорд, но в разы понятнее код.

**Worktree:** `feat/presets-audit-2026-10` (off `master@4b22691`).
**Изменяемые файлы:** `ui/src/domain/presets.ts` (основной),
`ui/src/domain/presets.test.ts`, `ui/src/domain/layers/parseStack.test.ts`,
`ui/src/application/useCases/injectMix.test.ts` (если трогаем Creep).

---

## Методология анализа

Каждый пресет проверен по 5 критериям:

1. **Ритмическая сетка.** Соответствует ли паттерн жанру? Нет ли
   «плавающих» 16-step сэмплов, которые расходятся с аккомпанементом?
2. **Гармония.** Есть ли у песни аккордовая основа (pad / comping) или
   только ритм+мелодия? Если только ритм — это не композиция, а петля.
3. **Семплы/синтез.** Используется ли правильный банк (`drums_*`,
   `synth_*`, `piano_*`)? Не сломан ли mini-pattern (`s("hh:0.05")`
   парсится как `hh` со значением 0.05, не как sample)?
4. **Считываемость кода.** MIDI-числа `[55,59,62]` vs `note("g3 b3 d4")`;
   структурированные комментарии? Minipattern внутри строк?
5. **Художественная близость.** Если пресет называется именем жанра —
   должен опознаваться. Если именем песни — соответствовать ей
   хотя бы по настроению.

Критерий 5 — субъективный, но в комментариях к коду явно прописаны
«Creep (Radiohead)», «Dembow», «ii-V-I» и т.д. — соответствие ожиданиям
обязательно.

---

## Per-preset вердикт

### 1. `creep` — Radiohead "Creep" (G → B → C → Cm)  
**Вердикт: ПЕРЕПИСАТЬ (high confidence)**  
**Сложность: L (мелкая переработка, ~30 строк)**

Проблемы:
- `note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("triangle").gain(0.2).lpf(1500)` —
  MIDI-числа для четырёх аккордов. Трудно читать, легко ошибиться,
  следующий человек не понимает где какой аккорд.
- `n("<55 67 59 67 62 67 59 67>*2")` — арпеджио. Числа 55/67/59/62
  раскиданы по двум октавам с непонятными скачками (55→67 это октава,
  но 67→59 это -8). Это не «арпеджио», а хаотичные прыжки.
- `s("~ white ~ white").decay(.05).sustain(0).gain(0.22)` — снейр из
  white-noise. Звучит кашеобразно. У банка `drums` есть `drums_sd` —
  надо использовать сэмпл.
- `s("drums_bd ~ drums_bd ~")` — kick через сэмпл. Работает, но
  следует проверить, что `drums_bd` регистрируется (см.
  `LiveAudioEngine.ts:304` — voicing-словарь регистрируется перед
  eval, но семплы через bank-prefix требуют, чтобы JSON-манифест
  содержал нужный ключ).

Что делать:
```ts
// Новый Creep: indie-rock 4/4, G major → B → C → Cm
score: [
  '// Creep (Radiohead) — G → B → C → Cm, indie-rock с Hendrix-style',
  'stack(',
  '  // Chord pad — voicing() обрабатывает MIDI-числа через tonal',
  '  chord("<G B C Cm>").voicing().s("triangle").gain(0.18).lpf(1500).room(.3),',
  '  // Acoustic guitar arpeggio (sawtooth + slight shape = thin string)',
  '  note("<g3 b3 d4 b3 g3 b3 d4 b3 / e3 g3 c4 g3 e3 g3 c4 g3>").s("sawtooth").shape(0.3).gain(0.12).lpf(2500).room(.4),',
  '  // Bass — root notes, G2/B2/C3/C3',
  '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
  '  // Acoustic kit: kick на 1/3, snare backbeat, 8th-note hihat',
  '  s("drums_bd ~ drums_bd ~").gain(0.55),',
  '  s("~ drums_sd ~ drums_sd").gain(0.28),',
  '  s("drums_hh*8").decay(.04).sustain(0).gain(0.15)',
  ')',
].join('\n'),
```

Заметки:
- `chord(...).voicing()` — стандартный путь Strudel: аккорды
  пишутся по имени, ноты берёт tonal. См.
  `LiveAudioEngine.ts:140` — `tonal.voicingRegistry` уже настроен.
- `shape(0.3)` на sawtooth эмулирует струнную гитару (чуть
  асимметричный duty-cycle).
- `room(.3..4)` — даёт ту самую «reverb Greenwood».
- Snare на `drums_sd` — сэмпл из CC0 набора (см.
  `feat/drums` коммит), должно звучать как настоящий snare.

---

### 2. `edm-house` — 4-on-the-floor house  
**Вердикт: УЛУЧШИТЬ (medium confidence)**  
**Сложность: M (добавить аккордовый pad + чуть shuffle)**

Проблемы:
- Pluck lead `<a4 c5 e5 g5 b4 a4 c5 e5>` — октавы Am, идёт ровно 8
  нот без ритмического разнообразия. На 4-on-the-floor обычно хоп
  аккордов идет 1/2 такта, не 1/16.
- Snare `s("~ drums_sd ~ drums_sd")` — без clap'а или каких-то
  variation. Типичный house имеет side-chain или хотя бы sub-bass
  envelope.
- Sub-bass `<a2 c3 e3 a2>` — 4 ноты по 1 такту. Для 8-step
  arpeggio lead нужно что-то поактивнее.

Что делать:
- Добавить chord pad через `chord("<Am F C G>").voicing()` —
  типичные «i-VI-III-VII» pop-прогрессии для EDM.
- На hat'e добавить shuffle: `<~ hh [~ hh]>` (тройная структура).
- Lead переписать через swing(0.3) + euclidean-like gaps.

---

### 3. `hiphop-boombap` — boom-bap 90s NYC  
**Вердикт: УЛУЧШИТЬ (high confidence)**  
**Сложность: M**

Проблемы:
- **Нет chord/keys слоя** — рэп без сэмпла не звучит как рэп.
- Snare только на 3. Стандартный boom-bap: snare на 2 и 4 (backbeat).
  «Snare 3» в комментарии — опечатка; код делает `~ ~ sd ~ ~ ~ sd ~`
  (на 3 и 7).
- Vinyl noise `.gain(0.05)` — еле слышно.

Что делать:
- Добавить piano/synth chord comping (Rza-style) 4 аккорда.
- Snare на 2 и 4: `s("~ drums_sd ~ ~ ~ drums_sd ~")`  — нет, лучше
  `s("~ ~ drums_sd ~ ~ drums_sd ~ ~")` — backbeat.
- Vinyl поднять до 0.1–0.15.

---

### 4. `jazz-ii-v-i` — Bebop ii-V-I  
**Вердикт: ОК (мелкие косметика)**  
**Сложность: S**

Хороший пресет: walking bass + comping + ride + brushed snare.
Уже многогранный. Единственное:
- `<Dmin7 G7 Cmaj7>` — 3 аккорда по 4 бита = 12 битный цикл.
  Walking bass `d2 f2 a2 c3 g2 b2 d3 f3 c3 e3 g3 b3` — 12 нот,
  сошлось, ок.

Оставить как есть. **Возможный апгрейд**: добавить 4-й аккорд
(например Am7b5 → Dm7 для ii-V-i-VI траектории).

---

### 5. `ambient-drone` — Eno-style drone  
**Вердикт: ОК + косметика**  
**Сложность: S**

Хороший. Единственное замечание: два слоя `[c2,g2]` с разными
envelope — это ок, но почти дублируют друг друга. Можно один убрать
или разделить по октавам.

Оставить.

---

### 6. `bossa-nova` — Jobim-style  
**Вердикт: ПЕРЕПИСАТЬ (high confidence)**  
**Сложность: L**

Проблемы:
- Bass pattern `<~ a2 ~ a2 a2 ~ e2 d2 ~ c2 e2 a2 ~>` — 12 бит,
  но clave pattern 16 бит. Расходятся. Jobim — это синкопа, но
  bass должен сочетаться с clave, а не параллельно.
- Chord comping — только `<Dm7 G7>` (2 аккорда). Это не bossa. Это
  статичный оборот. Bossa nova стандартно использует
  Dm7 → G7 → Cmaj7 (или Fmaj7 → Bm7b5 → E7 → Am).
- Sparse melodic lead `e5 ~ d5 ~ c5 ~ b4 a4 ~ g4 ~` — 12 бит,
  опять же не в фазе с басом.

Что делать:
- Прогрессия: `<Dm7 G7 Cmaj7 Fmaj7>` — 4 аккорда = 16 бит.
- Bass: выровнять под 16-бит grid. `note("<a2 ~ a2 g2 ~ ~ a2 ~ f2 ~ ~ a2 c3 ~ a2>")` —
  bouncy syncopation, but в 16-бит цикл.
- Clave: `s("rim ~ ~ rim ~ rim ~ ~ rim ~ ~ rim ~ rim ~ ~")` — это
  3+2 son clave (16 шагов).
- Lead: 16-бит паттерн, pentatonic.

---

### 7. `trap-modern` — Modern trap  
**Вердикт: УДАЛИТЬ ❌**  
**Причина (по запросу пользователя):** «trap модерн точно можно убрать»

Конкретно почему:
- Hi-hat rolls `s("hh*4 [hh hh] hh*2 [hh hh hh]")` — разбивки не
  ритмически осмыслены (16 шагов с произвольными группами 4-2-3).
  Trap rolls — это 1/32 на 1/16 или 1/32 триоли по 1/8.
- Snare только на 3 — trap обычно clap/snare на 3 И иногда layer
  на 2-4 без backbeat.
- Bell lead `c5 eb5 g4` — минимальный 3-нотный микс, без
  melo-развития.
- Sub-bass `note("a1 ~ ~ ~ ~ ~ ~ ~")` — звучит 1 такт, потом 7
  тишины. Trap-дропы обычно длинные sub или роллы.

Заменить:
- Удалить `trap-modern`.
- (опционально, см. ниже) Добавить `trap-atlanta` — полноценный
  trap-пресет с 808 roll'ами + clap layer + sparse lead.

### 8. `reggaeton` — Dembow  
**Вердикт: УЛУЧШИТЬ (medium)**  
**Сложность: M**

Dembow pattern `bd ~ sd ~ bd ~ sd hh ~` — 8-битная, классическая.
ОК. Bass `<a1 a2 e2 a1 a1 a2 e2 a1>` — 8 октавных прыжков, не хуки.
Не похоже на «dembow bell». Marimba lead в 13-бит — расходится
с 8-бит dembow.

Что делать:
- Bass: dembow bell паттерн: `note("<a1 ~ a1 e2 ~ a1 e2 a1 ~>")` или
  классический dembow: `note("<a1 a1 a1 e2>")` с octave doubling.
- Marimba переписать в 16-бит cycle с правильными паузами.

---

### 9. `idm-glitch` — Autechre-style  
**Вердикт: ОК (жанр по определению «странный»)**  
**Сложность: S**

Полиметрия «5/4 + 7/8» в коде не работает как задумано:
- `bd ~ ~ ~ ~ bd ~ ~ ~` — 10 шагов, делится на 5/4 по 8-м.
  Но 5/8 = 5 восьмых = 5 шагов. Здесь 10 шагов = 5 пар. На слух
  это просто 5/4.
- Snare `~ ~ ~ sd ~ ~ sd ~` — 9 шагов (странное число).

Оставить — IDM по определению аритмичен «неправильно». Если
слушатель ожидает что-то конкретное, он не туда зашёл.

---

### 10. `dreampop` — Shoegaze  
**Вердикт: ПЕРЕПИСАТЬ (high)**  
**Сложность: L**

Проблемы:
- 16th-note «strum» через `s("~ sd:0.05 ~ sd:0.05 ~ sd:0.05 ~ sd:0.05")` —
  хак: использует snare-сэмпл с тихим gain как струнный «дзинь». Не
  работает, snare не похож на guitar jangle.
- Soft vocal lead через `triangle` — не vocal, а просто синус.
- Bass и kick слабые.

Что делать:
- Strum заменить на `note("e4 ~ b4 ~ e4 ~ b4 ~")` через `s("sawtooth").shape(0.4)` —
  гитарная яркость + `room(.5).delay(.3)` для shoegaze хвоста.
- Pad: `chord("<Am F C G>").voicing().s("triangle").room(.7).gain(.16)` — lush.
- Bass и kick усилить.

---

### 11. `step-grid-demo` — для UI демо  
**Вердикт: ОК (по дизайну — bare-bones)**

Это специально «голая» 4-бит партия для показа сетки Step. Не
трогать.

---

### 12. `piano-ballad` — Salamander piano  
**Вердикт: ОК + косметика**

Использует `piano_a4`/`piano_c4` сэмплы. Работает. Мелкие замечания:
- 16-нотная правая рука может конфликтовать с малым tempo.
- Soft kick `drums_bd ~ ~ drums_bd ~ ~ ~ ~` — редкие, ок для ballad.

---

### 13. `808-classic` (synth) — synth 808  
**Вердикт: УЛУЧШИТЬ (medium)**  
**Сложность: M**

Проблемы:
- `s("bd bd bd bd").s("sine").lpf(80)` — 4 удара подряд, никакого
  паттерна, кроме kick. Это не groove, а метроном.
- Bass `<a1 a1 a1 a1>` — 1 повторяющаяся нота 4 раза. Без
  движения.
- Двухслойный hi-hat (`~ ~ hh` + `~ ~ ~ ~ ~ ~ ~ oh`) — оба
  стартуют от начала цикла и перекрывают друг друга (играют оба
  сразу в начале). Скорее всего ок по амплитудной сумме, но
  может звучать мутно.

Что делать:
- Sub-bass: `<a1 ~ a1 ~ a1 e2 a1 ~ a1>` (8 шагов с motion).
- Kick: классический 808 на 1 и «and» of 2: `s("bd ~ ~ bd ~ ~ bd ~")`.

---

### 14. `analog-bass` (synth) — Moog-style bass  
**Вердикт: ОК (назначение — bass-forward)**

Уже использует `synth_bass-c2` сэмпл, есть counter-bass, kick,
hat. Хорошо для заявленной цели (bass-forward groove).

---

### 15. `808-king` (samples) — Freesound 808  
**Вердикт: ОК**

Классический 4-on-floor с backbeat и clap fill через сэмплы.
Работает.

---

### 16. `lush-pad` (synth) — CC0 pads  
**Вердикт: УЛУЧШИТЬ (low)**  
**Сложность: S**

Проблемы:
- Прогрессия `[c3,e3,g3] [e3,g3,b3] [g3,b3,d4] [a3,c4,e4]` —
  C, Em, G, Am — стандартная нота I-iii-V-vi в Am. Хорошо. Но
  стереотипно.
- 4 слоя: pad low, pad high, strings, sub-bass. Многогранно, всё ок.

Мелкое: можно добавить 5-й слой — bell-style hits
(`note("[c5 ~ ~ e5 ~ g5 ~ ~]").s("triangle").decay(1).gain(0.06).room(.5)`).

Оставить, опционально украсить.

---

### 17. `retro-lead` (synth) — Minimoog lead  
**Вердикт: ОК**

Хорошая synth-lead с delay+room. Работает.

---

### 18. `toms-funk` (samples) — tom fill  
**Вердикт: ОК (назначение — drum-pack demo)**

Только fill, без full groove — так задумано для демо сэмплов.
ОК.

---

## Сводная таблица

| id | вердикт | сложность | действия |
|---|---|---|---|
| creep | ПЕРЕПИСАТЬ | L | MIDI→chord().voicing(), drum samples, room |
| edm-house | УЛУЧШИТЬ | M | chord pad, shuffle hat, активнее lead |
| hiphop-boombap | УЛУЧШИТЬ | M | +piano chord comping, vinyl ↑ |
| jazz-ii-v-i | ОК | S | — |
| ambient-drone | ОК | S | — |
| bossa-nova | ПЕРЕПИСАТЬ | L | 16-бит cycle, 4 аккорда, выровнять bass |
| **trap-modern** | **УДАЛИТЬ** ❌ | 0 | удалить строку; см. plan |
| reggaeton | УЛУЧШИТЬ | M | dembow bell bass, выровнять marimba |
| idm-glitch | ОК | S | — |
| dreampop | ПЕРЕПИСАТЬ | L | настоящий strum, vocal pad, сильнее bass |
| step-grid-demo | ОК (назначение) | 0 | — |
| piano-ballad | ОК+косметика | S | опц. |
| 808-classic | УЛУЧШИТЬ | M | sub-bass motion, groove-паттерн |
| analog-bass | ОК | 0 | — |
| 808-king | ОК | 0 | — |
| lush-pad | ОК+улучшить | S | опц. добавить bell layer |
| retro-lead | ОК | 0 | — |
| toms-funk | ОК (назначение) | 0 | — |

**Статистика:**
- Удалить: 1 (`trap-modern`)
- Переписать: 3 (creep, bossa-nova, dreampop)
- Улучшить: 4 (edm-house, hiphop-boombap, reggaeton, 808-classic)
- Косметика/опц.: 3 (ambient-drone, piano-ballad, lush-pad)
- ОК без изменений: 7

---

## Что **нельзя** делать автоматически

- Удалять пресет, который пользователь сохранил как custom (нет — custom в
  localStorage, builtin кодом; удаление builtin не трогает custom).
- Изменять `presets.test.ts` блок «expects 18 entries» без согласования —
  после удаления trap-modern должно стать 17, и тест надо поправить.
- Трогать `parseStack.test.ts:34` (creep используется в snapshot-тесте) —
  если меняем Creep, надо обновить snapshot строго.
- Трогать `injectMix.test.ts:141` (Creep end-to-end) — там уже
  используется старое имя `sbd ~ sbd ~` (несуществующий sample).
  Это бэк-компат с прошлой версии пресета. Нужно либо обновить,
  либо оставить как есть (наш новый Creep совпадает с ним по
  структуре, но не по именам sample'ов).

---

## Параллельный план для агентов

Предлагаю 5 параллельных воркеров + 1 завершающий. Каждый делает
один файл (или подмножество смежных пресетов), пишет в свою
**отдельную** ветку от master, мержим по очереди после
прохождения `pnpm --filter ui test:precommit`.

> Branch layout: 1 задача = 1 worktree = 1 branch.

### Agent 1 — `feat/presets-creep-bossa`
Один работник (L-уровень задача, изменений много, чтобы не дробить):

1. Переписать **Creep** по спецификации из секции 1.
2. Переписать **Bossa Nova** по спецификации из секции 6.
3. Обновить snapshot Creep в `parseStack.test.ts:34-55` (новые
   названия слоёв + 6 слоёв остаются).
4. **Не трогать** `injectMix.test.ts:141` — там старый snapshot;
   либо адаптировать (если новый Creep по-прежнему 6-слойный
   со структурой похожей, можно вообще ничего не менять;
   но `drums_bd ~ drums_bd ~` теперь правильное имя sample'а,
   нужно чтобы test нашёл `.gain(1)`).

### Agent 2 — `feat/presets-hiphop-reggaeton`
1. **Hip-hop boom-bap** — добавить chord comping слой, исправить
   snare на 2 и 4, поднять vinyl noise.
2. **Reggaeton** — dembow-bell bass, исправить marimba на 16-бит
   cycle.

### Agent 3 — `feat/presets-dreampop-house`
1. **Dreampop** — настоящий strum через `note(...).s("sawtooth").shape(0.4)`,
   заменить white-noise-sd-as-strum; усилить bass/kick.
2. **EDM house** — добавить chord pad; shuffle на hat'е; lead —
   длиннее и богаче.

### Agent 4 — `feat/presets-808classic-bossa` ?
> todo: см. Agent 1 — bossa уже там, разделение не нужно.
> Agent 4 = **`feat/presets-808-classic`** только.

**ЕСЛИ** владелец хочет дополнительный trap-заменитель:

### Agent 4b — `feat/presets-trap-atlanta-add`
> Только если выбран вариант «replace» trap-modern.

1. Удалить запись `id: 'trap-modern'` из массива `BUILTIN_PRESETS`.
2. Добавить запись `id: 'trap-atlanta'` со spec:
   - 808 sub через `note("<a1 [a1 a1] ~ ~ a1 ~ ~ [a1 a1]>").s("sine").lpf(80).gain(0.55)`
   - Kick pattern `bd ~ ~ bd ~ ~ bd ~`
   - Hat rolls через euclidean или strudel `<hh*16 [hh*8] hh*8 [hh*16 hh*8]>`
   - Clap на 3: `s("~ ~ cp ~ ~ ~ ~ ~").gain(0.4)`
   - Sparse bell lead (minor pentatonic) с reverb
3. Обновить `presets.test.ts:6` — `toHaveLength(18)` →
   без изменений (если добавляем trap-atlanta, остаётся 18).
   Убрать `'trap-modern'` из массива ожидаемых id в
   `presets.test.ts:43`.

### Agent 5 — `feat/presets-remove-trap-only`
> Если выбран вариант «просто удалить trap-modern».

1. Удалить запись `id: 'trap-modern'`.
2. `presets.test.ts`:
   - Было `expect(BUILTIN_PRESETS).toHaveLength(18)` → 17.
   - Было expected `['trap-modern', ...]` — убрать.

### Финальный merge-step (я, после всех агентов)

Сделать squash/merge всех 5 веток в `master` через PR / merge,
прогнать:
```bash
pnpm --filter ui run test:precommit
pnpm --filter ui run validate:presets
```

Если всё ок — авто-merge (см. AGENTS.md про авто-merge), иначе
спросить пользователя с конкретным diff'ом.

---

## Что **точно** оставить вне scope

- Перенос `presets.ts` на `decisions/<id>.yaml` (math-coding 3.3) —
  отдельная задача.
- Новые пресеты за рамками удаления trap-modern (`lofi-chill`,
  `dnb`, `uk-garage`, ...) — отдельная задача, не блокер.
- Деплой — после одобрения пользователя.
- Переписывание reducer / state под per-preset config — это
  сделано в feat/dialog-per-preset, не трогаем.
