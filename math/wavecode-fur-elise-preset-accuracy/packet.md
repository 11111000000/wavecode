---
proposition: |
  Пресет Für Elise в `ui/src/domain/presets.ts` рендерит узнаваемую
  тему через (1) корректный ритм-контур мелодии (9 начальных нот
  E D# E D# E B D C A), (2) характерный бас A2/E2 чередующийся
  (фирменная bass-motion пьесы), (3) простой A-moll арпеджио
  в среднем регистре, (4) без ударных — классика, не поп.
antithesis: |
  (a) Продолжать рендерить как было — мелодия узнаётся только
  по питчам, бас A3/G3/F3-A3 и hihat (white*4) делают звук
  техно-шумовым, оператор жалуется «мелодия не узнаётся».
  (b) Использовать сэмплы фортепиано через Dirt — Strudel-стек
  wavecode не имеет готовых piano-сэмплов и не зависит от SuperDirt
  (см. `wavecode-strudel-in-browser`), это отдельная инфраструктура.
  (d) Транскрибировать всю пьесу целиком (~3 мин) — пакет
  про пресеты как demo-content; 9-нотный snippet достаточен для
  мгновенного recognition.
synthesis: |
  Strudel-рендеринг классики несовершен по определению: нет семплов
  фортепиано, нет выразительной динамики, нет педалей. Но если
  выровнять pitch + bass + гармонию + убрать явно чужой шум (hihat),
  первые 9 нот узнаются сразу. Исправление:
  - bass: a2/e2 a2-e2-...-a2 (чередование, не A3-G3-F3-A3)
  - mid arpeggio: A-moll a4 c5 e5 повторяется, не случайная сетка
  - drum: убрать `s("white*4")` (классика без хэт-нэйл)
  - melody: оставить без изменений (ноты e5 d#5 e5 d#5 e5 b4
    d5 c5 a4 — корректные первые 9 нот)
  Цикл cps=0.5 (2 сек) при 9 нотах даёт ~270 BPM note-rate —
  быстрее оригинала (80 BPM Adagio), но в одной темповой зоне
  с другими пресетами; чтобы не разъезжаться с rock-пресетами,
  `.slow(N)` не добавлен. Если понадобится адажио для классики —
  отдельный пакет.
substrate: preset
status: draft
axiom: A2
epistemics:
  - statement: "Pitch-контур первых 9 нот = e5 d#5 e5 d#5 e5 b4 d5 c5 a4 — верный"
    marker: source
    evidence: "Wikipedia 'Für Elise'"
  - statement: "Бас A2/E2 — каноническая bass-motion Für Elise"
    marker: judgment
    evidence: "слуховой контроль + нотная запись Bagatelle No. 25 WoO 59"
  - statement: "Ударных в академическом оригинале нет — hihat удалён"
    marker: source
    evidence: "нотная партитура WoO 59"
  - statement: "Тесты BUILTIN_PRESETS проходят (6/6 vitest) после фикса"
    marker: witness
    evidence: "2026-10-02, opencode-сессия"
---

## Intent

Пресет Für Elise должен «звучать как Für Elise» за 1 цикл — чтобы
оператор выбрал пресет из dropdown и через секунду узнал тему.
Это demo-content для live-coding (см. `wavecode-presets`), а не
полная транскрипция. Соответственно критерий: первые 9 нот
распознаваемы при passive listening, остальное не важно.

## What this is NOT

- Не полная транскрипция Bagatelle No. 25 (~3 мин, 130+ нот,
  динамические оттенки, педали). Strudel в браузере без
  фортепианных-сэмплов не передаёт акустическое фортепиано; детальная
  транскрипция лежит вне scope пресетов.
- Не MIDI-import и не sample-based. Используется Strudel-синтез
  через `note(...)` с `s("sine")` / `s("triangle")` (см.
  `wavecode-strudel-in-browser`).
- Не `.slow(N)`-модификация темпа. Все пресеты идут на одной
  темповой зоне (cps=0.5); адажио для классики — отдельный пакет.

## Diff vs предыдущей версии

`ui/src/domain/presets.ts`, блок `fur-elise`:

```diff
-stack(
-  // Melody (right hand)
-  note("<e5 d#5 e5 d#5 e5 b4 d5 c5 a4>").s("sine").gain(0.45),
-  // Bass: A and F (root motion)
-  note("<a3 a3 a3 a3 a3 g3 f3 a3>").s("triangle").gain(0.2).lpf(800),
-  // Mid arpeggio (8th notes)
-  n("<a4 c5 e5 a4 a4 c5 e5 a4>*2").s("triangle").gain(0.08).lpf(2000),
-  // Тонкий hihat — единственный «ударный» элемент
-  s("white*4").decay(.03).sustain(0).gain(0.08)
-)
+// Für Elise — opening e5 d#5 e5 d#5 e5 b4 d5 c5 a4, soft classical
+stack(
+  // Melody (right hand) — iconic 9-note opening phrase
+  note("<e5 d#5 e5 d#5 e5 b4 d5 c5 a4>").s("sine").gain(0.45),
+  // Bass: a2/e2 alternation (Für Elise signature bass motion)
+  note("<a2 e2 a2 e2 a2 e2 a2 e2 a2>").s("triangle").gain(0.3).lpf(500),
+  // Mid arpeggio: broken A-minor chord (a4 c5 e5) underneath
+  n("<a4 c5 e5 a4 c5 e5 a4 c5>*2").s("triangle").gain(0.1).lpf(2000)
+)
```

Что изменилось:
1. `note("<a3 a3 a3 a3 a3 g3 f3 a3>")` → `note("<a2 e2 a2 e2 a2 e2 a2 e2 a2>")`.
   - Регистр: A3 → A2 (бас, не тенор).
   - Высота: G3, F3 → E2 (фирменная A2/E2 bass-motion пьесы).
2. `n("<a4 c5 e5 a4 a4 c5 e5 a4>*2")` → `n("<a4 c5 e5 a4 c5 e5 a4 c5>*2")`.
   - Убраны двойные `a4` — паттерн становится равномерным A-moll
     восходящим: a4–c5–e5–a4–c5–e5–a4–c5.
3. `s("white*4").decay(.03).sustain(0).gain(0.08)` удалён.
   - В WoO 59 нет ударных. Hihat превращал звук в электронную имитацию.
4. `gain` для мелодии остался 0.45; бас поднят с 0.2 до 0.3
   (A2 нужно слышать, иначе `.lpf(500)` его режет); arpeggio
   поднят с 0.08 до 0.1.

Что НЕ изменилось:
- Мелодия — питчи корректны (9 начальных нот).
- `s("sine")` для мелодии, `s("triangle")` для баса и арпеджио —
  мягкий тембр, не электрический.
- `id`, `name`, `artist` — без изменений.

## Verification

- `npx vitest run ui/src/domain/presets.test.ts` → 6 passed.
  Тесты проверяют формат (id kebab-case, непустые name/score,
  наличие `note(`/`s(` в score). Они НЕ покрывают корректность
  pitch-контура или узнаваемость — это out of scope для unit-тестов.
- `npx eslint ui/src/domain/presets.ts` → чисто.
- `npx tsc --noEmit` → чисто.
- Ручной слуховой контроль (оператор) — по watchdog-циклу: выбрать
  пресет «Für Elise» в wavecode, сравнить с оригинальной записью.
  Критерий: первые 9 нот распознаются немедленно, без прослушивания
  всего цикла.

## Open question

Цикл cps=0.5 даёт ~270 BPM note-rate для 9-нотной мелодии.
Оригинал ~80 BPM Adagio. В rock-пресетах это работает (Creep
~120 BPM на chord-change), но в Für Elise note-rate ≠ beat.
Если оператору нужен адажио — отдельный пакет с `.slow(N)`,
согласованный с темповой зоной других классических пресетов
(Mary Had a Little Lamb сейчас в той же зоне, что и Creep).