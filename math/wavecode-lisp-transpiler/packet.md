---
proposition: |
  Score-файл wavecode может быть написан как на JavaScript (текущий режим),
  так и на Scheme-подобном Lisp-диалекте; переключение — в UI; Lisp
  транспнпилируется в вызовы Strudel API на лету через тот же hook
  `webaudioRepl({ transpiler })`, который сейчас использует
  `@strudel/transpiler` для mini-notation.
antithesis: |
  Альтернативы: (1) ClojureScript — production-ready, но требует JVM-build
  pipeline (Closure Compiler), тяжёлый (~250 KB self-hosted cljs runtime),
  избыточно для SPA без backend; (2) BiwaScheme — Scheme-интерпретатор
  в браузере, mature, но eval-на-каждый-keystroke = лаги при live-coding;
  (3) Wisp — Clojure-light → JS, компактно, но малопопулярен;
  (4) остаться на JS-Strudel (нет DSL, проще). Lisp-фронтенд добавляет
  зависимость и поверхность багов; нужна ценность — а именно
  читаемость s-expression'ов для live-coding.
synthesis: |
  Use case — local live-coding музыки; читаемость s-expression'ов и
  REPL-стиль дают реальную ценность (mirror TidalCycles/Hydra мышление).
  Свой лёгкий транспнлятор Scheme → JS (~300 строк) — прагматичный
  компромисс: 0 новых зависимостей, 0 build-pipeline изменений, дизайн
  семантики под Strudel (а не general Lisp). Strudel mini-notation в
  строках проходит as-is через `@strudel/transpiler`. LLM получает
  отдельный system-prompt с описанием диалекта + golden-pair tests
  для round-trip. Язык свапабельный: `LanguageToggle` в UI переключает
  `transpiler`-функцию в `webaudioRepl`.
substrate: |
  ui/src/infrastructure/lisp/{lexer,parser,emitter,transpiler}.ts
  ui/src/infrastructure/lisp/transpiler.test.ts
  ui/src/infrastructure/audio/LiveAudioEngine.ts (транспнлятор свапается)
  ui/src/presentation/components/LanguageToggle.tsx
  ui/src/application/llm/systemPrompts.ts (lisp-вариант)
  ui/src/application/llm/goldenPairs.ts
  ui/src/domain/layers/parseStack.ts (если mini-парсер уже там)
  ui/src/presentation/components/CodeMirror.tsx (подсветка для s-expression)
status: draft
axiom: A1
epistemics:
  - statement: "Strudel evalScope кладёт stack/note/n/seq/slow/fast/gain/lpf/etc. — транспнлятор просто пишет JS-вызовы"
    marker: fact
    evidence: "ui/src/infrastructure/audio/LiveAudioEngine.ts:207 (evalScope) + node_modules/@strudel/core evalScope.mjs"
  - statement: "webaudioRepl({ transpiler }) принимает функцию препроцессинга кода — наш Lisp-транспнлятор свапается сюда"
    marker: fact
    evidence: "ui/src/infrastructure/audio/strudel.d.ts:54-58 (ReplOptions.transpiler)"
  - statement: "Mini-notation в строках обрабатывается @strudel/transpiler.transpiler, наш транспнлятор не трогает содержимое строк"
    marker: fact
    evidence: "node_modules/@strudel/transpiler (default transpiler строков в Step)"
  - statement: "ClojureScript требует JVM-build pipeline — incompatible с SPA-only deploy"
    marker: judgment
    evidence: "shadow-cljs docs + google-closure-compiler dependency"
  - statement: "BiwaScheme — interpreter, eval latency несовместима с 150ms-интервалом live-coding"
    marker: judgment
    evidence: "BiwaScheme benchmarks ~10-50ms per eval; live-coding Strudel re-eval ~150ms cadence"
  - statement: "Lisp-диалект ограничивается Strudel-маппингом (без let/define/lambda/if) — phase 1; полноценный Lisp как phase 2"
    marker: judgment
    evidence: "пользователь выбрал scope: 'Только Strudel-маппинг'"
  - statement: "LLM round-trip требует golden-pair тестов на транспиляцию (Lisp → JS → eval результат идентичен)"
    marker: judgment
    evidence: "пользователь выбрал LLM-режим с golden-pair tests"
---

## Intent

Пользователь пишет score в s-выражениях Scheme-подобного диалекта:
```lisp
(stack
  (note "a4 b4 c5" (slow 2))
  (s "bd*4, ~ sd ~ sd, hh*8" (gain 0.45))
  (n "[55,59,62]*2" (s "sawtooth" (gain 0.18) (lpf 1800))))
```
Транспнлятор превращает это в JS:
```js
stack(
  note("a4 b4 c5").slow(2),
  s("bd*4, ~ sd ~ sd, hh*8").gain(0.45),
  n("[55,59,62]*2").s("sawtooth").gain(0.18).lpf(1800)
)
```
Это исполняется через тот же `webaudioRepl({ transpiler: ourLispTranspiler })`.

## What this is NOT

- **Не полноценный Lisp.** Нет `let`/`define`/`lambda`/`if`. Каждое s-выражение
  маппится 1-в-1 в вызов Strudel API. Это phase 1.
- **Не ClojureScript / BiwaScheme / ParenScript.** Никаких зависимостей,
  свой транспнлятор.
- **Не REPL заменяет Strudel mini-notation.** Mini-notation в строковых
  литералах идёт as-is through `@strudel/transpiler.transpiler`.
- **Не меняет существующий JS-режим.** `LanguageToggle` переключает
  транспнлятор; оба режима живут параллельно.
- **Не custom mini-notation parser.** Существующий `@strudel/transpiler`
  делает это; мы только добавляем Lisp-обёртку.

