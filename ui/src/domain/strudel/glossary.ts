/**
 * Inline vocabulary glossary for hover-tooltips in the CodeMirror
 * score editor.
 *
 * Pure data + pure lookup functions. No imports from `@codemirror/*`
 * (the editor wiring lives in `CodeMirrorEditorImpl.tsx`). No
 * imports from `infrastructure/*`. This file is domain-pure and
 * safe to import from anywhere.
 *
 * Three lookup entry-points cover the three vocabularies the
 * editor surface cares about:
 *
 *   1. **`getTooltipForToken(name)`** — Strudel functions
 *      (`note`, `s`, `.gain`, `.lpf`, …). Called when the cursor
 *      sits on an identifier outside any string literal. Method-
 *      call syntax (`.gain`, `.lpf`) is normalised by stripping a
 *      single leading `.` before lookup, so callers can pass
 *      either form.
 *
 *   2. **`getTooltipForSample(name)`** — Strudel sample names
 *      (`bd`, `sd`, `drums_bd`, …). Called when the cursor sits
 *      inside a string literal and the local token is purely
 *      alpha/underscore (no digit → it's a sample, not a note).
 *
 *   3. **`getTooltipForNote(name)`** — note-name pattern matching
 *      (`c4`, `e5`, `a#3`, `bb2`). Called when the cursor sits
 *      inside a string literal and the local token matches
 *      `^[a-g]#?b?\d$` (with optional accidental + octave).
 *
 * Unknown names always return `null` — this is the **silence
 * contract**: hover-tooltips must never display garbage for
 * tokens we don't recognise. Better to show no tooltip than a
 * misleading one.
 *
 * Coverage is locked to functions / samples that actually appear
 * in `BUILTIN_PRESETS` (see `ui/src/domain/presets.ts`). Adding a
 * new function to the glossary that nobody uses is the same
 * mistake as documenting an undocumented API: it ages badly.
 *
 * Locale: Russian. The whole app is русскоязычный (see README,
 * `lang: ru` in the PWA manifest, all UI strings). English alias
 * is intentionally out of scope — that's a separate decision
 * (`vocab-i18n`).
 */

export type TooltipInfo = {
  readonly name: string;
  /** 1–2 строки по-русски: что делает и зачем. */
  readonly ru: string;
  /** Короткий пример кода (monospace). Не более 60 chars. */
  readonly example: string;
};

type FunctionGlossary = Readonly<Record<string, TooltipInfo>>;
type SampleGlossary = Readonly<Record<string, TooltipInfo>>;

// ---------------------------------------------------------------------------
// 1. Functions — used at top-level or as method-chains
// ---------------------------------------------------------------------------
//
// Keys are the bare function name WITHOUT a leading `.`. Callers
// (the hover source in CodeMirrorEditorImpl) strip the leading `.`
// from `.gain(...)`, `.lpf(...)`, etc. before lookup so that one
// entry serves both `gain(...)` and `.gain(...)`.
//
// 17 functions, all observed in BUILTIN_PRESETS:
//   note / s / n / chord / cat / stack / slow / fast / every
//   gain / lpf / hpf / room / delay / swing / decay / sustain

