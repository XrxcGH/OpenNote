import { describe, expect, it } from 'vitest';
import { CONSTANTS } from './constants';
import { calculate, type EvalContext } from './evaluate';
import { formatNumber } from './format';

const DEG: EvalContext = { angle: 'deg', ans: 0, memory: [] };
const RAD: EvalContext = { angle: 'rad', ans: 0, memory: [] };

function value(source: string, context: EvalContext = DEG): number {
  const result = calculate(source, context);
  if (!result.ok) throw new Error(`${source}: ${result.error.code} at ${result.error.position}`);
  return result.value;
}

function failure(source: string, context: EvalContext = DEG) {
  const result = calculate(source, context);
  if (result.ok) throw new Error(`${source} gave ${result.value}`);
  return result.error;
}

describe('arithmetic', () => {
  it('follows operator precedence and associativity', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('10 - 4 - 3')).toBe(3);
    expect(value('100 / 10 / 5')).toBe(2);
    expect(value('2 ^ 3 ^ 2')).toBe(512);
    expect(value('-2 ^ 2')).toBe(-4);
    expect(value('2 ^ -2')).toBe(0.25);
    expect(value('--3')).toBe(3);
    expect(value('7 mod 3 * 2')).toBe(2);
  });

  it('reads implicit multiplication, left to right', () => {
    expect(value('2pi')).toBeCloseTo(2 * Math.PI, 12);
    expect(value('3(4 + 1)')).toBe(15);
    expect(value('(1 + 2)(3 + 4)')).toBe(21);
    expect(value('2sqrt(9)')).toBe(6);
    expect(value('sqrt(4)sqrt(9)')).toBe(6);
    expect(value('1/2(4)')).toBe(2);
    expect(value('pi(2)')).toBeCloseTo(2 * Math.PI, 12);
    expect(value('2e')).toBeCloseTo(2 * Math.E, 12);
  });
});

describe('numbers', () => {
  it('reads numbers, including scientific notation and pretty symbols', () => {
    expect(value('.5 + 1.25')).toBe(1.75);
    expect(value('1.5e3')).toBe(1500);
    expect(value('2E-2')).toBe(0.02);
    expect(value('2e+3*1')).toBe(2000);
    expect(value('6 × 7 ÷ 2 − 1')).toBe(20);
    expect(value('3²')).toBe(9);
    expect(value('2³')).toBe(8);
    expect(value('2 ** 5')).toBe(32);
    expect(value('π')).toBeCloseTo(Math.PI, 12);
    expect(value('√(16)')).toBe(4);
  });

  it('removes floating-point noise', () => {
    expect(value('0.1 + 0.2')).toBe(0.3);
    expect(value('(0.1 + 0.2) - 0.3')).toBe(0);
    expect(value('1.1 * 1.1')).toBe(1.21);
    expect(value('4.35 * 100')).toBe(435);
    expect(value('(1/3)*3')).toBe(1);
    expect(value('0.3 / 0.1')).toBe(3);
  });

  it('handles factorial, percent, and modulo', () => {
    expect(value('5!')).toBe(120);
    expect(value('0!')).toBe(1);
    expect(value('-3!')).toBe(-6);
    expect(value('2^3!')).toBe(64);
    expect(value('50%')).toBe(0.5);
    expect(value('200 * 15%')).toBe(30);
    expect(value('-7 mod 3')).toBe(2);
    expect(value('7 mod -3')).toBe(-2);
    expect(value('mod(10, 4)')).toBe(2);
    expect(value('5.5 mod 2')).toBe(1.5);
  });
});

