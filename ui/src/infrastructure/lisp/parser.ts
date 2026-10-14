/**
 * Parser: tokens → AST.
 *
 * AST nodes:
 *   { kind: 'num', value }
 *   { kind: 'str', value }
 *   { kind: 'sym', value }
 *   { kind: 'list', items: Expr[] }
 *   { kind: 'empty' }    // ()
 *
 * Empty list `()` is preserved as 'empty' — emitter renders it as
 * `Pattern.empty()` so chained calls don't crash on `undefined`.
 */

import type { Token } from './lexer';
import { LispSyntaxError } from './lexer';

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'sym'; value: string }
  | { kind: 'list'; items: Expr[] }
  | { kind: 'empty' };

export const parse = (tokens: ReadonlyArray<Token>): Expr[] => {
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const eat = (): Token => {
    const t = tokens[pos];
    if (t === undefined) throw new LispSyntaxError('unexpected end of input', 0);
    pos += 1;
    return t;
  };

  const parseExpr = (): Expr => {
    const t = peek();
    if (t === undefined) throw new LispSyntaxError('unexpected end of input', 0);
    if (t.kind === 'lparen') {
      eat();
      const items: Expr[] = [];
      while (peek()?.kind !== 'rparen') {
        if (peek() === undefined) throw new LispSyntaxError("missing ')'", t.start);
        items.push(parseExpr());
      }
      eat(); // rparen
      if (items.length === 0) return { kind: 'empty' };
      return { kind: 'list', items };
    }
    if (t.kind === 'rparen') {
      throw new LispSyntaxError("unexpected ')'", t.start);
    }
    eat();
    if (t.kind === 'number') return { kind: 'num', value: t.value };
    if (t.kind === 'string') return { kind: 'str', value: t.value };
    return { kind: 'sym', value: t.value };
  };

  const exprs: Expr[] = [];
  while (pos < tokens.length) {
    exprs.push(parseExpr());
  }
  return exprs;
};