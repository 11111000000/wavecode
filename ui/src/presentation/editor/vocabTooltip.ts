/**
 * Inline vocabulary tooltips for the CodeMirror score editor.
 *
 * Adds a CM6 `hoverTooltip` extension that, when the user hovers
 * over a Strudel function / sample / note name, shows a small
 * popover with a Russian description and an example snippet.
 *
 * Detection strategy
 * ------------------
 *
 * The editor doesn't have a real Lezer parser — only `basicSetup`
 * plus highlight decorators. So we use lightweight heuristics:
 *
 * 1. **Token extraction** at the cursor position. Word chars
 *    `[A-Za-z0-9_]` are scanned backwards and forwards from the
 *    cursor to find the local identifier token. If the character
 *    immediately before the token is `.`, the token is treated
 *    as a method call (the leading dot is included in the hover
 *    range so the user sees the dotted form highlighted).
 *
 * 2. **String-literal context**. We count unescaped `"`, `'`,
 *    and `` ` `` characters on the same line before the cursor.
 *    Odd count → cursor is inside an unclosed string literal on
 *    that line. (Multi-line template literals would technically
 *    break this, but the current score syntax does not use them.)
 *
 * 3. **Classification**:
 *    - Inside string + token matches `^[a-g]#?b?\d$` → note
 *    - Inside string + token is purely alpha → sample
 *    - Outside string + token (with `.` stripped) → function
 *
 * Unknown tokens return `null` so CM6 stays silent — the
 * "show no tooltip" contract from `glossary.ts`.
 *
 * The hover extension itself is created lazily via
 * `vocabTooltip()` so it can be passed into the existing
 * `extensions` array of `EditorState.create({...})` without
 * importing this file from the lazy-loaded chunk file
 * (`CodeMirrorEditorImpl.tsx`).
 */

import { hoverTooltip, type Tooltip } from '@codemirror/view';
import {
  getTooltipForToken,
  getTooltipForSample,
  getTooltipForNote,
  type TooltipInfo,
} from '~/domain/strudel/glossary';

/**
 * One token at the cursor position. `text` is the verbatim
 * identifier (no leading `.`); `from` / `to` are byte offsets
 * into the document — `from` may be one past a leading `.` so
 * the caller can decide whether to include the dot in the hover
 * range.
 */
type Token = {
  readonly text: string;
  readonly from: number;
  readonly to: number;
};