describe('functions', () => {
  it('evaluates roots, logs, and rounding', () => {
    expect(value('sqrt(2)^2')).toBe(2);
    expect(value('cbrt(-27)')).toBe(-3);
    expect(value('root(32, 5)')).toBe(2);
    expect(value('ln(e^3)')).toBe(3);
    expect(value('log(1000)')).toBe(3);
    expect(value('log2(1024)')).toBe(10);
    expect(value('log(8, 2)')).toBe(3);
    expect(value('abs(-4.5)')).toBe(4.5);
    expect(value('floor(-2.5)')).toBe(-3);
    expect(value('ceil(2.1)')).toBe(3);
    expect(value('round(2.5)')).toBe(3);
    expect(value('round(-2.5)')).toBe(-3);
    expect(value('round(1.005, 2)')).toBe(1.01);
    expect(value('max(3, 9, 4)')).toBe(9);
    expect(value('hypot(3, 4)')).toBe(5);
    expect(value('exp(0)')).toBe(1);
  });

  it('counts permutations and combinations', () => {
    expect(value('nPr(5, 2)')).toBe(20);
    expect(value('nCr(5, 2)')).toBe(10);
    expect(value('nCr(52, 5)')).toBe(2598960);
    expect(value('nCr(10, 10)')).toBe(1);
    expect(value('nPr(10, 0)')).toBe(1);
    expect(value('factorial(10)')).toBe(3628800);
  });

  it('ignores case in function names and accepts common aliases', () => {
    expect(value('SQRT(9)')).toBe(3);
    expect(value('arcsin(1)')).toBe(90);
    expect(value('log10(100)')).toBe(2);
    expect(value('NCR(4,2)')).toBe(6);
  });

  it('reads hyperbolic functions', () => {
    expect(value('sinh(0)')).toBe(0);
    expect(value('cosh(0)')).toBe(1);
    expect(value('tanh(0)')).toBe(0);
    expect(value('asinh(sinh(2))')).toBeCloseTo(2, 12);
    expect(value('acosh(1)')).toBe(0);
    expect(value('atanh(0)')).toBe(0);
  });
});

describe('steps that jump', () => {
  it.each([
    ['floor(0.3/0.1)', 3],
    ['floor(0.7/0.1)', 7],
    ['ceil(0.3/0.1)', 3],
    ['trunc(0.7/0.1)', 7],
    ['round(0.15/0.1)', 2],
    ['(0.3/0.1)!', 6],
    ['ncr(0.6/0.1, 2)', 15],
    ['npr(0.3/0.1, 2)', 6],
    ['0.3 mod 0.1', 0],
    ['-0.3 mod 0.1', 0],
    ['mod(0.3, 0.1)', 0],
    ['0.35 mod 0.1', 0.05],
    ['7 mod -3', -2],
    ['5.5 mod 2', 1.5],
    ['floor(log(1000, 10))', 3],
    ['floor(log(8, 2))', 3],
    ['floor(root(64, 3))', 4],
  ])('reads %s with its input rounded to 15 digits, so it is %s', (source, expected) => {
    expect(value(source)).toBe(expected);
  });
});

describe('angles', () => {
  it('gives exact answers at familiar degrees', () => {
    expect(value('sin(30)')).toBe(0.5);
    expect(value('sin(180)')).toBe(0);
    expect(value('cos(90)')).toBe(0);
    expect(value('cos(60)')).toBe(0.5);
    expect(value('sin(270)')).toBe(-1);
    expect(value('sin(-30)')).toBe(-0.5);
    expect(value('tan(45)')).toBe(1);
    expect(value('sin(45)^2')).toBe(0.5);
    expect(value('cos(360 * 1000)')).toBe(1);
  });

  it('gives exact answers at familiar radians', () => {
    expect(value('sin(pi)', RAD)).toBe(0);
    expect(value('cos(pi/2)', RAD)).toBe(0);
    expect(value('sin(pi/6)', RAD)).toBe(0.5);
    expect(value('tan(pi/4)', RAD)).toBe(1);
    expect(value('cos(2pi)', RAD)).toBe(1);
    expect(value('sin(1)', RAD)).toBeCloseTo(0.8414709848, 9);
  });

  it('returns inverse functions in the current unit', () => {
    expect(value('asin(0.5)')).toBe(30);
    expect(value('acos(0)')).toBe(90);
    expect(value('atan(1)')).toBe(45);
    expect(value('atan2(1, 1)')).toBe(45);
    expect(value('acos(-1)', RAD)).toBeCloseTo(Math.PI, 12);
  });

  it('reads the degree sign in the current unit', () => {
    expect(value('sin(30°)')).toBe(0.5);
    expect(value('sin(30°)', RAD)).toBe(0.5);
    expect(value('90°', RAD)).toBeCloseTo(Math.PI / 2, 12);
    expect(value('deg(pi)', RAD)).toBe(180);
    expect(value('rad(180)')).toBeCloseTo(Math.PI, 12);
  });
});

