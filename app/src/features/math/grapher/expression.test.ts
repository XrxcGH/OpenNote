import { describe, expect, it } from 'vitest';
import { compileExpression, differentiateExpression, type Params } from './evaluate';
import { findParameters } from './parser';

function value(source: string, x = 0, params: Params = {}): number {
  const result = compileExpression(source, { parameters: Object.keys(params) });
  if (!result.ok) throw new Error(`${source}: ${result.error.message}`);
  return result.expression.evaluate(x, params);
}

function problem(source: string, parameters: string[] = []) {
  const result = compileExpression(source, { parameters });
  if (result.ok) throw new Error(`${source} should not compile`);
  return result.error;
}

describe('operator precedence', () => {
  it('multiplies before it adds and keeps left-to-right order', () => {
    expect(value('2+3*4')).toBe(14);
    expect(value('10-4-3')).toBe(3);
    expect(value('24/4/3')).toBe(2);
  });

  it('raises powers right to left and binds a sign looser than ^', () => {
    expect(value('2^3^2')).toBe(512);
    expect(value('-x^2', 3)).toBe(-9);
    expect(value('2^-1')).toBe(0.5);
    expect(value('(-x)^2', 3)).toBe(9);
  });

  it('applies the factorial before the power', () => {
    expect(value('5!')).toBe(120);
    expect(value('2^3!')).toBe(64);
  });
});

