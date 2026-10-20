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
 *
 * Не eval-ится (AudioContext заблокирован до user-gesture); показывается
 * ради красивой подсветки.
 *
 * Держим его в синхроне с реальным пресетом `creep`
 * (`ui/src/domain/presets.ts`): раньше здесь лежала старая версия
 * verse-стека (без `.lpf(4000)`, `.gain(0.3)`, и вообще без chorus),
 * и посетитель лендинга видел в редакторе не тот код, который ему
 * только что показали. Показываем первые два такта verse и первый
 * такт chorus — этого хватает, чтобы стало видно и `note()`, и `s()`.
 */
export const HERO_SNIPPET: ReadonlyArray<SnippetLine> = [
  [
    { t: 'comment', text: '// Creep (Radiohead) — G → B → C → Cm (I–III–IV–iv), ~92 BPM' },
  ],
  [
    { t: 'code', text: 'cat(' },
  ],
  [
    { t: 'code', text: '  ' },
    { t: 'comment', text: '// ===== VERSE (4 bars) — clean arpeggio + bass, no drums =====' },
  ],
  [
    { t: 'code', text: '  stack(' },
  ],
  [
    { t: 'code', text: '    note(' },
    { t: 'mini',  text: '"g3 b3 d4 b3 g3 b3 d4 b3"' },
    { t: 'code', text: ').s("triangle").decay(.28).sustain(0).gain(0.16).lpf(4000).room(.5),' },
  ],
  [
    { t: 'code', text: '    note(' },
    { t: 'mini',  text: '"g2"' },
    { t: 'code', text: ').s("sawtooth").gain(0.30).lpf(300)' },
  ],
  [
    { t: 'code', text: '  ),' },
  ],
  [
    { t: 'comment', text: '  // … ещё 3 такта, потом B, C, Cm —' },
  ],
  [
    { t: 'code', text: '  ' },
    { t: 'comment', text: '// ===== CHORUS (4 bars) — distorted triads + full kit =====' },
  ],
  [
    { t: 'code', text: '  stack(' },
  ],
  [
    { t: 'code', text: '    note(' },
    { t: 'mini',  text: '"[g3,b3,d4]"' },
    { t: 'code', text: ').s("sawtooth").shape(0.6).gain(0.16).lpf(2200).room(.4),' },
  ],
  [
    { t: 'code', text: '    s(' },
    { t: 'mini',  text: '"drums_bd ~ drums_bd ~"' },
    { t: 'code', text: ').gain(0.5),' },
  ],
  [
    { t: 'code', text: '    s(' },
    { t: 'mini',  text: '"drums_hh*8"' },
    { t: 'code', text: ').decay(.04).sustain(0).gain(0.14),' },
  ],
  [
    { t: 'code', text: '    s(' },
    { t: 'mini',  text: '"drums_crash ~ ~ ~ ~ ~ ~ ~"' },
    { t: 'code', text: ').gain(0.26)' },
  ],
  [
    { t: 'code', text: '  )' },
  ],
  [
    { t: 'code', text: ').slow(1.3)' },
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
