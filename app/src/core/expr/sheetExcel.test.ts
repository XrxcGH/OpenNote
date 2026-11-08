// The sheet dialect with Excel's rules (ADR 0058). Expected values are worked by hand from the precedence Microsoft
// documents for Excel formulas: negation binds tighter than "^", and operators of equal precedence group left to
// right. The calculator keeps the textbook rules, so its answers do not change.

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sameTree, type Node } from './ast';
import { ExprError } from './errors';
import { evaluate } from './general';
import { parse } from './parser';
import { formatExpression } from './print';
import { sheetDialect } from './sheet';
import { SHEET } from './testing';

const EXCEL = sheetDialect({ decimal: '.', separator: ',', rules: 'excel' });
const EXCEL_COMMA = sheetDialect({ decimal: ',', separator: ';', rules: 'excel' });

/** Evaluates numbers, signs, and the four operations with "^", which is all these tests need. */
function value(node: Node): number {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'unary':
      return node.op === '-' ? -value(node.arg) : value(node.arg);
    case 'binary': {
      const [a, b] = [value(node.left), value(node.right)];
      if (node.op === '^') return a ** b;
      if (node.op === '*') return a * b;
      if (node.op === '/') return a / b;
      return node.op === '+' ? a + b : a - b;
    }
    default:
      throw new Error(`no value for ${node.type}`);
  }
}

const excel = (text: string): Node => parse(text, EXCEL);
const calculator = (text: string): number => {
  const outcome = evaluate(text);
  if (!outcome.ok) throw new Error(text);
  return outcome.value;
};

/** The tree without positions, as plain data, for comparing structure. */
function plain(node: Node): unknown {
  return JSON.parse(JSON.stringify(node, (key, v: unknown) => (['start', 'end', 'pos'].includes(key) ? undefined : v)));
}

