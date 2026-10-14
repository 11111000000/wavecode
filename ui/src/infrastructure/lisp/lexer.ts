/**
 * Lexer: Lisp source → tokens.
 *
 * Tokens: LPAREN, RPAREN, NUMBER, STRING, SYMBOL.
 * Comments (`;` line, `#|` block `|#`) are stripped.
 *
 * No regex backtracking beyond linear scan — input is consumed once.
 */

export type Token =
  | { kind: 'lparen'; start: number }
  | { kind: 'rparen'; start: number }
  | { kind: 'number'; value: number; start: number }
  | { kind: 'string'; value: string; start: number }
  | { kind: 'symbol'; value: string; start: number };

const SYMBOL_START = /[a-zA-Z_+\-*/<>=!?]/;
const SYMBOL_CONT = /[a-zA-Z0-9_+\-*/<>=!?]/;
const DIGIT = /[0-9]/;

export class LispSyntaxError extends Error {
  readonly start: number;
  constructor(message: string, start: number) {
    super(message);
    this.name = 'LispSyntaxError';
    this.start = start;
  }
}

export const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const c = source[i];

    if (c === undefined) {
      i += 1;
      continue;
    }

    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }

    // Line comment: ; ... \n
    if (c === ';') {
      while (i < len && source[i] !== '\n') i += 1;
      continue;
    }

    // Block comment: #| ... |#
    if (c === '#' && source[i + 1] === '|') {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (source[i] === '#' && source[i + 1] === '|') {
          depth += 1;
          i += 2;
        } else if (source[i] === '|' && source[i + 1] === '#') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (depth > 0) throw new LispSyntaxError('unterminated block comment', start);
      continue;
    }

    // Parens
    if (c === '(') {
      tokens.push({ kind: 'lparen', start: i });
      i += 1;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen', start: i });
      i += 1;
      continue;
    }

    // String: "..."
    if (c === '"') {
      const start = i;
      i += 1;
      let out = '';
      while (i < len) {
        const ch = source[i];
        if (ch === undefined) break;
        if (ch === '"') {
          i += 1;
          tokens.push({ kind: 'string', value: out, start });
          break;
        }
        if (ch === '\\' && i + 1 < len) {
          const next = source[i + 1];
          if (next === 'n') out += '\n';
          else if (next === 't') out += '\t';
          else if (next === 'r') out += '\r';
          else if (next === '\\') out += '\\';
          else if (next === '"') out += '"';
          else out += next ?? '';
          i += 2;
          continue;
        }
        out += ch;
        i += 1;
      }
      if (source[i - 1] !== '"') throw new LispSyntaxError('unterminated string', start);
      continue;
    }

    // Number
    if (DIGIT.test(c) || (c === '-' && DIGIT.test(source[i + 1] ?? ''))) {
      const start = i;
      let s = '';
      if (c === '-') {
        s += '-';
        i += 1;
      }
      while (i < len && DIGIT.test(source[i] ?? '')) {
        s += source[i];
        i += 1;
      }
      if (source[i] === '.') {
        s += '.';
        i += 1;
        while (i < len && DIGIT.test(source[i] ?? '')) {
          s += source[i];
          i += 1;
        }
      }
      const value = Number(s);
      if (Number.isNaN(value)) throw new LispSyntaxError(`invalid number: ${s}`, start);
      tokens.push({ kind: 'number', value, start });
      continue;
    }

    // Symbol
    if (SYMBOL_START.test(c)) {
      const start = i;
      let s = '';
      while (i < len && SYMBOL_CONT.test(source[i] ?? '')) {
        s += source[i];
        i += 1;
      }
      tokens.push({ kind: 'symbol', value: s, start });
      continue;
    }

    throw new LispSyntaxError(`unexpected character: ${JSON.stringify(c)}`, i);
  }

  return tokens;
};