## Грамматика

```
<prog>      ::= <sexpr>*
<sexpr>     ::= "(" <head> <body> ")"
               | <atom>
<head>      ::= <symbol>           ; имя Strudel-функции: stack, note, s, slow, fast, every, jux, lpf, ...
<body>      ::= <sexpr>*           ; 0 или более аргументов
<atom>      ::= <number>           ; 42, 3.14, -1.5
               | <string>          ; "mini-notation text"
               | <symbol>          ; bare symbol как data ("rev", "sawtooth")
<string>    ::= '"' <chars-with-escapes> '"'
<number>    ::= /-?[0-9]+(\.[0-9]+)?/
<symbol>    ::= /[a-zA-Z_+\-*/<>=!?][a-zA-Z0-9_+\-*/<>=!?]*/

; комментарии
<line-comment>  ::= ';' [^\n]*
<block-comment> ::= '#|' ... '|#'
```

## Семантика

| Lisp | JS | Заметка |
|---|---|---|
| `(head a b c)` | `head(a,b,c)` | функция-вызов |
| `(head a)` | `head(a)` | один аргумент |
| `(head)` | `head()` | нуль аргументов (например, `(stack)`) |
| `42` | `42` | число |
| `3.14` | `3.14` | дробное |
| `"text"` | `"text"` | строка as-is, mini-notation в ней не парсится |
| `rev` | `"rev"` | bare symbol → строковый литерал (для имён эффектов/сэмплов) |
| `sawtooth` | `"sawtooth"` | то же |
| `()` | `Pattern.empty()` | пустой список — sentinel "no pattern" |

**Method-chain правило** (финальная семантика, реализована в `emitter.ts`):

Цепочка `.method(args)` допустима **только** когда:
1. parent — single-pattern constructor (`s`, `note`, `n`, `range`, `run`, ...);
2. arg — s-expression, head ∈ `KNOWN_METHODS` (включая `s`/`note`/`n`).

Иначе arg — позиционный.

```lisp
(note "a4" (slow 2) (gain 0.5))   →   note("a4").slow(2).gain(0.5)   ; chain: parent=note
(n "[55,59,62]*2" (s "sawtooth") (gain 0.18))   →   n("[55,59,62]*2").s("sawtooth").gain(0.18)  ; chain: parent=n, (s ...) ∈ methods
(stack (note "a4") (s "bd"))      →   stack(note("a4"), s("bd"))     ; positional: parent=stack
(every 4 (jux rev) (s "bd"))      →   every(4, jux("rev"), s("bd"))  ; positional: parent=every
(slow 2 (stack (note "a4") (s "bd")))  →  slow(2, stack(note("a4"), s("bd")))  ; chain on outer slow
```

Чтобы chain'нуть на stack — оборачиваем: `(slow 2 (stack ...))`.
Альтернатива: pipe-форма — отдельный пакет (phase 2).

## Worked example

```ts
// ui/src/infrastructure/lisp/transpiler.ts
export const lispTranspiler = (code: string, _strudelTranspiler: unknown) => {
  const tokens = tokenize(code);
  const ast = parse(tokens);
  const output = emit(ast);
  return { output, miniLocations: [] };  // mini-locations пока пусты — мини-парсер уже в Strudel
};

// ui/src/infrastructure/audio/LiveAudioEngine.ts
import { lispTranspiler } from '../lisp/transpiler';

const repl = webaudioRepl({
  audioContext,
  transpiler: languageMode === 'lisp' ? lispTranspiler : modules.transpilerMod.transpiler,
});
```

```tsx
// ui/src/presentation/components/LanguageToggle.tsx
export const LanguageToggle = () => {
  const mode = useLanguageMode();  // 'js' | 'lisp'
  return <ToggleGroup options={['js', 'lisp']} value={mode} onChange={setMode} />;
};
```

## Golden-pair тесты (для LLM round-trip)

```ts
// ui/src/application/llm/goldenPairs.ts
export const goldenPairs: ReadonlyArray<{ lisp: string; js: string }> = [
  { lisp: '(stack (note "a4 b4 c5") (s "bd sd hh"))',
    js:   'stack(note("a4 b4 c5"), s("bd sd hh"))' },
  { lisp: '(note "a4 b4" (slow 2) (gain 0.5))',
    js:   'note("a4 b4").slow(2).gain(0.5)' },
  { lisp: '(every 4 (jux rev) (s "bd notes"))',
    js:   'every(4, jux(rev, s("bd notes")))' },
  // ... 30+ пар
];
```

Тест: `lispTranspiler(pair.lisp)` должен вернуть код, который при
eval даёт тот же Strudel-pattern что `pair.js`.

## Open questions

1. **Lisp-vs-arg для известных методов** — нужно ли явное `^method`
   маркирование, или эвристика "head ∈ known-methods" ok?  → **решено**:
   эвристика + ограничение "parent — single-pattern constructor".
2. **CodeMirror подсветка для s-expression** — парсер Lezer с уже
   существующим для JS, или отдельный для Lisp? Минимально: парные
   скобки highlight + comment. Phase 2.
3. **`'` (quote) в phase 1?** — нет, pattern как data не нужен.
4. **Decimal notation для slow/fast** — Strudel принимает дробные (`slow 0.5`),
   парсер поддерживает `0.5`, `-1.5`. **решено**.

## Phases

- **Phase 1 (этот пакет):** транспнлятор + тесты + LanguageToggle +
  integration в LiveAudioEngine. LLM НЕ на Lisp.
- **Phase 2 (отдельный пакет):** LLM-system-prompt + golden-pair tests +
  unit-tests на транспнляцию.

## Status

**draft.** Phases 2 и 3 ещё не сделаны. См. `witness` после merge + verify.