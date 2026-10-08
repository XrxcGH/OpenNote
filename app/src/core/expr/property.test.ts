// Property tests: whatever the engine reads, it writes back to the same tree; whatever text it is given, it answers
// with a value and never throws; and exact evaluation obeys the laws of arithmetic.

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { sameTree, type BinaryNode, type Node } from './ast';
import { add, binary, call, div, mul, name, neg, num, pow, sub } from './build';
import { differentiate } from './derive';
import { ExprError } from './errors';
import { evaluateExact, type ExactValue } from './exact';
import { evaluate, GENERAL } from './general';
import { parse } from './parser';
import { formatExpression } from './print';
import * as q from './rational';
import { rational, type Rational } from './rational';
import { simplify } from './simplify';
import { LETTERS, SHEET, SHEET_COMMA } from './testing';

// Machines that are busy with other work can take several times longer than the usual 5 seconds.
vi.setConfig({ testTimeout: 30_000 });

const SPAN = { start: 0, end: 0, pos: 0 } as const;

// Trees to write and read back.

const names = fc.constantFrom('a', 'b', 'c', 'x');
const wholeNumber = fc.integer({ min: 0, max: 99 }).map((n) => num(n));
const decimalNumber = fc
  .tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 1, max: 99 }))
  .map(([a, b]) => num(Number(`${a}.${b}`)));
const calcLeaf: fc.Arbitrary<Node> = fc.oneof(wholeNumber, decimalNumber, names.map(name));

const CALC_OPS: BinaryNode['op'][] = ['+', '-', '*', '/', '^', 'mod'];
const ONE_ARGUMENT = ['sin', 'cos', 'abs', 'sqrt', 'ln', 'floor'];
const TWO_ARGUMENTS = ['max', 'min', 'atan2', 'ncr'];

function calcTree(depth: number): fc.Arbitrary<Node> {
  if (depth === 0) return calcLeaf;
  const sub = calcTree(depth - 1);
  return fc.oneof(
    calcLeaf,
    fc.tuple(fc.constantFrom(...CALC_OPS), sub, sub).map(([op, l, r]) => binary(op, l, r)),
    sub.map(neg),
    sub.map((arg): Node => ({ type: 'unary', op: '+', arg, ...SPAN })),
    fc
      .tuple(fc.constantFrom('!', '%', '°'), sub)
      .map(([op, arg]): Node => ({ type: 'postfix', op: op as '!', arg, ...SPAN })),
    fc.tuple(fc.constantFrom(...ONE_ARGUMENT), sub).map(([fn, arg]) => call(fn, arg)),
    fc.tuple(fc.constantFrom(...TWO_ARGUMENTS), sub, sub).map(([fn, a, b]) => call(fn, a, b)),
  );
}

const SHEET_OPS: BinaryNode['op'][] = ['+', '-', '*', '/', '^', '&', '=', '<>', '<', '>', '<=', '>='];
const sheetLeaf: fc.Arbitrary<Node> = fc.oneof(
  wholeNumber,
  decimalNumber,
  fc.string({ maxLength: 6 }).map((value): Node => ({ type: 'str', value, ...SPAN })),
  fc.boolean().map((value): Node => ({ type: 'bool', value, ...SPAN })),
  fc.string({ maxLength: 8 }).map((key): Node => ({ type: 'col', by: 'name', key, ...SPAN })),
  fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/).map((key): Node => ({ type: 'col', by: 'id', key, ...SPAN })),
  fc
    .tuple(fc.integer({ min: 0, max: 80 }), fc.integer({ min: 0, max: 200 }))
    .map(([col, row]): Node => ({ type: 'cell', col, row, ...SPAN })),
  fc
    .tuple(
      fc.integer({ min: 0, max: 30 }),
      fc.integer({ min: 0, max: 30 }),
      fc.integer({ min: 0, max: 50 }),
      fc.integer({ min: 0, max: 50 }),
    )
    .map(([c1, c2, r1, r2]): Node => ({
      type: 'range',
      col1: Math.min(c1, c2),
      col2: Math.max(c1, c2),
      row1: Math.min(r1, r2),
      row2: Math.max(r1, r2),
      ...SPAN,
    })),
  fc
    .integer({ min: 0, max: 30 })
    .map((col): Node => ({ type: 'range', col1: col, col2: col, row1: 0, row2: Infinity, ...SPAN })),
);

function sheetTree(depth: number): fc.Arbitrary<Node> {
  if (depth === 0) return sheetLeaf;
  const sub = sheetTree(depth - 1);
  return fc.oneof(
    sheetLeaf,
    fc.tuple(fc.constantFrom(...SHEET_OPS), sub, sub).map(([op, l, r]) => binary(op, l, r)),
    sub.map(neg),
    sub.map((arg): Node => ({ type: 'unary', op: '√', arg, ...SPAN })),
    sub.map((arg): Node => ({ type: 'postfix', op: '%', arg, ...SPAN })),
    fc
      .tuple(fc.constantFrom('SUM', 'IF', 'NOW', 'LEFT'), fc.array(sub, { maxLength: 3 }))
      .map(([fn, args]) => call(fn, ...args)),
  );
}