const WORD_CHARS = /[A-Za-z0-9_#]/;
// `#` is included so note names with a sharp accidental
// (`c#4`, `a#3`) are scanned as a single token — otherwise the
// scan would stop at the `#` and only see the leading letter.
// Strudel identifiers never contain `#`, so including it does
// not cause false positives on function / variable names.

/**
 * Walk backwards / forwards from `pos` and grab the surrounding
 * word. Returns an empty token if there are no word chars at
 * `pos` (the caller treats this as "no tooltip").
 *
 * Edge case: cursor on the `.` of a method call (`.gain`).
 * The dot itself is not a word char, so the primary scan yields
 * an empty token. We then expand forward to grab the identifier
 * that follows the dot.
 */
const findTokenAt = (doc: string, pos: number): Token => {
  let lo = pos;
  while (lo > 0 && WORD_CHARS.test(doc[lo - 1] ?? '')) lo -= 1;
  let hi = pos;
  while (hi < doc.length && WORD_CHARS.test(doc[hi] ?? '')) hi += 1;
  let text = doc.slice(lo, hi);
  if (!text
      && doc[pos] === '.'
      && pos + 1 < doc.length
      && WORD_CHARS.test(doc[pos + 1] ?? '')) {
    lo = pos + 1;
    hi = pos + 1;
    while (lo > 0 && WORD_CHARS.test(doc[lo - 1] ?? '')) lo -= 1;
    while (hi < doc.length && WORD_CHARS.test(doc[hi] ?? '')) hi += 1;
    text = doc.slice(lo, hi);
  }
  return { text, from: lo, to: hi };
};

/**
 * Is the cursor inside an unclosed string literal on the same
 * line? Single-line scan with backslash-escape skip — covers
 * the standard Strudel score syntax (single + double quotes).
 *
 * Returns the quote character that's open when inside, or `null`
 * otherwise.
 */
const insideStringQuote = (doc: string, pos: number): '"' | "'" | '`' | null => {
  // Walk to start of current line.
  let lineStart = pos;
  while (lineStart > 0 && doc[lineStart - 1] !== '\n') lineStart -= 1;
  const before = doc.slice(lineStart, pos);
  let lastOpen: '"' | "'" | '`' | null = null;
  for (let i = 0; i < before.length; i += 1) {
    const ch = before[i] ?? '';
    if (ch === '\\') { i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      lastOpen = lastOpen === ch ? null : ch;
    }
  }
  return lastOpen;
};

const isInsideString = (doc: string, pos: number): boolean =>
  insideStringQuote(doc, pos) !== null;

type Classification =
  | { readonly kind: 'note'; readonly info: TooltipInfo; readonly from: number; readonly to: number }
  | { readonly kind: 'sample'; readonly info: TooltipInfo; readonly from: number; readonly to: number }
  | { readonly kind: 'function'; readonly info: TooltipInfo; readonly from: number; readonly to: number };

/**
 * Run all detection in one place so the hover source stays
 * short. Returns null for "no tooltip".
 */
const classifyAt = (view: { state: { doc: { toString: () => string; length: number } } }, pos: number): Classification | null => {
  const doc = view.state.doc.toString();
  if (pos < 0 || pos > doc.length) return null;
  const token = findTokenAt(doc, pos);
  if (!token.text) return null;

  const inside = isInsideString(doc, pos);

  if (inside) {
    const note = getTooltipForNote(token.text);
    if (note) return { kind: 'note', info: note, from: token.from, to: token.to };
    const sample = getTooltipForSample(token.text);
    if (sample) return { kind: 'sample', info: sample, from: token.from, to: token.to };
    return null;
  }

  // Outside a string — could be a function or a method call
  // (`.gain`, `.lpf`). The dot is one char before `token.from`.
  const hasLeadingDot = token.from > 0 && doc[token.from - 1] === '.';
  const fn = getTooltipForToken(token.text);
  if (fn) {
    return {
      kind: 'function',
      info: fn,
      from: hasLeadingDot ? token.from - 1 : token.from,
      to: token.to,
    };
  }

  // Fallback: bare note ref outside a string literal (the rare
  // `note(c4)` form — usually `c4` would be inside `"…"`, but
  // Strudel accepts both). The note regex is specific enough
  // (`^[a-g]#?b?\d$`) that there is no ambiguity with variable
  // names or numbers — single-letter identifiers without digits
  // do not match the regex.
  const note = getTooltipForNote(token.text);
  if (note) {
    return { kind: 'note', info: note, from: token.from, to: token.to };
  }

  return null;
};

/**
 * Build the DOM for a tooltip. Pure DOM construction; no Solid,
 * no editor references needed at create-time.
 */
const buildTooltipDom = (cls: Classification): HTMLElement => {
  const root = document.createElement('div');
  root.className = `cm-vocab-tooltip cm-vocab-tooltip--${cls.kind}`;
  root.dataset['category'] = cls.kind;

  const head = document.createElement('div');
  head.className = 'cm-vocab-tooltip__head';
  const nameEl = document.createElement('span');
  nameEl.className = 'cm-vocab-tooltip__name';
  nameEl.textContent = cls.info.name;
  const tagEl = document.createElement('span');
  tagEl.className = 'cm-vocab-tooltip__tag';
  tagEl.textContent = cls.kind === 'function'
    ? 'функция'
    : cls.kind === 'sample'
      ? 'сэмпл'
      : 'нота';
  head.append(nameEl, tagEl);

  const desc = document.createElement('div');
  desc.className = 'cm-vocab-tooltip__ru';
  desc.textContent = cls.info.ru;

  const ex = document.createElement('code');
  ex.className = 'cm-vocab-tooltip__example';
  ex.textContent = cls.info.example;

  root.append(head, desc, ex);
  return root;
};

/**
 * CM6 hover source — returns a single `Tooltip` when a known
 * vocabulary token sits under the cursor, otherwise `null`
 * (which suppresses the popover entirely).
 *
 * Returned `pos` / `end` cover the full token range (including
 * the leading `.` for method calls) so the user sees the entire
 * identifier highlighted while the popover is open.
 */
const hoverSource = (
  view: Parameters<NonNullable<Parameters<typeof hoverTooltip>[0]>>[0],
  pos: number,
): Tooltip | null => {
  const cls = classifyAt(view, pos);
  if (!cls) return null;
  return {
    pos: cls.from,
    end: cls.to,
    above: true,
    create: () => ({ dom: buildTooltipDom(cls) }),
  };
};

/**
 * The `hoverTooltip` extension to add to a CodeMirror
 * `EditorState`. 250ms hover-time matches the project's
 * "feels responsive but not jumpy" guideline (slider tooltips
 * in `wc-slider-big` use the same delay class).
 */
export const vocabTooltip = (): ReturnType<typeof hoverTooltip> =>
  hoverTooltip(hoverSource, { hoverTime: 250 });