describe('names', () => {
  it('knows math and physical constants', () => {
    expect(value('e')).toBeCloseTo(Math.E, 12);
    expect(value('tau')).toBeCloseTo(2 * Math.PI, 12);
    expect(value('phi^2 - phi')).toBeCloseTo(1, 12);
    expect(value('c')).toBe(299792458);
    expect(value('g')).toBe(9.80665);
    expect(value('G')).toBe(6.6743e-11);
    expect(value('NA * kB')).toBeCloseTo(8.31446261815, 9);
    expect(value('0.5 * me * c^2 / qe')).toBeGreaterThan(255000);
    expect(CONSTANTS.filter((k) => k.group === 'physics').every((k) => k.unit !== '')).toBe(true);
  });

  it('reads ans and memory slots', () => {
    const context: EvalContext = { angle: 'deg', ans: 12, memory: [5, null, 7] };
    expect(value('ans * 2', context)).toBe(24);
    expect(value('m1 + m3', context)).toBe(12);
    expect(value('m2', context)).toBe(0);
    expect(value('m9', context)).toBe(0);
    expect(value('2ans', context)).toBe(24);
  });
});

describe('errors', () => {
  it('names the problem and where it is', () => {
    expect(failure('')).toMatchObject({ code: 'empty' });
    expect(failure('   ')).toMatchObject({ code: 'empty' });
    expect(failure('2 +')).toMatchObject({ code: 'unexpected-end', position: 3 });
    expect(failure('2 + * 3')).toMatchObject({ code: 'unexpected-token', position: 4 });
    expect(failure('(1 + 2')).toMatchObject({ code: 'unclosed-paren', position: 0 });
    expect(failure('1 + 2)')).toMatchObject({ code: 'unexpected-token', position: 5 });
    expect(failure('2 3')).toMatchObject({ code: 'unexpected-token', position: 2 });
    expect(failure('2 $ 3')).toMatchObject({ code: 'bad-character', position: 2, detail: '$' });
    expect(failure('foo + 1')).toMatchObject({ code: 'unknown-name', position: 0, detail: 'foo' });
    expect(failure('sin 30')).toMatchObject({ code: 'needs-parens', detail: 'sin' });
    expect(failure('sqrt()')).toMatchObject({ code: 'arity', detail: 'sqrt' });
    expect(failure('nCr(5)')).toMatchObject({ code: 'arity', detail: 'ncr' });
    expect(failure('sin(1, 2)')).toMatchObject({ code: 'arity' });
    expect(failure('1.2.3')).toMatchObject({ code: 'unexpected-token' });
  });
});