describe('writing a tree and reading it back', () => {
  it('gives the same tree for calculator trees', () => {
    fc.assert(
      fc.property(calcTree(4), (tree) => {
        const text = formatExpression(tree);
        expect(sameTree(parse(text, GENERAL), tree), text).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('gives the same tree for spreadsheet trees, in stored form', () => {
    fc.assert(
      fc.property(sheetTree(3), (tree) => {
        const text = formatExpression(tree);
        expect(sameTree(parse(text, SHEET), tree), text).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('gives the same tree for spreadsheet trees, in regional form', () => {
    fc.assert(
      fc.property(sheetTree(3), (tree) => {
        const text = formatExpression(tree, { decimal: ',', separator: ';' });
        expect(sameTree(parse(text, SHEET_COMMA), tree), text).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('writes spaced text that reads back the same', () => {
    fc.assert(
      fc.property(calcTree(3), (tree) => {
        const text = formatExpression(tree, { spaced: true });
        expect(sameTree(parse(text, GENERAL), tree), text).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// Text a person might type: the tree it reads is stable when written and read again.

const typed = fc.string({
  unit: fc.constantFrom(...'0123456789.+-*/^()!%, abxsincoqrtmd°×÷²e'.split('')),
  maxLength: 24,
});

describe('text a person might type', () => {
  it('reads to a tree that writes back and reads again to the same tree', () => {
    let readable = 0;
    fc.assert(
      fc.property(typed, fc.constantFrom(GENERAL, LETTERS), (text, dialect) => {
        let tree: Node;
        try {
          tree = parse(text, dialect);
        } catch (error) {
          expect(error).toBeInstanceOf(ExprError);
          return;
        }
        readable += 1;
        const written = formatExpression(tree);
        expect(sameTree(parse(written, dialect), tree), `${text} -> ${written}`).toBe(true);
      }),
      { numRuns: 3000 },
    );
    expect(readable).toBeGreaterThan(100);
  });

  it('always answers with a value, never an exception', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (text) => {
        const result = evaluate(text);
        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) expect(result.error.position).toBeGreaterThanOrEqual(0);
        else expect(Number.isFinite(result.value)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('never throws anything but an ExprError, even for odd characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), (text) => {
        for (const dialect of [GENERAL, LETTERS, SHEET]) {
          try {
            parse(text, dialect);
          } catch (error) {
            expect(error).toBeInstanceOf(ExprError);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});

// The laws of arithmetic, checked with exact fractions, so there is no rounding to excuse a difference.

const ENV_NAMES = ['a', 'b', 'c', 'x'] as const;
const fractionOf = fc
  .tuple(fc.integer({ min: -40, max: 40 }), fc.integer({ min: 1, max: 12 }))
  .map(([n, d]) => rational(BigInt(n), BigInt(d)));
const values = fc.tuple(fractionOf, fractionOf, fractionOf, fractionOf);
const small = fc.integer({ min: 0, max: 5 });

/** An arithmetic tree that stays exact: sums, products, quotients, small whole powers, and abs. */
function arithmetic(depth: number): fc.Arbitrary<Node> {
  const leaf = fc.oneof(
    fc.integer({ min: 0, max: 9 }).map((n) => num(n)),
    fc.constantFrom(...ENV_NAMES).map(name),
  );
  if (depth === 0) return leaf;
  const sub = arithmetic(depth - 1);
  return fc.oneof(
    leaf,
    fc.tuple(fc.constantFrom<BinaryNode['op']>('+', '-', '*', '/'), sub, sub).map(([op, l, r]) => binary(op, l, r)),
    fc.tuple(sub, fc.integer({ min: 0, max: 3 })).map(([base, n]) => pow(base, num(n))),
    sub.map(neg),
    sub.map((arg) => call('abs', arg)),
  );
}

function evaluateWith(tree: Node, v: readonly Rational[]): ExactValue | null {
  const byName = new Map<string, Rational>(ENV_NAMES.map((n, i) => [n, v[i]]));
  try {
    return evaluateExact(tree, { name: (n) => byName.get(n) });
  } catch (error) {
    if (error instanceof ExprError) return null;
    throw error;
  }
}

/** True when both trees give the same exact fraction. A law need not hold where its left side fails. */
function agree(left: Node, right: Node, v: readonly Rational[]): boolean {
  const a = evaluateWith(left, v);
  const b = evaluateWith(right, v);
  if (a === null) return true;
  if (b === null) return false;
  return a.exact && b.exact && q.compare(a.value, b.value) === 0;
}

const [A, B, C] = [name('a'), name('b'), name('c')];

describe('laws of arithmetic, exactly', () => {
  const laws: [string, (x: Node, y: Node, z: Node) => [Node, Node]][] = [
    ['addition commutes', (x, y) => [add(x, y), add(y, x)]],
    ['multiplication commutes', (x, y) => [mul(x, y), mul(y, x)]],
    ['addition associates', (x, y, z) => [add(add(x, y), z), add(x, add(y, z))]],
    ['multiplication associates', (x, y, z) => [mul(mul(x, y), z), mul(x, mul(y, z))]],
    ['multiplication distributes over addition', (x, y, z) => [mul(x, add(y, z)), add(mul(x, y), mul(x, z))]],
    ['subtraction is adding the negative', (x, y) => [sub(x, y), add(x, neg(y))]],
    ['a number minus itself is zero', (x) => [sub(x, x), num(0)]],
    ['zero and one do nothing', (x) => [mul(add(x, num(0)), num(1)), x]],
    ['a double negative cancels', (x) => [neg(neg(x)), x]],
    ['a square is a product', (x) => [pow(x, num(2)), mul(x, x)]],
    ['a product squares by factor', (x, y) => [pow(mul(x, y), num(2)), mul(pow(x, num(2)), pow(y, num(2)))]],
    [
      'the square of a sum',
      (x, y) => [pow(add(x, y), num(2)), add(add(pow(x, num(2)), mul(num(2), mul(x, y))), pow(y, num(2)))],
    ],
    ['abs ignores sign', (x) => [call('abs', x), call('abs', neg(x))]],
    ['abs of a product', (x, y) => [mul(call('abs', x), call('abs', y)), call('abs', mul(x, y))]],
    ['dividing then multiplying returns the start', (x, y) => [mul(div(x, y), y), x]],
    ['adding fractions', (x, y, z) => [add(div(x, z), div(y, z)), div(add(x, y), z)]],
    ['min and max cover both', (x, y) => [add(call('min', x, y), call('max', x, y)), add(x, y)]],
    ['mod and floor rebuild the number', (x, y) => [add(binary('mod', x, y), mul(y, call('floor', div(x, y)))), x]],
  ];

  it.each(laws)('%s', (_label, make) => {
    fc.assert(
      fc.property(values, ([a, b, c, x]) => {
        const [left, right] = make(A, B, C);
        expect(agree(left, right, [a, b, c, x])).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('holds for whole expressions put in place of the names', () => {
    fc.assert(
      fc.property(arithmetic(2), arithmetic(2), arithmetic(2), values, (x, y, z, v) => {
        const [left, right] = [add(mul(x, add(y, z)), num(0)), add(mul(x, y), mul(x, z))];
        expect(agree(left, right, v)).toBe(true);
        expect(agree(add(x, y), add(y, x), v)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('powers add their exponents and multiply for powers of powers', () => {
    fc.assert(
      fc.property(values, small, small, ([a, b, c, x], m, n) => {
        fc.pre(q.sign(a) !== 0);
        const v = [a, b, c, x];
        expect(agree(pow(A, num(m + n)), mul(pow(A, num(m)), pow(A, num(n))), v)).toBe(true);
        expect(agree(pow(pow(A, num(m)), num(n)), pow(A, num(m * n)), v)).toBe(true);
        expect(agree(pow(A, neg(num(m))), div(num(1), pow(A, num(m))), v)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe('simplifying and differentiating, exactly', () => {
  it('simplifying never changes an exact value', () => {
    fc.assert(
      fc.property(arithmetic(3), values, (tree, v) => {
        const before = evaluateWith(tree, v);
        fc.pre(before !== null);
        const after = evaluateWith(simplify(tree), v);
        expect(after, formatExpression(tree)).not.toBeNull();
        expect(agree(tree, simplify(tree), v)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('the derivative of a polynomial matches the formula for its coefficients', () => {
    const coefficients = fc.array(fc.integer({ min: -9, max: 9 }), { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(coefficients, fractionOf, (cs, at) => {
        const term = (c: number, k: number): Node => mul(num(Math.abs(c)), pow(name('x'), num(k)));
        const signed = (c: number, k: number): Node => (c < 0 ? neg(term(c, k)) : term(c, k));
        const polynomial = cs.map((c, k) => signed(c, k)).reduce((sum, t) => add(sum, t));
        const slope = differentiate(polynomial, 'x');
        let expected = q.ZERO_RATIONAL;
        cs.forEach((c, k) => {
          if (k === 0) return;
          const power = q.powInt(at, BigInt(k - 1));
          expected = q.add(expected, q.mul(rational(BigInt(c * k)), power));
        });
        const got = evaluateWith(slope, [at, at, at, at]);
        expect(got?.exact).toBe(true);
        expect(q.compare((got as { value: Rational }).value, expected)).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
