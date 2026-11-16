/**
 * layerSound — «на чём играет слой» как доменная величина.
 *
 * Зачем этот модуль
 * -----------------
 * Жалоба была: «мы видим ноты, но они применяются и играют всегда
 * фортепиано, непонятно как это пользоваться». У неё ровно две
 * технические причины:
 *
 *   1. Слой партитуры умеет играть на чём угодно — в слое есть
 *      `.s("triangle")`, `.s("synth_pad")` и т.д. Но НИГДЕ в
 *      интерфейсе не было видно, какой звук у какого слоя, и
 *      не было способа его сменить: микшер показывал имя слоя
 *      («0: Sequence», «1: setCpm») и фейдер, но не звук.
 *   2. Пиано-ролл записывал ноты как `note("c4")` — без `.s(...)`.
 *      В Strudel это значит «инструмент по умолчанию», то есть
 *      всегда пианино. Выбрать другой инструмент было негде.
 *
 * Этот модуль — чистая часть решения: он умеет СКАЗАТЬ, какой звук
 * у слоя, и ПЕРЕПИСАТЬ его. Никакого знания об интерфейсе, никакого
 * доступа к приложению — только текст слоя.
 *
 * Как ищется `.s("…")`
 * -------------------
 * Сканирование идёт посимвольно, а не регуляркой: регулярка нашла бы
 * `.s("…")` внутри строкового литерала («текст с `.s(` внутри») или
 * внутри комментария. Сканер пропускает строковые литералы и оба
 * вида комментариев, поэтому находит ТОЛЬКО настоящий вызов `.s(...)`.
 *
 * Что считается «инструментом слоя»
 * ---------------------------------
 * Слой-нота (`note(...)`, `n(...)`) — мелодический: его звук можно
 * выбрать. Слой-сэмпл (`s("drums_bd ...")`) — ударный: там `.s(...)`
 * задаёт сам сэмпл, а не инструмент, и «сменить инструмент» в нём
 * нечего. Поэтому `isMelodicLayer` отвечает по ведущей функции.
 */

/** Найденный вызов `.s("…")` в тексте слоя. */
export type SoundCall = {
  /** Значение строкового аргумента — имя звука в `soundMap`. */
  readonly id: string;
  /** Начало `.s(` в тексте слоя (offset). */
  readonly start: number;
  /** Конец вызова `.s(…)` — offset за последней `)`. */
  readonly end: number;
  /** Кавычка аргумента — её сохраняем при переписывании. */
  readonly quote: '"' | "'" | '`';
};

/** Слой несёт ноты — его инструмент можно выбрать. */
export const isMelodicLayer = (source: string): boolean => {
  const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(source.trim());
  const fn = m?.[1];
  return fn === 'note' || fn === 'n';
};

/**
 * Конец КОДА слоя — позиция за последним значащим символом.
 *
 * Нужен, чтобы дописать `.s("…")` в конец цепочки, а не в конец
 * строки: у слоя может быть хвостовой комментарий
 * (`note("c4") // мелодия`), и дописывание после него сломало бы
 * код. Пробелы и переводы строк в конце не считаются кодом.
 */
const codeEnd = (text: string): number => {
  const n = text.length;
  let i = 0;
  let last = -1;
  while (i < n) {
    const ch = text[i]!;
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      last = i - 1;
      continue;
    }
    // Пробелы и переводы строк кодом НЕ считаются: иначе вставка
    // `.s("…")` уехала бы за перевод строки и сломала бы слой.
    if (!/\s/.test(ch)) last = i;
    i += 1;
  }
  return last + 1;
};

/** Прочитать строковый аргумент вызова, чья `(` стоит в `openIdx`. */
const readStringArg = (
  text: string,
  openIdx: number,
): { readonly id: string; readonly quote: '"' | "'" | '`'; readonly end: number } | null => {
  let i = openIdx + 1;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  i += 1;
  let value = '';
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') {
      // Экранированный символ внутри литерала: берём его как есть.
      value += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    value += text[i];
    i += 1;
  }
  if (text[i] !== quote) return null; // незакрытый литерал — не наш вызов
  i += 1;
  // После аргумента допустим только пробелы и закрывающая скобка:
  // `.s("bd", "sd")` — это не простой выбор одного звука.
  let j = i;
  while (j < text.length && /\s/.test(text[j]!)) j += 1;
  if (text[j] !== ')') return null;
  return { id: value, quote, end: j + 1 };
};

/**
 * Последний вызов `.s("…")` в тексте слоя — тот, что реально звучит.
 *
 * «Последний»: в цепочке Strudel побеждает ПОСЛЕДНИЙ вызов
 * (`note("c4").s("piano").s("triangle")` играет треугольником).
 * Возвращается `null`, если вызова нет или его аргумент не строковый
 * литерал (`.s(someVar)` менять нельзя — нечего подставить).
 */
export const findSoundCall = (source: string): SoundCall | null => {
  const n = source.length;
  let i = 0;
  let found: SoundCall | null = null;
  while (i < n) {
    const ch = source[i]!;
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '.' && source[i + 1] === 's') {
      const after = source[i + 2];
      const isCall = after === '(' || (after !== undefined && /\s/.test(after));
      if (isCall) {
        let j = i + 2;
        while (j < n && /\s/.test(source[j]!)) j += 1;
        if (source[j] === '(') {
          const arg = readStringArg(source, j);
          if (arg !== null) found = { id: arg.id, start: i, end: arg.end, quote: arg.quote };
          i = j + 1;
          continue;
        }
      }
    }
    i += 1;
  }
  return found;
};

/**
 * Звук слоя: имя из `.s("…")` или `null`, если звук не задан явно.
 *
 * `null` ≠ «пианино»: отсутствие `.s(...)` значит «инструмент по
 * умолчанию у Strudel», и это разные вещи — интерфейс должен
 * показывать и то, и другое.
 */
export const detectLayerSound = (source: string): string | null =>
  findSoundCall(source)?.id ?? null;

/**
 * Переписать звук слоя на `id`.
 *
 * Если `.s("…")` уже есть — заменяется ПОСЛЕДНИЙ вызов (остальные
 * перезаписываются им). Если нет — `.s("id")` дописывается в конец
 * цепочки. Хвостовые комментарии и форматирование сохраняются.
 */
export const replaceLayerSound = (source: string, id: string): string => {
  const call = findSoundCall(source);
  if (call !== null) {
    const quoted = `${call.quote}${id}${call.quote}`;
    return `${source.slice(0, call.start)}.s(${quoted})${source.slice(call.end)}`;
  }
  const cut = codeEnd(source);
  return `${source.slice(0, cut)}.s("${id}")${source.slice(cut)}`;
};

/**
 * Есть ли у слоя явный звук, который можно показать в интерфейсе.
 *
 * `true` — слой уже звучит чем-то конкретным; `false` — слой
 * унаследует инструмент по умолчанию (пианино).
 */
export const hasExplicitSound = (source: string): boolean =>
  findSoundCall(source) !== null;