describe('math errors', () => {
  it('reports math errors instead of NaN or Infinity', () => {
    expect(failure('1 / 0')).toMatchObject({ code: 'divide-by-zero', position: 2 });
    expect(failure('5 mod 0')).toMatchObject({ code: 'divide-by-zero' });
    expect(failure('0 ^ -1')).toMatchObject({ code: 'divide-by-zero' });
    expect(failure('sqrt(-1)')).toMatchObject({ code: 'domain', position: 0, detail: 'sqrt' });
    expect(failure('ln(0)')).toMatchObject({ code: 'domain' });
    expect(failure('log(-5)')).toMatchObject({ code: 'domain' });
    expect(failure('asin(2)')).toMatchObject({ code: 'domain' });
    expect(failure('atanh(1)')).toMatchObject({ code: 'domain' });
    expect(failure('(-8) ^ (1/3)')).toMatchObject({ code: 'domain' });
    expect(failure('tan(90)')).toMatchObject({ code: 'domain' });
    expect(failure('tan(pi/2)', RAD)).toMatchObject({ code: 'domain' });
    expect(failure('2.5!')).toMatchObject({ code: 'domain' });
    expect(failure('(-1)!')).toMatchObject({ code: 'domain' });
    expect(failure('nCr(3, 5)')).toMatchObject({ code: 'domain' });
    expect(failure('10 ^ 400')).toMatchObject({ code: 'overflow' });
    expect(failure('171!')).toMatchObject({ code: 'overflow' });
    expect(failure('9^9^9^9')).toMatchObject({ code: 'overflow' });
    expect(failure('exp(1000)')).toMatchObject({ code: 'overflow' });
  });

  it('refuses input that is too long or nested too deeply', () => {
    expect(failure('1+'.repeat(1500) + '1')).toMatchObject({ code: 'too-long' });
    expect(failure('('.repeat(500) + '1' + ')'.repeat(500))).toMatchObject({ code: 'too-deep' });
    expect(failure('-'.repeat(500) + '1')).toMatchObject({ code: 'too-deep' });
    expect(value('('.repeat(40) + '1' + ')'.repeat(40))).toBe(1);
    expect(failure('5' + '!'.repeat(1999))).toMatchObject({ code: 'too-deep' });
  });

  it('never runs text as code', () => {
    for (const hostile of ['alert(1)', 'process.exit()', 'constructor', '__proto__', 'toString()', 'this', '1;2']) {
      expect(calculate(hostile).ok).toBe(false);
    }
    expect(failure('constructor(1)')).toMatchObject({ code: 'unknown-name' });
  });
});

describe('formatting', () => {
  it('shows short results without noise', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(1 / 3)).toBe('0.333333333333');
    expect(formatNumber(2 / 3)).toBe('0.666666666667');
    expect(formatNumber(1234.5)).toBe('1234.5');
    expect(formatNumber(-0.25)).toBe('-0.25');
    expect(formatNumber(Math.PI, { digits: 5 })).toBe('3.1416');
    expect(formatNumber(Math.PI, { digits: 99 })).toBe('3.14159265358979');
  });

  it('switches to powers of ten for very large and small numbers', () => {
    expect(formatNumber(1e12)).toBe('1e12');
    expect(formatNumber(999999999999)).toBe('999999999999');
    expect(formatNumber(6.02214076e23)).toBe('6.02214076e23');
    expect(formatNumber(0.000001)).toBe('0.000001');
    expect(formatNumber(1.5e-7)).toBe('1.5e-7');
    expect(formatNumber(-1.6e-19)).toBe('-1.6e-19');
  });

  it('supports scientific, engineering, and fixed notation', () => {
    expect(formatNumber(12345.678, { notation: 'scientific', digits: 6 })).toBe('1.23457e4');
    expect(formatNumber(12345.678, { notation: 'engineering', digits: 6 })).toBe('12.3457e3');
    expect(formatNumber(0.00123, { notation: 'engineering' })).toBe('1.23e-3');
    expect(formatNumber(1e6, { notation: 'engineering' })).toBe('1e6');
    expect(formatNumber(150, { notation: 'engineering', digits: 1 })).toBe('200e0');
    expect(formatNumber(2.5, { notation: 'fixed' })).toBe('2.50');
    expect(formatNumber(2.5, { notation: 'fixed', decimals: 0 })).toBe('3');
    expect(formatNumber(-0.001, { notation: 'fixed' })).toBe('0.00');
    expect(formatNumber(1e22, { notation: 'fixed' })).toBe('1e22');
  });
});
