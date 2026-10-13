import type { JSX } from 'solid-js';
import { For } from 'solid-js';

export type SegKind = 'comment' | 'code' | 'mini' | 'blank';

export type SnippetLine = ReadonlyArray<
  | { t: 'comment'; text: string }
  | { t: 'code'; text: string }
  | { t: 'mini'; text: string }
  | { t: 'blank' }
>;

/**
 * Живой снипплет Strudel mini-notation для лендинга.
 * Не eval-ится (AudioContext заблокирован до user-gesture); показывается
 * ради красивой подсветки. Редактор (/) загрузит этот же snippet, если
 * пользователь кликнет «Открыть редактор».
 */
export const HERO_SNIPPET: ReadonlyArray<SnippetLine> = [
  [
    { t: 'comment', text: '// Creep (Radiohead) — G → B → C → Cm в инди-рок 4/4' },
  ],
  [
    { t: 'code', text: 'stack(' },
  ],
  [
    { t: 'code', text: '  ' },
    { t: 'comment', text: '// Bass: root notes' },
  ],
  [
    { t: 'code', text: '  note(' },
    { t: 'mini',  text: '"<g2 b2 c3 c3>"' },
    { t: 'code', text: ').s("sawtooth").gain(0.4).lpf(300),' },
  ],
  [
    { t: 'code', text: '  ' },
    { t: 'comment', text: '// Chord pad' },
  ],
  [
    { t: 'code', text: '  note(' },
    { t: 'mini',  text: '"<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>"' },
    { t: 'code', text: ').s("triangle").gain(0.2).lpf(1500),' },
  ],
  [
    { t: 'code', text: '  ' },
    { t: 'comment', text: '// 8th-note arpeggio' },
  ],
  [
    { t: 'code', text: '  n(' },
    { t: 'mini',  text: '"<55 67 59 67 62 67 59 67>*2"' },
    { t: 'code', text: ').s("sawtooth").gain(0.12).lpf(1500),' },
  ],
  [
    { t: 'code', text: '  s(' },
    { t: 'mini',  text: '"drums_bd ~ drums_bd ~"' },
    { t: 'code', text: ').gain(0.5),' },
  ],
  [
    { t: 'code', text: '  s(' },
    { t: 'mini',  text: '"~ white ~ white"' },
    { t: 'code', text: ').decay(.05).sustain(0).gain(0.22),' },
  ],
  [
    { t: 'code', text: '  s(' },
    { t: 'mini',  text: '"white*8"' },
    { t: 'code', text: ').decay(.04).sustain(0).gain(0.15)' },
  ],
  [
    { t: 'code', text: ')' },
  ],
];

/**
 * Структурированный текст сниппета — для кнопки «Открыть редактор».
 * Используем редактор с этим текстом по умолчанию.
 */
export const HERO_SNIPPET_TEXT: string = HERO_SNIPPET
  .map((line) => line.map((seg) => ('text' in seg ? seg.text : '')).join(''))
  .join('\n');

/* ─── inline JSX-рендер сниппета ─────────────────────────── */

type TokKind = 'comment' | 'fn' | 'num' | 'mini' | 'code' | 'plain';

const colorize = (text: string): JSX.Element => {
  const tokens: Array<{ kind: TokKind; value: string }> = [];
  const regex =
    /(\/\/[^\n]*|"[^"]*"|`[^`]*`|\b(stack|note|seq|cat|n|s|every|fast|slow|jux|rev|sometimes|mask|chop|add|sub|mul|div|struct|cps|hush|room|gain|lpf|hpf|decay|sustain|attack|release|pan|orbit|chord)\b|\b[0-9]+(?:\.[0-9]+)?\b|<[^>]*>|\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[^\sA-Za-z0-9_<"/]+|\s+)/g;

  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) tokens.push({ kind: 'plain', value: text.slice(last, m.index) });
    if (m[1] !== undefined)      tokens.push({ kind: 'comment', value: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'fn',      value: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: 'num',     value: m[3] });
    else if (m[4] !== undefined) tokens.push({ kind: 'mini',    value: m[4] });
    else if (m[5] !== undefined) tokens.push({ kind: 'code',    value: m[5] });
    else if (m[6] !== undefined) tokens.push({ kind: 'code',    value: m[6] });
    else if (m[7] !== undefined) tokens.push({ kind: 'code',    value: m[7] });
    else if (m[8] !== undefined) tokens.push({ kind: 'plain',   value: m[8] });
    else                          tokens.push({ kind: 'plain',   value: m[0] });
    last = regex.lastIndex;
  }
  if (last < text.length) tokens.push({ kind: 'plain', value: text.slice(last) });

  const classFor = (k: TokKind): string =>
    k === 'comment' ? 'tk-comment'
    : k === 'fn'    ? 'tk-fn'
    : k === 'num'   ? 'tk-num'
    : k === 'mini'  ? 'tk-mini'
    : k === 'plain' ? ''
    : 'tk-keyword';
  return (
    <>
      <For each={tokens}>
        {(t) => (
          <span class={classFor(t.kind)}>{t.value}</span>
        )}
      </For>
    </>
  );
};

export const renderSnippet = (snippet: ReadonlyArray<SnippetLine>): JSX.Element => (
  <For each={snippet}>
    {(line, idx) => (
      <div>
        <span class="line-no">{idx() + 1}</span>
        {line.length === 0 ? (
          <span>{' '}</span>
        ) : (
          line.map((seg) => {
            if (seg.t === 'blank')   return <span>{' '}</span>;
            if (seg.t === 'comment') return <span class="tk-comment">{seg.text}</span>;
            if (seg.t === 'mini')    return <span class="tk-mini">{seg.text}</span>;
            return colorize(seg.text);
          })
        )}
      </div>
    )}
  </For>
);