describe('implicit multiplication', () => {
  it('reads numbers, names, and brackets next to each other as products', () => {
    expect(value('2x', 4)).toBe(8);
    expect(value('2(x+1)', 4)).toBe(10);
    expect(value('(x+1)(x-1)', 3)).toBe(8);
    expect(value('x(x+1)', 3)).toBe(12);
    expect(value('2pi')).toBeCloseTo(2 * Math.PI, 12);
    expect(value('xe', 2)).toBeCloseTo(2 * Math.E, 12);
    expect(value('3x^2y', 2, { y: 5 })).toBe(60);
  });

  it('keeps a power with its own base', () => {
    expect(value('2x^2', 3)).toBe(18);
    expect(value('x^2x', 2)).toBe(8);
  });

  it('splits runs of letters into names', () => {
    expect(value('pix', 2)).toBeCloseTo(2 * Math.PI, 12);
    expect(value('ax', 3, { a: 4 })).toBe(12);
    expect(value('xsin(x)', Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('reads 2e3 as a number and 2e as two times e', () => {
    expect(value('2e3')).toBe(2000);
    expect(value('1.5e-2')).toBeCloseTo(0.015, 12);
    expect(value('2e')).toBeCloseTo(2 * Math.E, 12);
  });
});

describe('functions', () => {
  it('takes brackets, or a bare argument', () => {
    expect(value('sin(x)', Math.PI / 2)).toBeCloseTo(1, 12);
    expect(value('sin 2x', 0.25)).toBeCloseTo(Math.sin(0.5), 12);
    expect(value('sin x cos x', 0.5)).toBeCloseTo(Math.sin(0.5) * Math.cos(0.5), 12);
    expect(value('sin x^2', 0.5)).toBeCloseTo(Math.sin(0.25), 12);
    expect(value('sin cos x', 0)).toBeCloseTo(Math.sin(1), 12);
  });

  it('takes a power on the function name and a minus one for the inverse', () => {
    expect(value('sin^2(x)+cos^2(x)', 0.7)).toBeCloseTo(1, 12);
    expect(value('sin^2 x', 0.7)).toBeCloseTo(Math.sin(0.7) ** 2, 12);
    expect(value('sin^-1(0.5)')).toBeCloseTo(Math.PI / 6, 12);
    expect(value('tan^-1(1)')).toBeCloseTo(Math.PI / 4, 12);
  });

  it('knows the usual values', () => {
    expect(value('ln(e)')).toBeCloseTo(1, 12);
    expect(value('log(1000)')).toBeCloseTo(3, 12);
    expect(value('log(8, 2)')).toBeCloseTo(3, 12);
    expect(value('sqrt(16)')).toBe(4);
    expect(value('√16')).toBe(4);
    expect(value('abs(-3)')).toBe(3);
    expect(value('max(1, 5, 3)')).toBe(5);
    expect(value('atan2(1, 1)')).toBeCloseTo(Math.PI / 4, 12);
    expect(value('mod(-1, 3)')).toBe(2);
    expect(value('round(2.5)') + value('round(-2.5)')).toBe(0);
    expect(value('fact(10)')).toBe(3628800);
    expect(value('gamma(0.5)')).toBeCloseTo(Math.sqrt(Math.PI), 10);
    expect(value('gamma(5)')).toBeCloseTo(24, 9);
    expect(value('sinh(0)+cosh(0)+tanh(0)')).toBe(1);
    expect(value('90deg')).toBeCloseTo(Math.PI / 2, 12);
  });

  it('returns real roots of negative numbers for odd roots only', () => {
    expect(value('(-8)^(1/3)')).toBeCloseTo(-2, 12);
    expect(value('x^(2/3)', -27)).toBeCloseTo(9, 9);
    expect(value('x^(1/2)', -4)).toBeNaN();
    expect(value('sqrt(x)', -1)).toBeNaN();
  });

  it('returns infinity or NaN outside a domain instead of throwing', () => {
    expect(value('1/x', 0)).toBe(Infinity);
    expect(value('ln(x)', 0)).toBe(-Infinity);
    expect(value('ln(x)', -1)).toBeNaN();
    expect(value('0/x', 0)).toBeNaN();
  });
});

describe('parameters and symbols', () => {
  it('evaluates with the values given, and is NaN without one', () => {
    const result = compileExpression('a x^2 + b', { parameters: ['a', 'b'] });
    if (!result.ok) throw new Error('should compile');
    expect(result.expression.evaluate(3, { a: 2, b: 1 })).toBe(19);
    expect(result.expression.evaluate(3, { a: 2 })).toBeNaN();
  });

  it('lets a parameter shadow a constant', () => {
    expect(value('e x', 3, { e: 2 })).toBe(6);
  });

  it('accepts y = and f(x) = in front', () => {
    expect(value('y = 2x + 1', 3)).toBe(7);
    expect(value('f(x) = x^2', 3)).toBe(9);
  });

  it('accepts symbols pasted from other apps', () => {
    expect(value('x² + x³', 2)).toBe(12);
    expect(value('3 × 4 ÷ 2 − 1')).toBe(5);
    expect(value('π')).toBeCloseTo(Math.PI, 12);
  });

  it('finds the letters that need a value', () => {
    expect(findParameters('a x^2 + b sin(x) + pi')).toEqual(['a', 'b']);
    expect(findParameters('x^2')).toEqual([]);
  });
});

describe('mistakes', () => {
  it('points at where the expression ends too soon', () => {
    const error = problem('2+');
    expect(error.position).toBe(2);
    expect(error.message).toMatch(/missing/i);
  });

  it('points at a missing closing bracket and an extra one', () => {
    expect(problem('(1+2').position).toBe(4);
    expect(problem('1+2)').position).toBe(3);
  });

  it('points at a character it cannot read and at an unknown name', () => {
    expect(problem('3 $ 4').position).toBe(2);
    const unknown = problem('2 + q');
    expect(unknown.position).toBe(4);
    expect(unknown.message).toContain('"q"');
  });

  it('checks how many values a function takes', () => {
    expect(problem('atan2(1)').message).toMatch(/takes 2 values/);
    expect(problem('sin').message).toMatch(/needs a value/);
    expect(problem('sin(1, 2)').position).toBe(0);
  });

  it('refuses an empty expression and a stray equals sign', () => {
    expect(problem('   ').position).toBe(0);
    expect(problem('x = 3').message).toMatch(/Unexpected "="/);
  });

  it('refuses text too long or too deep to walk, and returns it as a problem', () => {
    const sum = (inner: string): string => `(${inner}${'+x'.repeat(1900)})`;
    expect(problem(sum(sum('1'))).message).toMatch(/nested too deeply/);
    expect(problem(sum(sum(sum(sum('1'))))).message).toMatch(/too long/);
    expect(problem('x' + '!'.repeat(1500)).message).toMatch(/nested too deeply/);
  });

  it('says when a derivative is too large to work out', () => {
    const result = differentiateExpression('x' + '*x'.repeat(150), {}, 2);
    expect(result.ok ? null : result.error).toMatchObject({ message: /too large/, position: 0 });
  });

  it('treats code-like text as unknown names, never as code', () => {
    expect(problem('constructor').message).toMatch(/Unknown name/);
    expect(problem('process.exit()').message).toMatch(/Unexpected character|Unknown name/);
    expect(problem('toString(x)').message).toMatch(/Unknown name/);
  });
});