const FUNCTIONS: FunctionGlossary = {
  note: {
    name: 'note',
    ru: 'Синтезатор нот: играет мелодию. Строка в кавычках — последовательность нот (`c4 e4 g4`).',
    example: 'note("c4 e4 g4 c5").s("triangle")',
  },
  s: {
    name: 's',
    ru: 'Сэмплы (драм-машина / пэды). Строка — паттерн из имён сэмплов: `bd sd hh cp`.',
    example: 's("bd sd hh sd")',
  },
  n: {
    name: 'n',
    ru: 'Управление номером шага в step-секвенсоре. Обычно внутри `<>` brackets.',
    example: 'n("0 2 4 7").s("piano")',
  },
  chord: {
    name: 'chord',
    ru: 'Аккорды: вращает качества (`Am F C G`) и прогоняет через `.voicing()` для голосов.',
    example: 'chord("<Am F C G>").voicing()',
  },
  cat: {
    name: 'cat',
    ru: 'Склейка паттернов: `cat(A, B)` играет A, потом B, потом снова A. Циклично по 1 такт.',
    example: 'cat(s("bd*4"), s("hh*8"))',
  },
  stack: {
    name: 'stack',
    ru: 'Слои одновременно: `stack(layer1, layer2)` играет параллельно (как mixer channels).',
    example: 'stack(s("bd*4"), note("c4 e4"))',
  },
  slow: {
    name: 'slow',
    ru: 'Замедление: `slow(2)` растягивает паттерн в 2 раза (было 8 бит → стало 16).',
    example: 's("bd sd hh cp").slow(2)',
  },
  fast: {
    name: 'fast',
    ru: 'Ускорение: `fast(2)` сжимает паттерн в 2 раза (было 8 бит → стало 4).',
    example: 's("bd sd").fast(2)',
  },
  every: {
    name: 'every',
    ru: 'Каждый N-й цикл: `every(3, slow(2))` — каждый 3-й такт применяет slow(2).',
    example: 's("bd sd").every(3, fast(2))',
  },
  gain: {
    name: 'gain',
    ru: 'Громкость слоя: 0 = тишина, 1 = номинал. Часто 0.1-0.4 для mix.',
    example: 's("bd").gain(0.5)',
  },
  lpf: {
    name: 'lpf',
    ru: 'Low-pass filter: срезает всё выше N Hz. Меньше N → глуше; больше → ярче.',
    example: 's("hh").lpf(8000)',
  },
  hpf: {
    name: 'hpf',
    ru: 'High-pass filter: срезает всё ниже N Hz. Убирает низ и bass-mud.',
    example: 's("bd").hpf(60)',
  },
  room: {
    name: 'room',
    ru: 'Реверберация: 0 = сухо, 1 = много echo. Добавляет пространство.',
    example: 's("snare").room(0.3)',
  },
  delay: {
    name: 'delay',
    ru: 'Задержка-эхо: число = доля такта (0.25 = sixteenth-note delay).',
    example: 'note("c4 e4 g4").delay(0.25)',
  },
  swing: {
    name: 'swing',
    ru: 'Shuffle / swing: 0 = ровные 8-е, 1 = жёсткий swing. 0.2-0.5 для groove.',
    example: 's("hh*8").swing(0.3)',
  },
  decay: {
    name: 'decay',
    ru: 'Время затухания ноты в секундах. Маленький (0.05) = короткий, большой (2) = длинный.',
    example: 'note("c4").decay(0.4)',
  },
  sustain: {
    name: 'sustain',
    ru: 'Уровень громкости на «хвосте» ноты (после attack+decay). 0 = без sustain, 1 = максимум.',
    example: 'note("c4").decay(0.5).sustain(0.2)',
  },
  attack: {
    name: 'attack',
    ru: 'Время нарастания ноты в секундах. Маленький (0.001) = перкуссия; большой (1-2) = плавный pad.',
    example: 'note("c4").attack(0.05)',
  },
  release: {
    name: 'release',
    ru: 'Время затухания после окончания ноты (хвост после release-уровня). Большой = pad с длинным echo.',
    example: 'note("c4").release(2)',
  },
  voicing: {
    name: 'voicing',
    ru: 'Раскладывает аккорд из `chord("<Am F C G>")` в конкретные ноты (CEG для Am, FAC для F и т.д.).',
    example: 'chord("<Am F C G>").voicing()',
  },
  shape: {
    name: 'shape',
    ru: 'Duty-cycle / shape для pulse-wave: 0 = чистая sine, 0.5 = square, 1 = инвертированная sine.',
    example: 'note("c4").s("sawtooth").shape(0.6)',
  },
  detune: {
    name: 'detune',
    ru: 'Расстройка в центах (1/100 полутона). Добавляет «жирность» через небольшую расстройку голосов.',
    example: 'note("a2").s("sawtooth").detune(8)',
  },
  range: {
    name: 'range',
    ru: 'LFO / modulation source: плавно ходит между lo и hi (часто используется как `.lpf(sine.range(400, 4000))`).',
    example: 'sine.range(400, 4000)',
  },
};

// ---------------------------------------------------------------------------
// 2. Samples — bank names that resolve in Strudel's sample bank
// ---------------------------------------------------------------------------
//
// Two naming conventions in Strudel:
//   - Short names (`bd`, `sd`, `hh`) — generic Roland TR / 808.
//   - Bank-prefixed (`drums_bd`, `drums_sd`, `drums_hh`) —
//     explicit bank from the wavecode `drums` bank (Freesound CC0).
//
// We list both forms so that hover works on either preset style.

