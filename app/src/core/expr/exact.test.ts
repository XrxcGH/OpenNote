import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ExprError } from './errors';
import { evaluateExact, exactToNumber, type ExactValue } from './exact';
import { GENERAL } from './general';
import { parse } from './parser';
import * as q from './rational';
import { formatDecimal, formatFraction, fromDecimalText, rational, type Rational } from './rational';

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));

const frac = (text: string): string => {
  const r = fromDecimalText(text);
  if (r === null) throw new Error(`${text} is not a number`);
  return formatFraction(r);
};

/** Evaluates with exact fractions. Names a, b, c, and x are 2, 3, 5, and 1/2. */
function exact(source: string): ExactValue {
  const values: Record<string, Rational> = { a: rational(2n), b: rational(3n), c: rational(5n), x: rational(1n, 2n) };
  return evaluateExact(parse(source, GENERAL), {
    name: (name) => (Object.hasOwn(values, name) ? values[name] : name === 'pi' ? Math.PI : undefined),
  });
}

function shown(source: string): string {
  const result = exact(source);
  return result.exact ? formatFraction(result.value) : `~${result.value}`;
}

describe('reading decimals exactly', () => {
  it('keeps every digit', () => {
    expect(frac('0.1')).toBe('1/10');
    expect(frac('1.5')).toBe('3/2');
    expect(frac('.25')).toBe('1/4');
    expect(frac('1.')).toBe('1');
    expect(frac('12')).toBe('12');
    expect(frac('2e3')).toBe('2000');
    expect(frac('1.5e-3')).toBe('3/2000');
    expect(frac('-0.75')).toBe('-3/4');
  });

  it('refuses text that is not a number', () => {
    expect(fromDecimalText('')).toBeNull();
    expect(fromDecimalText('.')).toBeNull();
    expect(fromDecimalText('abc')).toBeNull();
    expect(fromDecimalText('1e')).toBeNull();
  });
});

describe('exact arithmetic', () => {
  it('has no rounding error', () => {
    expect(shown('0.1 + 0.2')).toBe('3/10');
    expect(shown('0.1 + 0.2 - 0.3')).toBe('0');
    expect(shown('1/3 * 3')).toBe('1');
    expect(shown('1/3 + 1/6')).toBe('1/2');
    expect(shown('4.35 * 100')).toBe('435');
    expect(shown('0.3 / 0.1')).toBe('3');
  });

  it('keeps whole-number powers and some roots exact', () => {
    expect(shown('2^10')).toBe('1024');
    expect(shown('2^-3')).toBe('1/8');
    expect(shown('(2/3)^2')).toBe('4/9');
    expect(shown('4^(1/2)')).toBe('2');
    expect(shown('8^(2/3)')).toBe('4');
    expect(shown('sqrt(49/4)')).toBe('7/2');
    expect(shown('cbrt(-27)')).toBe('-3');
    expect(shown('root(32, 5)')).toBe('2');
  });

  it('keeps counting exact far past the size of a double', () => {
    expect(shown('30!')).toBe('265252859812191058636308480000000');
    expect(shown('nCr(60, 30)')).toBe('118264581564861424');
    expect(shown('nPr(10, 3)')).toBe('720');
  });

  it('keeps rounding and ordering functions exact', () => {
    expect(shown('floor(-7/2)')).toBe('-4');
    expect(shown('ceil(-7/2)')).toBe('-3');
    expect(shown('trunc(-7/2)')).toBe('-3');
    expect(shown('round(5/2)')).toBe('3');
    expect(shown('round(-5/2)')).toBe('-3');
    expect(shown('round(1.005, 2)')).toBe('101/100');
    expect(shown('abs(-1/3)')).toBe('1/3');
    expect(shown('min(1/2, 1/3, 2/3)')).toBe('1/3');
    expect(shown('max(1/2, 1/3, 2/3)')).toBe('2/3');
    expect(shown('-7 mod 3')).toBe('2');
    expect(shown('7 mod -3')).toBe('-2');
    expect(shown('50%')).toBe('1/2');
  });

  it('uses names with exact values', () => {
    expect(shown('a/b + x')).toBe('7/6');
    expect(shown('c^a')).toBe('25');
  });

  it('falls back to a double when no exact answer exists, and stays inexact', () => {
    expect(shown('2^0.5')).toBe(`~${Math.SQRT2}`);
    expect(shown('sin(1) + 1')).toMatch(/^~/);
    expect(shown('pi * 2')).toBe(`~${Math.PI * 2}`);
    expect(shown('sqrt(2)^2')).toMatch(/^~/);
  });

  it('puts the place of a failing step on the error', () => {
    const fail = (source: string) => {
      try {
        exact(source);
      } catch (error) {
        if (error instanceof ExprError) return `${error.code}@${error.position}`;
        throw error;
      }
      return 'no error';
    };
    expect(fail('1 / (a - 2)')).toBe('divide-by-zero@2');
    expect(fail('0 ^ -1')).toBe('divide-by-zero@2');
    expect(fail('sqrt(-4)')).toBe('domain@0');
    expect(fail('2.5!')).toBe('domain@3');
    expect(fail('foo')).toBe('unknown-name@0');
    expect(fail('2 ^ 100000')).toBe('overflow@2');
  });

  it('converts to the nearest double for display', () => {
    expect(exactToNumber(exact('1/3'))).toBe(1 / 3);
    expect(exactToNumber(exact('0.1 + 0.2'))).toBe(0.3);
    expect(exactToNumber(exact('2^0.5'))).toBe(Math.SQRT2);
  });
});

