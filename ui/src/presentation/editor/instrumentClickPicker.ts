/**
 * instrumentClickPicker — click a sound name in the score, pick another.
 *
 * The editor has no Lezer parser, so the "is this a sound argument?"
 * question is answered with the same lightweight heuristics the hover
 * tooltip uses (`vocabTooltip.ts`): scan the identifier around the
 * click, find the string literal it sits in, and check that the
 * literal is the argument of an `s(` / `.s(` call.
 *
 * The click is only accepted for a SOUND argument — clicking anywhere
 * else in the score must do exactly what it did before (place the
 * cursor), or the editor would feel broken.
 *
 * The picker itself is NOT drawn here: the extension reports the
 * target (the token range + the click coordinates) and the Solid
 * layer renders the control, so the UI is a normal component and the
 * editor stays free of DOM.
 */

import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export type InstrumentPickTarget = {
  /** The document range of the sound name (without the quotes). */
  readonly from: number;
  readonly to: number;
  /** The name that is there now. */
  readonly current: string;
  /** Click coordinates, relative to the editor host. */
  readonly x: number;
  readonly y: number;
};

const WORD_CHARS = /[A-Za-z0-9_-]/;

/**
 * The identifier around `pos`. Word chars include `-` because the
 * shipped drum names carry it (`drums_bd-sub`, `drums_tom-l`).
 */
const findTokenAt = (doc: string, pos: number): { text: string; from: number; to: number } => {
  let lo = pos;
  while (lo > 0 && WORD_CHARS.test(doc[lo - 1] ?? '')) lo -= 1;
  let hi = pos;
  while (hi < doc.length && WORD_CHARS.test(doc[hi] ?? '')) hi += 1;
  return { text: doc.slice(lo, hi), from: lo, to: hi };
};

/**
 * The opening quote of the string literal the position sits in, or
 * `null`. Counts the quotes on the line before the position (the
 * score syntax is single-line strings) and skips escaped ones.
 */
const stringQuoteBefore = (doc: string, pos: number): { quote: string; start: number } | null => {
  let lineStart = pos;
  while (lineStart > 0 && doc[lineStart - 1] !== '\n') lineStart -= 1;
  const line = doc.slice(lineStart, pos);
  let quote: string | null = null;
  let quoteStart = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? '';
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      if (quote === null) {
        quote = ch;
        quoteStart = lineStart + i;
      } else {
        quote = null;
        quoteStart = -1;
      }
    }
  }
  if (quote === null) return null;
  return { quote, start: quoteStart };
};

/**
 * Is the string that starts at `quoteStart` the argument of an
 * `s(` / `.s(` call? Walks back over the whitespace and looks for
 * the `s(` right before it.
 */
const isSoundArgument = (doc: string, quoteStart: number): boolean => {
  let i = quoteStart - 1;
  while (i >= 0 && /\s/.test(doc[i] ?? '')) i -= 1;
  if (i < 0) return false;
  if (doc[i] !== '(') return false;
  // The character before the paren must be the `s` of `s(` / `.s(`.
  if (doc[i - 1] !== 's') return false;
  // …and it must not be the tail of a longer name (`xs(`).
  if (i - 2 >= 0 && doc[i - 2] !== '.') return false;
  return true;
};

/**
 * The sound name at `pos`, if the position is inside the argument of
 * an `s(` / `.s(` call. `null` for everything else.
 *
 * Pure — the extension is a thin wrapper around it, and the tests
 * exercise this function directly.
 */
export const soundArgumentAt = (
  doc: string,
  pos: number,
): { from: number; to: number; current: string } | null => {
  const quote = stringQuoteBefore(doc, pos);
  if (quote === null) return null;
  if (!isSoundArgument(doc, quote.start)) return null;
  const token = findTokenAt(doc, pos);
  if (token.text.length === 0) return null;
  return { from: token.from, to: token.to, current: token.text };
};

/**
 * The extension. `onPick` is called with the token to replace; the
 * caller renders the picker and dispatches the replacement.
 */
export const instrumentClickPicker = (
  onPick: (target: InstrumentPickTarget) => void,
): Extension => EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null || pos === undefined) return false;
    const doc = view.state.doc.toString();
    const token = soundArgumentAt(doc, pos);
    if (token === null) return false;
    const host = view.dom.getBoundingClientRect();
    onPick({
      from: token.from,
      to: token.to,
      current: token.current,
      x: event.clientX - host.left,
      y: event.clientY - host.top,
    });
    return false;
  },
});