const SAMPLES: SampleGlossary = {
  bd: {
    name: 'bd',
    ru: 'Bass drum (kick) — низкий бум-удар. 808-style.',
    example: 's("bd*4")',
  },
  sd: {
    name: 'sd',
    ru: 'Snare drum — резкий backbeat (биты 2 и 4).',
    example: 's("~ sd ~ sd")',
  },
  hh: {
    name: 'hh',
    ru: 'Closed hi-hat — короткий металлический тик.',
    example: 's("hh*8")',
  },
  oh: {
    name: 'oh',
    ru: 'Open hi-hat — длинный звон, обычно на off-beat.',
    example: 's("~ ~ oh ~")',
  },
  cp: {
    name: 'cp',
    ru: 'Clap — хлопок, мощнее чем snare.',
    example: 's("~ ~ cp ~")',
  },
  drums_bd: {
    name: 'drums_bd',
    ru: 'Kick из CC0 Freesound-bank (warm 808-style, чуть мягче чем чистый `bd`).',
    example: 's("drums_bd*4")',
  },
  drums_sd: {
    name: 'drums_sd',
    ru: 'Snare из CC0 Freesound-bank — натуральный, без характерного 808-хруста.',
    example: 's("~ drums_sd ~ drums_sd")',
  },
  drums_hh: {
    name: 'drums_hh',
    ru: 'Hi-hat из CC0 Freesound-bank — чуть темнее и короче чем стандарт.',
    example: 's("drums_hh*8")',
  },
  drums_ride: {
    name: 'drums_ride',
    ru: 'Ride cymbal — длинный металлический свинг (jazz, fusion).',
    example: 's("drums_ride*4")',
  },
  drums_crash: {
    name: 'drums_crash',
    ru: 'Crash cymbal — мощный акцент, обычно на 1-м бите новой фразы.',
    example: 's("drums_crash ~ ~ ~")',
  },
};

// ---------------------------------------------------------------------------
// 3. Notes — pattern-based lookup (any valid Strudel note name)
// ---------------------------------------------------------------------------
//
// Note grammar (Strudel):
//   [a-g] (?: [#bB] )? \d
// Examples:
//   c4   (C middle)
//   a#3  (A sharp, 3-я октава)
//   bb2  (B flat, 2-я октава) — Strudel также принимает `b` для flat.
//   D5   (uppercase D, 5-я октава) — допускаем; нормализуем до lowercase.
//
// `NOTE_REGEX` is exposed (not just internal) so the hover source can
// short-circuit before slicing the document — useful when the cursor
// sits on whitespace or punctuation.

export const NOTE_REGEX = /^[a-gA-G][#b]?\d$/;

const NOTE_LETTERS: Readonly<Record<string, string>> = {
  c: 'до',
  d: 'ре',
  e: 'ми',
  f: 'фа',
  g: 'соль',
  a: 'ля',
  b: 'си',
};

const NOTE_ACCIDENTALS: Readonly<Record<string, string>> = {
  '#': 'диез',
  b: 'бемоль',
};

/**
 * Look up a Strudel-function name (without leading `.`).
 *
 * Returns `null` for unknown functions — caller treats this as
 * "show no tooltip".
 *
 * Lookup is case-insensitive: `s` and `S` resolve the same way.
 * Most Strudel code is lowercase by convention, but we tolerate
 * both to match the rest of the codebase's casing policies.
 */
export const getTooltipForToken = (name: string): TooltipInfo | null => {
  if (!name) return null;
  const key = name.toLowerCase();
  const entry = FUNCTIONS[key];
  return entry ?? null;
};

/**
 * Look up a Strudel-sample name (e.g. `bd`, `drums_bd`).
 *
 * Returns `null` for unknown samples — caller treats this as
 * "show no tooltip".
 *
 * Lookup is case-sensitive (Strudel sample names are lowercase).
 */
export const getTooltipForSample = (name: string): TooltipInfo | null => {
  if (!name) return null;
  const entry = SAMPLES[name];
  return entry ?? null;
};

/**
 * Look up a Strudel-note name (e.g. `c4`, `a#3`, `bb2`).
 *
 * Returns `null` if `name` doesn't match the note regex. Russian
 * description includes letter name + accidental (if any) +
 * octave.
 *
 * Examples:
 *   c4   → "нота до, 4-я октава"
 *   a#3  → "нота ля-диез, 3-я октава"
 *   bb2  → "нота си-бемоль, 2-я октава"
 */
export const getTooltipForNote = (name: string): TooltipInfo | null => {
  if (!name) return null;
  const normalised = name.toLowerCase();
  if (!NOTE_REGEX.test(normalised)) return null;
  const letter = normalised[0];
  const rest = normalised.slice(1);
  const accidental = rest[0] === '#' || rest[0] === 'b' ? rest[0] : '';
  const octave = rest.replace(/[#b]/g, '');
  const letterName = NOTE_LETTERS[letter ?? ''] ?? letter ?? '?';
  const accidentalName = accidental ? `-${NOTE_ACCIDENTALS[accidental] ?? accidental}` : '';
  const octaveName = octave ? `, ${octave}-я октава` : '';
  return {
    name: normalised,
    ru: `нота ${letterName}${accidentalName}${octaveName}`,
    example: `note("${normalised}")`,
  };
};

/**
 * Total number of vocabulary entries across all three lookups.
 * Exposed for the test suite's coverage assertion.
 */
export const VOCAB_SIZE = {
  functions: Object.keys(FUNCTIONS).length,
  samples: Object.keys(SAMPLES).length,
  noteLetters: Object.keys(NOTE_LETTERS).length,
} as const;