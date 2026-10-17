/**
 * Unit tests for the Strudel-score tokenizer.
 *
 * Each case asserts both the token COUNT and the per-token
 * (kind, lexeme) tuples so regressions in either dimension
 * surface immediately. Spans are spot-checked in dedicated
 * cases below.
 */

import { describe, it, expect } from 'vitest';
import { tokenize, stripTrivia, type Token } from './tokenizer';

const kinds = (tokens: ReadonlyArray<Token>): string[] =>
  tokens.map((t) => `${t.kind}=${t.lexeme}`);

describe('tokenizer', () => {
  it('tokenizes an empty string to just EOF', () => {
    const toks = tokenize('');
    expect(toks).toHaveLength(1);
    expect(toks[0]?.kind).toBe('EOF');
  });

  it('tokenizes whitespace-only input to EOF', () => {
    const toks = tokenize('   \n\t  ');
    expect(kinds(toks)).toEqual(['WS=   \n\t  ', 'EOF=']);
  });

  it('tokenizes a single identifier', () => {
    const toks = tokenize('note');
    expect(kinds(toks)).toEqual(['IDENT=note', 'EOF=']);
  });

  it('tokenizes identifiers with $ and _', () => {
    const toks = tokenize('_foo $bar baz_42');
    expect(kinds(toks)).toEqual([
      'IDENT=_foo', 'WS= ', 'IDENT=$bar', 'WS= ', 'IDENT=baz_42', 'EOF=',
    ]);
  });

  it('tokenizes a number', () => {
    expect(kinds(tokenize('0'))).toEqual(['NUMBER=0', 'EOF=']);
    expect(kinds(tokenize('42'))).toEqual(['NUMBER=42', 'EOF=']);
    expect(kinds(tokenize('1.5'))).toEqual(['NUMBER=1.5', 'EOF=']);
    // Leading-dot floats are NOT accepted (would shadow `.gain`).
    expect(kinds(tokenize('.5'))).toEqual(['DOT=.', 'NUMBER=5', 'EOF=']);
  });

  it('tokenizes double-quoted strings with escapes', () => {
    const toks = tokenize('"a\\"b\\nc"');
    expect(toks).toHaveLength(2);
    expect(toks[0]?.kind).toBe('STRING');
    expect(toks[0]?.lexeme).toBe('"a\\"b\\nc"');
  });

  it('tokenizes single-quoted strings', () => {
    const toks = tokenize("'hello world'");
    expect(toks).toHaveLength(2);
    expect(toks[0]?.kind).toBe('STRING');
    expect(toks[0]?.lexeme).toBe("'hello world'");
  });

  it('tokenizes template-literal strings as TEMPLATE', () => {
    const toks = tokenize('`a b c`');
    expect(toks[0]?.kind).toBe('TEMPLATE');
    expect(toks[0]?.lexeme).toBe('`a b c`');
  });

  it('keeps unterminated strings as-is (no throw)', () => {
    const toks = tokenize('"unterminated');
    expect(toks[0]?.kind).toBe('STRING');
    expect(toks[0]?.lexeme).toBe('"unterminated');
  });

  it('tokenizes line comments as LINE_COMMENT, no newline consumed', () => {
    const toks = tokenize('// hello\nx');
    expect(kinds(toks)).toEqual(['LINE_COMMENT=// hello', 'WS=\n', 'IDENT=x', 'EOF=']);
  });

  it('tokenizes block comments as BLOCK_COMMENT', () => {
    const toks = tokenize('/* hi */x');
    expect(kinds(toks)).toEqual(['BLOCK_COMMENT=/* hi */', 'IDENT=x', 'EOF=']);
  });

  it('keeps unterminated block comments as-is (no throw)', () => {
    const toks = tokenize('/* unterminated');
    expect(toks[0]?.kind).toBe('BLOCK_COMMENT');
  });

  it('tokenizes punctuation tokens individually', () => {
    expect(kinds(tokenize('()[]{}<>,'))).toEqual([
      'LPAREN=(', 'RPAREN=)', 'LBRACK=[', 'RBRACK=]',
      'LBRACE={', 'RBRACE=}', 'LANGLE=<', 'RANGLE=>', 'COMMA=,',
      'EOF=',
    ]);
  });

  it('tokenizes dots, stars, slashes, etc.', () => {
    expect(kinds(tokenize('. * / : ; ! = # @'))).toEqual([
      'DOT=.', 'WS= ', 'STAR=*', 'WS= ', 'SLASH=/',
      'WS= ', 'COLON=:', 'WS= ', 'SEMI=;', 'WS= ',
      'BANG=!', 'WS= ', 'EQUALS==', 'WS= ', 'HASH=#', 'WS= ', 'AT=@',
      'EOF=',
    ]);
  });

  it('does not split `/` from `//`', () => {
    // Two `/` in a row are LINE_COMMENT, not SLASH+SLASH.
    expect(tokenize('//').map((t) => t.kind)).toEqual(['LINE_COMMENT', 'EOF']);
  });

  it('handles typical Strudel sample-call tokens', () => {
    expect(kinds(tokenize('s("bd sd hh")'))).toEqual([
      'IDENT=s', 'LPAREN=(', 'STRING="bd sd hh"', 'RPAREN=)', 'EOF=',
    ]);
  });

  it('handles a chained call with method access', () => {
    const toks = tokenize('s("a").gain(0.5).lpf(800)');
    expect(kinds(toks)).toEqual([
      'IDENT=s', 'LPAREN=(', 'STRING="a"', 'RPAREN=)',
      'DOT=.', 'IDENT=gain', 'LPAREN=(', 'NUMBER=0.5', 'RPAREN=)',
      'DOT=.', 'IDENT=lpf', 'LPAREN=(', 'NUMBER=800', 'RPAREN=)',
      'EOF=',
    ]);
  });

  it('captures spans with line+col tracking', () => {
    const text = 'a\nbb';
    const toks = tokenize(text);
    expect(toks[0]?.span).toEqual({ start: 0, end: 1, line: 1, col: 1 });
    expect(toks[1]?.span).toEqual({ start: 1, end: 2, line: 1, col: 2 });
    expect(toks[2]?.span).toEqual({ start: 2, end: 4, line: 2, col: 1 });
  });

  it('captures operators as PUNCT (single chars)', () => {
    const toks = tokenize('+');
    expect(toks[0]?.kind).toBe('PUNCT');
    expect(toks[0]?.lexeme).toBe('+');
  });

  it('captures operators as PUNCT (single chars)', () => {
    const toks = tokenize('+');
    expect(toks[0]?.kind).toBe('PUNCT');
    expect(toks[0]?.lexeme).toBe('+');
  });

  it('groups consecutive PUNCT into one token', () => {
    // Operators like `+` and `*` are not in the punctuation
    // table, so consecutive `++` form one PUNCT token.
    const toks = tokenize('++');
    expect(toks[0]?.kind).toBe('PUNCT');
    expect(toks[0]?.lexeme).toBe('++');
  });

  it('mixes a typical Strudel snippet correctly', () => {
    const text = 'note("c3 e3").s("saw").gain(0.5)';
    const toks = tokenize(text);
    expect(kinds(toks)).toEqual([
      'IDENT=note', 'LPAREN=(', 'STRING="c3 e3"', 'RPAREN=)',
      'DOT=.', 'IDENT=s', 'LPAREN=(', 'STRING="saw"', 'RPAREN=)',
      'DOT=.', 'IDENT=gain', 'LPAREN=(', 'NUMBER=0.5', 'RPAREN=)',
      'EOF=',
    ]);
  });

  it('stripTrivia removes whitespace and comments but keeps code', () => {
    const toks = tokenize('  // hi\n  s("a")  ');
    const stripped = stripTrivia(toks);
    expect(stripped.map((t) => t.kind)).toEqual(['IDENT', 'LPAREN', 'STRING', 'RPAREN', 'EOF']);
  });

  it('handles nested bracket sequences < and [ outside strings', () => {
    const text = 'cat(<a> [b])';
    const toks = tokenize(text);
    expect(toks.find((t) => t.kind === 'LANGLE')?.lexeme).toBe('<');
    expect(toks.find((t) => t.kind === 'RANGLE')?.lexeme).toBe('>');
    expect(toks.find((t) => t.kind === 'LBRACK')?.lexeme).toBe('[');
    expect(toks.find((t) => t.kind === 'RBRACK')?.lexeme).toBe(']');
  });

  it('handles 1/8 as NUMBER SLASH NUMBER', () => {
    // `1/8` is split into `NUMBER=1 SLASH=/ NUMBER=8`. This
    // matches Strudel's expression syntax (drum-n notation).
    const toks = tokenize('swing(1/8)');
    expect(kinds(toks)).toEqual([
      'IDENT=swing', 'LPAREN=(', 'NUMBER=1', 'SLASH=/', 'NUMBER=8', 'RPAREN=)', 'EOF=',
    ]);
  });
});