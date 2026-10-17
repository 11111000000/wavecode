/**
 * Strudel-score tokenizer.
 *
 * Hand-written, single-pass, character-class driven. Produces
 * `Token[]` with full spans so the parser can recover positions
 * on errors and walkers can re-emit source verbatim.
 *
 * No regex backtracking: every token type has a dedicated
 * scanner. This keeps the per-preset parse cost well under the
 * 5 ms budget documented in `decisions/wavecode-strudel-ast`.
 *
 * Tokens of interest to the parser:
 *   IDENT, STRING, TEMPLATE, NUMBER, LPAREN, RPAREN, COMMA, DOT,
 *   STAR, SLASH, LINE_COMMENT, BLOCK_COMMENT, WS, EOF.
 *
 * Punctuation not relevant to call/stack extraction (operators,
 * colons, brackets, braces, etc.) is captured as `PUNCT` with
 * its lexeme so `parseScore` can still represent arbitrary JS
 * expressions — the AST walker treats them as opaque text
 * inside `OtherNode` / `expr` arg.
 */

import type { Span } from './ast';

export type TokenKind =
  | 'IDENT'
  | 'STRING'
  | 'TEMPLATE'
  | 'NUMBER'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACK'
  | 'RBRACK'
  | 'LBRACE'
  | 'RBRACE'
  | 'LANGLE'
  | 'RANGLE'
  | 'COMMA'
  | 'DOT'
  | 'STAR'
  | 'SLASH'
  | 'COLON'
  | 'SEMI'
  | 'BANG'
  | 'EQUALS'
  | 'HASH'
  | 'AT'
  | 'PUNCT'
  | 'LINE_COMMENT'
  | 'BLOCK_COMMENT'
  | 'WS'
  | 'EOF';

export type Token = {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly span: Span;
};

/**
 * Read a single character at `text[i]`, returning the empty
 * string when `i` is out of bounds. Side-steps
 * `noUncheckedIndexedAccess` without sprinkling `!` assertions
 * through every scanner.
 */
const at = (text: string, i: number): string => (i < text.length ? (text[i] ?? '') : '');

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

const isIdentStart = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') ||
  (ch >= 'A' && ch <= 'Z') ||
  ch === '_' ||
  ch === '$';

const isIdentPart = (ch: string): boolean => isIdentStart(ch) || isDigit(ch);

const isWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/**
 * Scan a string literal `text[start..]` whose opening quote is
 * `text[start]`. Returns the index just past the closing quote,
 * OR `null` if the string is unterminated.
 */
