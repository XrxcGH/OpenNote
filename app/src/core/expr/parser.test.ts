import { describe, expect, it } from 'vitest';
import { MAX_TREE_DEPTH, stripPositions, treeDepth, type Node } from './ast';
import { ExprError } from './errors';
import { GENERAL } from './general';
import { parse } from './parser';
import { formatExpression } from './print';
import { definitionHead, parseStatement } from './statement';
import { LETTERS, SHEET, SHEET_COMMA } from './testing';
import { tokenize } from './lexer';
import type { Dialect } from './dialect';

/** The tree as short text, so a test can compare structure at a glance. */
function show(node: Node): string {
  switch (node.type) {
    case 'binary':
      return `(${show(node.left)} ${node.implicit ? 'imp' : node.op} ${show(node.right)})`;
    case 'unary':
      return `(${node.op}${show(node.arg)})`;
    case 'postfix':
      return `(${show(node.arg)}${node.op})`;
    case 'call':
      return `${node.name}[${node.args.map(show).join(' ')}]`;
    case 'num':
      return node.text;
    case 'name':
      return node.name;
    case 'cell':
      return `cell(${node.col},${node.row})`;
    case 'range':
      return `range(${node.col1},${node.row1}:${node.col2},${node.row2})`;
    case 'col':
      return `${node.by}:${node.key}`;
    case 'str':
      return JSON.stringify(node.value);
    case 'bool':
      return String(node.value);
    case 'quantity':
      return `${node.value.text}[${node.unit.factors.map((f) => `${f.name}^${f.power}`).join(' ')}]`;
    case 'convert':
      return `${show(node.value)} in [${node.unit.factors.map((f) => `${f.name}^${f.power}`).join(' ')}]`;
  }
}

function read(source: string, dialect: Dialect): string {
  return show(parse(source, dialect));
}

function failure(source: string, dialect: Dialect): ExprError {
  try {
    parse(source, dialect);
  } catch (error) {
    if (error instanceof ExprError) return error;
    throw error;
  }
  throw new Error(`${source} should not parse`);
}

describe('the spreadsheet dialect', () => {
  it('reads cells and ranges, with fixed marks', () => {
    expect(read('A1+$B$3', SHEET)).toBe('(cell(0,0) + cell(1,2))');
    expect(read('SUM(A1:B5)', SHEET)).toBe('SUM[range(0,0:1,4)]');
    expect(read('SUM(B2:A1)', SHEET)).toBe('SUM[range(0,0:1,1)]');
    expect(read('SUM(B:B)', SHEET)).toBe('SUM[range(1,0:1,Infinity)]');
    expect(read('SUM(E:E)', SHEET)).toBe('SUM[range(4,0:4,Infinity)]');
  });

  it('reads column names, ids, strings, and keywords', () => {
    expect(read('[Unit price]*{c1}', SHEET)).toBe('(name:Unit price * id:c1)');
    expect(read('IF(TRUE,"a","b")', SHEET)).toBe('IF[true "a" "b"]');
    expect(read('pi*e', SHEET)).toBe('(3.141592653589793 * 2.718281828459045)');
    expect(read('PI()', SHEET)).toBe('PI[]');
  });

  it('reads comparisons and joins below sums, and a percent sign above a power', () => {
    expect(read('1&2+3', SHEET)).toBe('(1 & (2 + 3))');
    expect(read('1+2<3*4', SHEET)).toBe('((1 + 2) < (3 * 4))');
    expect(read('50%*2', SHEET)).toBe('((50%) * 2)');
    expect(read('2^50%', SHEET)).toBe('(2 ^ (50%))');
    expect(read('√16+9', SHEET)).toBe('((√16) + 9)');
  });

  it('reads the regional form with a decimal comma and semicolons', () => {
    expect(read('IF([Preis]>1,5;SUM(1,5;2))', SHEET_COMMA)).toBe('IF[(name:Preis > 1.5) SUM[1.5 2]]');
  });

  it('gives each name a place: names that are not cells, keywords, or calls are mistakes', () => {
    expect(failure('foo', SHEET)).toMatchObject({ code: 'bad-reference', position: 0, detail: 'foo' });
    expect(failure('A0', SHEET)).toMatchObject({ code: 'bad-reference', detail: 'A0' });
    expect(failure('A1:', SHEET)).toMatchObject({ code: 'unexpected-end', position: 3 });
    expect(failure('A1:B', SHEET)).toMatchObject({ code: 'unexpected-token', detail: 'B' });
    expect(failure('A0:B2', SHEET)).toMatchObject({ code: 'bad-row' });
    expect(failure('1 2', SHEET)).toMatchObject({ code: 'unexpected-token', position: 2 });
    expect(failure('2x', SHEET)).toMatchObject({ code: 'unexpected-token' });
  });

  it('keeps a call with any name, and uppercases it', () => {
    expect(read('sum(1,2)', SHEET)).toBe('SUM[1 2]');
    expect(read('Nope()', SHEET)).toBe('NOPE[]');
  });
});

