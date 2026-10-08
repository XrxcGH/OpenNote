import { describe, expect, it } from 'vitest';
import type { Node } from './ast';
import { compileNode } from './compile';
import { mathConstant } from './constants';
import { differentiate } from './derive';
import { ExprError } from './errors';
import { standardFunctions } from './functions';
import { parse } from './parser';
import { formatExpression } from './print';
import { simplify } from './simplify';
import { LETTERS } from './testing';

const PARAMS: Record<string, number> = { a: 3, b: -2, c: 0.5 };

/** A function of x for a tree. The letters a, b, and c have fixed values, like the grapher's sliders. */
function asFunction(node: Node): (x: number) => number {
  const run = compileNode<{ x: number }>(node, {
    strict: false,
    table: standardFunctions('plain'),
    bind: (name) => {
      if (name === 'x') return (ctx) => ctx.x;
      const value = Object.hasOwn(PARAMS, name) ? PARAMS[name] : mathConstant(name);
      return value === undefined ? undefined : () => value;
    },
  });
  return (x) => run({ x });
}

function derivativeOf(source: string, order = 1): Node {
  return differentiate(parse(source, LETTERS), 'x', order);
}

function text(source: string, order = 1): string {
  return formatExpression(derivativeOf(source, order));
}

/** A central difference with a step small enough to be accurate and large enough to avoid rounding noise. */
function slope(f: (x: number) => number, x: number): number {
  const h = 1e-5;
  return (f(x + h) - f(x - h)) / (2 * h);
}

const POINTS = [0.3, 0.7, 1.1, 1.9];

describe('writing the derivative', () => {
  it.each([
    ['x^2', '2*x'],
    ['x^3', '3*x^2'],
    ['3x^2+2x+1', '6*x+2'],
    ['5', '0'],
    ['a x', 'a'],
    ['sin(x)', 'cos(x)'],
    ['cos(x)', '-sin(x)'],
    ['sin(2x)', '2*cos(2*x)'],
    ['e^x', 'e^x'],
    ['ln(x)', '1/x'],
    ['sqrt(x)', '1/(2*sqrt(x))'],
    ['x', '1'],
    ['a', '0'],
    ['floor(x)', '0'],
  ])('d/dx of %s is %s', (source, expected) => {
    expect(text(source)).toBe(expected);
  });

  it('differentiates more than once', () => {
    expect(text('x^3', 2)).toBe('6*x');
    expect(text('x^3', 3)).toBe('6');
    expect(text('x^3', 4)).toBe('0');
    expect(text('sin(x)', 2)).toBe('-sin(x)');
  });

  it('stops a derivative that grows too large instead of building it', () => {
    const product = 'x' + '*x'.repeat(150);
    const started = performance.now();
    expect(() => derivativeOf(product, 2)).toThrow(expect.objectContaining({ code: 'too-deep' }));
    expect(performance.now() - started).toBeLessThan(1500);
    expect(formatExpression(derivativeOf('x*x*x*x'))).toBe('((x+x)*x+x*x)*x+x*x*x');
  });

  it('differentiates at most ten times, and a count that is not a whole number no times', () => {
    expect(text('x^3', 1e9)).toBe('0');
    expect(text('x^12', 1e9)).toBe('239500800*x^2');
    expect(text('x^3', Number.NaN)).toBe('x^3');
  });
});

describe('agreeing with a numeric slope', () => {
  it.each([
    'x^3 - 2x + 1',
    '(x+1)(x-1)',
    'x/(x^2+1)',
    'sin(x) cos(x)',
    'sin(x^2)',
    'cos(2x)^2',
    'tan(x)',
    'sec(x)',
    'csc(x)',
    'cot(x)',
    'e^x',
    'e^(-x^2)',
    '2^x',
    'a^x',
    'x^x',
    'x^(1/3)',
    'x^c',
    'ln(x)',
    'ln(1+x^2)',
    'log(x)',
    'log(x, 2)',
    'log(x, b^2)',
    'log2(x)',
    'log10(x)',
    'sqrt(x)',
    'cbrt(x)',
    'atan(x)',
    'asin(x/2)',
    'acos(x/2)',
    'sinh(x)',
    'cosh(x)',
    'tanh(x)',
    'asinh(x)',
    'acosh(x+1)',
    'atanh(x/2)',
    'abs(x - 1.5)',
    'atan2(x, 2)',
    'atan2(3, x)',
    'hypot(x, 2)',
    'pow(x, 2)',
    'root(x, 3)',
    'a x^2 + b x + c',
    '50%x',
    'x mod 5',
    '(x+2)^3 / (x+1)',
    '-x^2',
    'sin(sin(sin(x)))',
  ])('%s', (source) => {
    const f = asFunction(parse(source, LETTERS));
    const d = asFunction(derivativeOf(source));
    for (const x of POINTS) {
      const expected = slope(f, x);
      expect(d(x)).toBeCloseTo(expected, 5);
    }
  });

  it('agrees for the second derivative too', () => {
    const f = asFunction(parse('x^4 - sin(x)', LETTERS));
    const d2 = asFunction(derivativeOf('x^4 - sin(x)', 2));
    for (const x of POINTS) {
      const h = 1e-3;
      expect(d2(x)).toBeCloseTo((f(x + h) - 2 * f(x) + f(x - h)) / (h * h), 3);
    }
  });
});

describe('functions without a derivative', () => {
  function failure(source: string): string {
    try {
      derivativeOf(source);
    } catch (error) {
      if (error instanceof ExprError) return `${error.code}:${error.detail}@${error.position}`;
      throw error;
    }
    return 'no error';
  }

  it('says which function and where', () => {
    expect(failure('1 + max(x, 1)')).toBe('not-differentiable:max@4');
    expect(failure('gamma(x)')).toBe('not-differentiable:gamma@0');
    expect(failure('x mod x')).toBe('not-differentiable:mod@2');
  });

  it('is fine with such a function when it does not depend on x', () => {
    expect(failure('max(a, 1) + x')).toBe('no error');
  });
});

describe('simplifying', () => {
  const simple = (source: string): string => formatExpression(simplify(parse(source, LETTERS)));

  it.each([
    ['x+0', 'x'],
    ['0+x', 'x'],
    ['x-0', 'x'],
    ['0-x', '-x'],
    ['x*1', 'x'],
    ['1*x', 'x'],
    ['x*0', '0'],
    ['0/x', '0'],
    ['x/1', 'x'],
    ['x^1', 'x'],
    ['x^0', '1'],
    ['1^x', '1'],
    ['x-x', '0'],
    ['x/x', '1'],
    ['2*3+4', '10'],
    ['2*(3*x)', '6*x'],
    ['x*2', '2*x'],
    ['6/3', '2'],
    ['1/3', '1/3'],
    ['2^10', '1024'],
    ['2^0.5', '2^0.5'],
    ['--x', 'x'],
    ['x+-y', 'x-y'],
    ['x-(-y)', 'x+y'],
    ['-x+y', 'y-x'],
    ['(-x)*y', '-(x*y)'],
  ])('%s becomes %s', (source, expected) => {
    expect(simple(source)).toBe(expected);
  });

  it('keeps the value', () => {
    for (const source of ['(x+1)*(x-1)+0*x', 'sin(x)*1 + x^1 - 0', '2*(3*(x+x))', '-(-x*a)/1']) {
      const before = asFunction(parse(source, LETTERS));
      const after = asFunction(simplify(parse(source, LETTERS)));
      for (const x of POINTS) expect(after(x)).toBeCloseTo(before(x), 12);
    }
  });
});