const scanString = (text: string, start: number, quote: string): number | null => {
  let i = start + 1;
  while (i < text.length) {
    const ch = at(text, i);
    if (ch === '\\' && i + 1 < text.length) { i += 2; continue; }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return null;
};

/**
 * Scan a `//…` line comment. Caller must guarantee `text[start] === '/'`
 * and `text[start + 1] === '/'`. The newline (if any) is NOT consumed
 * — that lets the parser keep line numbers predictable when the
 * comment is followed by an `LF` that should start a fresh token.
 */
const scanLineComment = (text: string, start: number): number => {
  let i = start + 2;
  while (i < text.length && at(text, i) !== '\n') i += 1;
  return i;
};

/**
 * Scan a block comment. Returns the index just past the closing
 * star-slash, OR `null` if the comment is unterminated.
 */
const scanBlockComment = (text: string, start: number): number | null => {
  let i = start + 2;
  while (i < text.length - 1) {
    if (at(text, i) === '*' && at(text, i + 1) === '/') return i + 2;
    i += 1;
  }
  return null;
};

/**
 * Scan a decimal number. Accepts `0`, `1.5`, `42`. Leading-dot
 * forms like `.5` are NOT accepted — would shadow method-access
 * `.gain(0.5)`. A trailing `/` (`1/8`) is left to the parser —
 * the tokenizer returns `NUMBER` `1` and a separate `SLASH` `8`.
 */
const scanNumber = (text: string, start: number): number => {
  let i = start;
  while (i < text.length && isDigit(at(text, i))) i += 1;
  if (at(text, i) === '.' && i + 1 < text.length && isDigit(at(text, i + 1))) {
    i += 1;
    while (i < text.length && isDigit(at(text, i))) i += 1;
  }
  return i;
};

const scanIdent = (text: string, start: number): number => {
  let i = start + 1;
  while (i < text.length && isIdentPart(at(text, i))) i += 1;
  return i;
};

const scanWhitespace = (text: string, start: number): number => {
  let i = start;
  while (i < text.length && isWhitespace(at(text, i))) i += 1;
  return i;
};

const makeSpan = (text: string, start: number, end: number): Span => {
  let line = 1;
  let col = 1;
  for (let i = 0; i < start && i < text.length; i += 1) {
    if (at(text, i) === '\n') { line += 1; col = 1; }
    else col += 1;
  }
  return { start, end, line, col };
};

/**
 * Single-character punctuation table. The parser only cares
 * about the ones it can branch on (`LPAREN`, `RPAREN`, `COMMA`,
 * `DOT`, `LBRACE`, `RBRACE`, `LBRACK`, `RBRACK`, `LANGLE`,
 * `RANGLE`, `STAR`, `SLASH`); the rest are recognised by the
 * tokenizer for completeness so a future syntax-highlighter can
 * emit them without losing fidelity.
 */
const PUNCT_SINGLE: ReadonlyArray<[TokenKind, string]> = [
  ['LPAREN', '('], ['RPAREN', ')'],
  ['LBRACK', '['], ['RBRACK', ']'],
  ['LBRACE', '{'], ['RBRACE', '}'],
  ['LANGLE', '<'], ['RANGLE', '>'],
  ['COMMA', ','], ['DOT', '.'],
  ['STAR', '*'], ['SLASH', '/'],
  ['COLON', ':'], ['SEMI', ';'],
  ['BANG', '!'], ['EQUALS', '='],
  ['HASH', '#'], ['AT', '@'],
];

const PUNCT_SET: ReadonlySet<string> = new Set(PUNCT_SINGLE.map(([, s]) => s));

/**
 * Tokenize `text` into an array of tokens. Always ends with an
 * `EOF` token whose span points to `text.length`.
 */
export const tokenize = (text: string): ReadonlyArray<Token> => {
  const out: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = at(text, i);

    // Comments — recognised before whitespace so the parser
    // can drop them at the token level (avoids re-scanning).
    if (ch === '/' && at(text, i + 1) === '/') {
      const end = scanLineComment(text, i);
      out.push({ kind: 'LINE_COMMENT', lexeme: text.slice(i, end), span: makeSpan(text, i, end) });
      i = end;
      continue;
    }
    if (ch === '/' && at(text, i + 1) === '*') {
      const end = scanBlockComment(text, i);
      if (end === null) {
        const span = makeSpan(text, i, n);
        out.push({ kind: 'BLOCK_COMMENT', lexeme: text.slice(i), span });
        i = n;
        break;
      }
      out.push({ kind: 'BLOCK_COMMENT', lexeme: text.slice(i, end), span: makeSpan(text, i, end) });
      i = end;
      continue;
    }

    // Whitespace — kept as `WS` so callers that want round-trip
    // fidelity can preserve it; the parser skips `WS`.
    if (isWhitespace(ch)) {
      const end = scanWhitespace(text, i);
      out.push({ kind: 'WS', lexeme: text.slice(i, end), span: makeSpan(text, i, end) });
      i = end;
      continue;
    }

    // Identifiers — function names like `s`, `note`, `stack`, `slow`.
    if (isIdentStart(ch)) {
      const end = scanIdent(text, i);
      out.push({ kind: 'IDENT', lexeme: text.slice(i, end), span: makeSpan(text, i, end) });
      i = end;
      continue;
    }

    // Numbers.
    if (isDigit(ch)) {
      const end = scanNumber(text, i);
      out.push({ kind: 'NUMBER', lexeme: text.slice(i, end), span: makeSpan(text, i, end) });
      i = end;
      continue;
    }

    // Strings (single, double, template — kept as `TEMPLATE`
    // for backticks so callers can detect them).
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = scanString(text, i, ch);
      if (end === null) {
        const span = makeSpan(text, i, n);
        out.push({
          kind: ch === '`' ? 'TEMPLATE' : 'STRING',
          lexeme: text.slice(i),
          span,
        });
        i = n;
        break;
      }
      out.push({
        kind: ch === '`' ? 'TEMPLATE' : 'STRING',
        lexeme: text.slice(i, end),
        span: makeSpan(text, i, end),
      });
      i = end;
      continue;
    }

    // Single-char punctuation.
    if (PUNCT_SET.has(ch)) {
      const entry = PUNCT_SINGLE.find(([, s]) => s === ch);
      out.push({ kind: entry![0], lexeme: ch, span: makeSpan(text, i, i + 1) });
      i += 1;
      continue;
    }

    // Anything else — captured as `PUNCT` so the parser can keep
    // going. Operators like `+ - ?` fall here; they're never the
    // first token of a `stack(...)` call so the walker ignores them.
    let j = i + 1;
    while (j < n) {
      const c = at(text, j);
      if (isIdentStart(c) || isDigit(c) || isWhitespace(c)) break;
      if (PUNCT_SET.has(c)) break;
      j += 1;
    }
    out.push({ kind: 'PUNCT', lexeme: text.slice(i, j), span: makeSpan(text, i, j) });
    i = j;
  }
  out.push({ kind: 'EOF', lexeme: '', span: makeSpan(text, n, n) });
  return out;
};

/** Filter helper — drop whitespace and comments from a token stream. */
export const stripTrivia = (tokens: ReadonlyArray<Token>): ReadonlyArray<Token> =>
  tokens.filter((t) => t.kind !== 'WS' && t.kind !== 'LINE_COMMENT' && t.kind !== 'BLOCK_COMMENT');