describe('fractions as text', () => {
  it('writes a fraction or a whole number', () => {
    expect(formatFraction(rational(6n, -4n))).toBe('-3/2');
    expect(formatFraction(rational(8n, 4n))).toBe('2');
  });

  it('writes a decimal that ends, or marks the part that repeats', () => {
    expect(formatDecimal(rational(3n, 10n))).toEqual({ text: '0.3', exact: true });
    expect(formatDecimal(rational(1n, 3n))).toEqual({ text: '0.(3)', exact: true });
    expect(formatDecimal(rational(1n, 7n))).toEqual({ text: '0.(142857)', exact: true });
    expect(formatDecimal(rational(1n, 6n))).toEqual({ text: '0.1(6)', exact: true });
    expect(formatDecimal(rational(-22n, 7n))).toEqual({ text: '-3.(142857)', exact: true });
    expect(formatDecimal(rational(5n))).toEqual({ text: '5', exact: true });
    expect(formatDecimal(rational(1n, 97n), 10)).toMatchObject({ exact: false });
  });
});

describe('properties of fractions', () => {
  const small = fc.integer({ min: -50, max: 50 });
  const fraction = fc.tuple(small, fc.integer({ min: 1, max: 50 })).map(([n, d]) => rational(BigInt(n), BigInt(d)));

  it('keeps fractions in lowest terms with a positive denominator', () => {
    fc.assert(
      fc.property(fraction, fraction, (a, b) => {
        for (const r of [q.add(a, b), q.mul(a, b), q.sub(a, b)]) {
          expect(r.d > 0n).toBe(true);
          expect(gcd(r.n, r.d)).toBe(1n);
        }
      }),
    );
  });

  it('floors, ceils, and rounds around the value', () => {
    fc.assert(
      fc.property(fraction, (a) => {
        expect(q.compare(q.floor(a), a)).toBeLessThanOrEqual(0);
        expect(q.compare(q.ceil(a), a)).toBeGreaterThanOrEqual(0);
        expect(q.compare(q.sub(q.ceil(a), q.floor(a)), rational(1n))).toBeLessThanOrEqual(0);
        expect(q.isInteger(q.round(a))).toBe(true);
      }),
    );
  });

  it('keeps mod between zero and the divisor', () => {
    fc.assert(
      fc.property(fraction, fraction, (a, b) => {
        fc.pre(b.n !== 0n);
        const r = q.mod(a, b);
        if (b.n > 0n) {
          expect(q.sign(r)).toBeGreaterThanOrEqual(0);
          expect(q.compare(r, b)).toBeLessThan(0);
        } else {
          expect(q.sign(r)).toBeLessThanOrEqual(0);
          expect(q.compare(r, b)).toBeGreaterThan(0);
        }
      }),
    );
  });
});