describe('precedence', () => {
  it.each([
    ['-2^2', 4],
    ['2^-2', 0.25],
    ['2^3^2', 64],
    ['-2^-2', 0.25],
    ['-(2^2)', -4],
    ['2^(3^2)', 512],
    ['2*-3^2', 18],
    ['10-2^2', 6],
    ['2^-2^3', 1 / 64],
  ])('the sheet dialect reads =%s as %d', (text, expected) => {
    expect(value(excel(text))).toBe(expected);
  });

  it('leaves the calculator and the default sheet dialect on the textbook rules', () => {
    expect(calculator('-2^2')).toBe(-4);
    expect(calculator('2^3^2')).toBe(512);
    expect(value(parse('-2^2', SHEET))).toBe(-4);
    expect(value(parse('2^3^2', SHEET))).toBe(512);
  });

  it('writes trees back with the brackets the spreadsheet rules need', () => {
    for (const text of ['-(2^2)', '2^(3^2)', '-2^2', '2^-2', '(2^3)^2']) {
      const tree = excel(text);
      const written = formatExpression(tree, { excel: true });
      expect(sameTree(excel(written), tree), written).toBe(true);
    }
    expect(formatExpression(excel('(2^3)^2'), { excel: true })).toBe('2^3^2');
    expect(formatExpression(excel('-(2^2)'), { excel: true })).toBe('-(2^2)');
  });

  it('round-trips random sums, products, signs, and powers', () => {
    const leaf = fc.integer({ min: 0, max: 9 }).map((n) => String(n));
    const tree = fc.letrec<{ e: string }>((tie) => ({
      e: fc.oneof(
        { depthSize: 'small' },
        leaf,
        fc.tuple(fc.constantFrom('-', '+'), tie('e')).map(([s, e]) => `${s}(${e})`),
        fc.tuple(tie('e'), fc.constantFrom('+', '-', '*', '/', '^'), tie('e')).map(([a, op, b]) => `(${a})${op}(${b})`),
      ),
    })).e;
    fc.assert(
      fc.property(tree, (text) => {
        const node = excel(text);
        const written = formatExpression(node, { excel: true });
        expect(sameTree(excel(written), node), written).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe('names and numbers', () => {
  it('reads E as a name, not as the constant e', () => {
    expect(excel('E')).toMatchObject({ type: 'name', name: 'E' });
    expect(parse('E', SHEET)).toMatchObject({ type: 'num', value: Math.E });
  });

  it('lets an unknown name through for the host to report', () => {
    expect(excel('Rate*2')).toMatchObject({ type: 'binary', left: { type: 'name', name: 'Rate' } });
  });

  it('keeps 15 significant digits of a typed number', () => {
    expect(excel('12345678901234567890')).toMatchObject({ value: 12345678901234500000 });
    expect(excel('0.1234567890123456789')).toMatchObject({ value: 0.123456789012345 });
    expect(excel('1.5')).toMatchObject({ value: 1.5 });
  });
});

describe('references', () => {
  it('keeps the $ of each part', () => {
    expect(plain(excel('$B$3'))).toEqual({ type: 'cell', col: 1, row: 2, abs: { col: true, row: true } });
    expect(plain(excel('B$3'))).toEqual({ type: 'cell', col: 1, row: 2, abs: { col: false, row: true } });
    expect(plain(excel('B3'))).toEqual({ type: 'cell', col: 1, row: 2 });
    expect(plain(excel('$C5:A$1'))).toEqual({
      type: 'range',
      col1: 0,
      row1: 0,
      col2: 2,
      row2: 4,
      abs: [
        { col: false, row: true },
        { col: true, row: false },
      ],
    });
    for (const text of ['$B$3', 'B$3', '$A1:B$2', '$A:B', '$3:5']) {
      expect(formatExpression(excel(text), { excel: true })).toBe(text);
    }
  });

  it('reads whole rows', () => {
    expect(excel('3:3')).toMatchObject({ type: 'range', col1: 0, row1: 2, col2: Infinity, row2: 2 });
    expect(excel('3:3')).not.toHaveProperty('abs');
    expect(excel('SUM(2:5)')).toMatchObject({ args: [{ type: 'range', row1: 1, row2: 4, col2: Infinity }] });
    expect(() => excel('0:3')).toThrow(ExprError);
  });

  it('reads array constants', () => {
    const array = excel('{1,2;3,-4}');
    expect(array).toMatchObject({ type: 'array', rows: 2, cols: 2 });
    expect((array as Extract<Node, { type: 'array' }>).items.map((n) => (n.type === 'num' ? n.value : null))).toEqual([
      1, 2, 3, -4,
    ]);
    expect(excel('{"a",TRUE}')).toMatchObject({ items: [{ value: 'a' }, { value: true }] });
    expect(parse('{1,5\\2}', EXCEL_COMMA)).toMatchObject({ cols: 2, items: [{ value: 1.5 }, { value: 2 }] });
    expect(formatExpression(excel('{1,2;3,4}'))).toBe('{1,2;3,4}');
    expect(() => excel('{1,2;3}')).toThrow(ExprError);
    expect(() => excel('{1,A1}')).toThrow(ExprError);
    expect(() => excel('{}')).toThrow(expect.objectContaining({ code: 'unexpected-token', position: 0 }));
    expect(() => excel('SUM({ })')).toThrow(ExprError);
    expect(excel('{c1}')).toMatchObject({ type: 'col', by: 'id', key: 'c1' });
  });
});

describe('reference operators and other tables', () => {
  it('reads spill references, @, intersection, and union', () => {
    expect(excel('A1#')).toMatchObject({ type: 'spill', ref: { type: 'cell', col: 0, row: 0 } });
    expect(() => excel('A1 #')).toThrow(ExprError);
    expect(excel('@A1:A5')).toMatchObject({ type: 'unary', op: '@', arg: { type: 'range' } });
    expect(excel('SUM(A1:C3 B2:D4)')).toMatchObject({
      args: [{ type: 'refop', op: ' ', left: { type: 'range' }, right: { type: 'range' } }],
    });
    expect(excel('SUM((A1:B2,C3))')).toMatchObject({ args: [{ type: 'refop', op: ',' }] });
    expect(excel('SUM(A1:B2,C3)')).toMatchObject({ args: [{ type: 'range' }, { type: 'cell' }] });
    expect(excel('A1 B1+1')).toMatchObject({ type: 'binary', op: '+', left: { type: 'refop' } });
    for (const text of ['A1#', '@A1:A5', 'SUM(A1:C3 B2:D4)', 'SUM((A1:B2,C3))']) {
      expect(formatExpression(excel(text), { excel: true })).toBe(text);
    }
  });

  it('reads references qualified by a name before "!"', () => {
    expect(excel('Sales!B2')).toMatchObject({
      type: 'qualified',
      scope: 'Sales',
      quoted: false,
      ref: { type: 'cell' },
    });
    expect(excel("'Q1 budget'!Totals[Amount]")).toMatchObject({
      type: 'qualified',
      scope: 'Q1 budget',
      quoted: true,
      ref: { type: 'struct', table: 'Totals', col1: 'Amount' },
    });
    expect(excel("'It''s'!A1:B2")).toMatchObject({ scope: "It's", ref: { type: 'range' } });
    for (const text of ['Sales!B2', "'Q1 budget'!Totals[Amount]", "'It''s'!A1:B2", 'Sales!2:3']) {
      expect(formatExpression(excel(text), { excel: true })).toBe(text);
    }
  });
});

describe('structured references', () => {
  it('reads structured references', () => {
    expect(plain(excel('Table1[Price]'))).toEqual({
      type: 'struct',
      table: 'Table1',
      items: [],
      thisRow: false,
      col1: 'Price',
    });
    expect(plain(excel('Table1[[#Headers],[Price]]'))).toEqual({
      type: 'struct',
      table: 'Table1',
      items: ['#Headers'],
      thisRow: false,
      col1: 'Price',
    });
    expect(plain(excel('[@Price]'))).toEqual({ type: 'struct', items: [], thisRow: true, col1: 'Price' });
    expect(plain(excel('[@[Unit price]]'))).toEqual({ type: 'struct', items: [], thisRow: true, col1: 'Unit price' });
    expect(plain(excel('[#Totals]'))).toEqual({ type: 'struct', items: ['#Totals'], thisRow: false });
    expect(plain(excel('[[#This Row],[Qty]]'))).toEqual({
      type: 'struct',
      items: ['#This Row'],
      thisRow: false,
      col1: 'Qty',
    });
    expect(plain(excel('T[[Jan]:[Mar]]'))).toEqual({
      type: 'struct',
      table: 'T',
      items: [],
      thisRow: false,
      col1: 'Jan',
      col2: 'Mar',
    });
    expect(plain(excel("T[Q'#]"))).toMatchObject({ col1: 'Q#' });
    // A plain [Col] with no table stays the column reference it always was.
    expect(excel('[Price]')).toMatchObject({ type: 'col', by: 'name', key: 'Price' });
    for (const text of [
      'Table1[Price]',
      'Table1[[#Headers],[Price]]',
      '[@Price]',
      '[@[Unit price]]',
      '[#Totals]',
      'T[[Jan]:[Mar]]',
    ]) {
      expect(formatExpression(excel(text), { excel: true })).toBe(text);
    }
    expect(() => excel('T[[a],[b]]')).toThrow(ExprError);
  });
});

describe('R1C1 references', () => {
  it('reads R1C1 references relative to a cell when asked', () => {
    const at = sheetDialect({ decimal: '.', separator: ',', rules: 'excel', r1c1: { row: 4, col: 2 } });
    expect(plain(parse('R2C3', at))).toEqual({ type: 'cell', col: 2, row: 1, abs: { col: true, row: true } });
    expect(plain(parse('R[-1]C', at))).toEqual({ type: 'cell', col: 2, row: 3 });
    expect(plain(parse('RC[2]', at))).toEqual({ type: 'cell', col: 4, row: 4 });
    expect(parse('SUM(R[-4]C:R[-1]C)', at)).toMatchObject({ args: [{ type: 'range', col1: 2, row1: 0, row2: 3 }] });
    expect(formatExpression(parse('R[-1]C[-2]*2', at), { excel: true })).toBe('A4*2');
    // Without an anchor the same text is a name.
    expect(excel('RC')).toMatchObject({ type: 'name' });
  });
});

describe('error values and calls in place', () => {
  it('reads error values as names that start with "#", and prints them back', () => {
    expect(excel('#REF!*#ref!')).toMatchObject({ left: { type: 'name', name: '#REF!' }, right: { name: '#REF!' } });
    expect(excel('IF(A1=#N/A,#DIV/0!,#NAME?)')).toMatchObject({ args: [{}, { name: '#DIV/0!' }, { name: '#NAME?' }] });
    expect(formatExpression(excel('#REF!+1'), { excel: true })).toBe('#REF!+1');
    // A spill reference keeps its "#", and the textbook rules still refuse one.
    expect(excel('A1#')).toMatchObject({ type: 'spill' });
    expect(() => parse('#REF!', SHEET)).toThrow(ExprError);
  });

  it('calls the value of a call in place, as LAMBDA(x, x+1)(2)', () => {
    const node = excel('LAMBDA(x,x+1)(2)');
    expect(node).toMatchObject({ type: 'call', name: 'LAMBDA', args: [{ type: 'num', value: 2 }] });
    expect(node).toMatchObject({ callee: { type: 'call', name: 'LAMBDA' } });
    expect(formatExpression(node, { excel: true })).toBe('LAMBDA(x,x+1)(2)');
    expect(() => excel('LAMBDA(x,x) (2)')).toThrow(ExprError);
  });
});