describe('the letters dialect', () => {
  it('splits a run of letters into known names', () => {
    expect(read('pix', LETTERS)).toBe('(pi imp x)');
    expect(read('3x^2y', LETTERS)).toBe('((3 imp (x ^ 2)) imp y)');
    expect(read('xsin(x)', LETTERS)).toBe('(x imp sin[x])');
    expect(read('x2', LETTERS)).toBe('(x imp 2)');
  });

  it('takes a function with or without brackets', () => {
    expect(read('sin x', LETTERS)).toBe('sin[x]');
    expect(read('sin 2x', LETTERS)).toBe('sin[(2 imp x)]');
    expect(read('sin x cos x', LETTERS)).toBe('(sin[x] imp cos[x])');
    expect(read('sin x^2', LETTERS)).toBe('sin[(x ^ 2)]');
    expect(read('sin cos x', LETTERS)).toBe('sin[cos[x]]');
    expect(read('sin -x', LETTERS)).toBe('sin[(-x)]');
  });

  it('takes a power on the function name, and the inverse for a power of minus one', () => {
    expect(read('sin^2(x)', LETTERS)).toBe('(sin[x] ^ 2)');
    expect(read('sin^2 x', LETTERS)).toBe('(sin[x] ^ 2)');
    expect(read('sin^-2(x)', LETTERS)).toBe('(sin[x] ^ (-2))');
    expect(read('sin^-1(x)', LETTERS)).toBe('asin[x]');
    expect(read('arcsin(x)', LETTERS)).toBe('asin[x]');
  });

  it('names the problem with a function', () => {
    expect(failure('sin', LETTERS)).toMatchObject({ code: 'missing-argument', position: 0, detail: 'sin' });
    expect(failure('max()', LETTERS)).toMatchObject({ code: 'arity', position: 0 });
    expect(failure('sin^x', LETTERS)).toMatchObject({ code: 'unexpected-token', expected: 'number' });
    expect(failure('2 + q', LETTERS)).toMatchObject({ code: 'unknown-name', position: 4, detail: 'q', length: 1 });
  });

  it('refuses a stray equals sign', () => {
    expect(failure('x = 3', LETTERS)).toMatchObject({ code: 'unexpected-token', position: 2, detail: '=' });
  });
});

describe('statements', () => {
  it('finds the head of a definition on raw tokens', () => {
    const head = definitionHead(tokenize('f(x, y) = x*y', GENERAL.lex));
    expect(head).toMatchObject({ length: 7 });
    expect(head?.params.map((t) => t.text)).toEqual(['x', 'y']);
    expect(definitionHead(tokenize('rent = 12', GENERAL.lex))).toMatchObject({ length: 2 });
    expect(definitionHead(tokenize('f(x)', GENERAL.lex))).toBeNull();
    expect(definitionHead(tokenize('f(1) = 2', GENERAL.lex))).toBeNull();
    expect(definitionHead(tokenize('1 = 2', GENERAL.lex))).toBeNull();
  });

  it('parses a definition and keeps the place of its parts', () => {
    const statement = parseStatement('  rent = 1200 * 12', GENERAL);
    if (statement.kind !== 'define') throw new Error('expected a definition');
    expect(statement).toMatchObject({ name: 'rent', params: [], nameStart: 2, equalsAt: 7 });
    expect(show(statement.body)).toBe('(1200 * 12)');
  });

  it('reads the body of a definition with the same dialect rules', () => {
    const statement = parseStatement('f(x) = 2x + 1', GENERAL);
    if (statement.kind !== 'define') throw new Error('expected a definition');
    expect(statement.params).toEqual(['x']);
    expect(show(statement.body)).toBe('((2 imp x) + 1)');
  });

  it('treats a line without a definition head as an expression', () => {
    expect(parseStatement('2 + 2', GENERAL).kind).toBe('expr');
  });
});

describe('spans', () => {
  it('gives parsed nodes their text range, and printing then reading again agrees', () => {
    const source = 'sin(2x)^2 + 3!';
    const node = parse(source, GENERAL);
    expect(node.start).toBe(0);
    expect(node.end).toBe(source.length);
    const again = parse(formatExpression(node), GENERAL);
    expect(stripPositions(again)).toEqual(stripPositions(node));
  });
});

describe('limits', () => {
  it('stops a chain of terms that is too long to walk safely', () => {
    expect(failure('1+'.repeat(2500) + '1', SHEET)).toMatchObject({ code: 'too-deep' });
  });

  it('allows a long chain that is still safe', () => {
    expect(parse('1+'.repeat(900) + '1', SHEET).type).toBe('binary');
  });

  it('bounds how deep a tree gets, however its depth is made', () => {
    expect(failure('1+'.repeat(1200) + '1', SHEET)).toMatchObject({ code: 'too-deep', position: 1999 });
    expect(failure('5' + '!'.repeat(1200), GENERAL)).toMatchObject({ code: 'too-deep', position: 1000 });
    const sum = (inner: string): string => `(${inner}${'+1'.repeat(600)})`;
    expect(failure(sum(sum('1')), LETTERS)).toMatchObject({ code: 'too-deep' });
    expect(treeDepth(parse(sum('1'), LETTERS))).toBe(MAX_TREE_DEPTH - 399);
    expect(failure('1+'.repeat(5001) + '1', SHEET)).toMatchObject({ code: 'too-long' });
  });
});
