import { describe, expect, it } from 'vitest';
import { compileNode } from './compile';
import { mathConstant } from './constants';
import { standardFunctions } from './functions';
import { evaluate, GENERAL } from './general';
import { snap } from './numeric';
import { parse } from './parser';
import { LETTERS } from './testing';

const STRICT = standardFunctions('strict');
const PLAIN = standardFunctions('plain');

/** Runs text with the strict evaluator and the general dialect. */
function strict(source: string, angle: 'deg' | 'rad' = 'rad') {
  return evaluate(source, { angle });
}

/** Runs text with the lenient evaluator, a variable x, and the letters dialect. */
function lenient(source: string, x = 0): number {
  const run = compileNode<{ x: number }>(parse(source, LETTERS), {
    strict: false,
    table: PLAIN,
    bind: (name) => {
      if (name === 'x') return (ctx) => ctx.x;
      const constant = mathConstant(name);
      return constant === undefined ? undefined : () => constant;
    },
  });
  return run({ x });
}

function value(source: string, angle: 'deg' | 'rad' = 'rad'): number {
  const result = strict(source, angle);
  if (!result.ok) throw new Error(`${source}: ${result.error.code} at ${result.error.position}`);
  return result.value;
}

function code(source: string): string {
  const result = strict(source);
  if (result.ok) throw new Error(`${source} gave ${result.value}`);
  return `${result.error.code}@${result.error.position}`;
}

describe('strict mode', () => {
  it('snaps sums, differences, and products but keeps other steps exact', () => {
    expect(value('0.1 + 0.2')).toBe(0.3);
    expect(value('1.1 * 1.1')).toBe(1.21);
    expect(value('(1/3)*3')).toBe(1);
    expect(value('sqrt(2)^2')).toBe(2);
  });

  it('puts the place of a failing step on the error', () => {
    expect(code('1 / 0')).toBe('divide-by-zero@2');
    expect(code('2 + sqrt(-1)')).toBe('domain@4');
    expect(code('1 + (2 / 0)')).toBe('divide-by-zero@7');
    expect(code('foo + 1')).toBe('unknown-name@0');
    expect(code('10 ^ 400')).toBe('overflow@3');
  });

  it('reports the name and the length of the failing step', () => {
    const result = strict('1 + sqrt(-4)');
    if (result.ok) throw new Error('should fail');
    expect(result.error).toMatchObject({ code: 'domain', position: 4, detail: 'sqrt', length: 8 });
  });

  it('turns NaN into a domain error and infinity into an overflow', () => {
    expect(code('asin(2)')).toBe('domain@0');
    expect(code('exp(1000)')).toBe('overflow@0');
    expect(code('ln(0)')).toBe('domain@0');
  });

  it('is exact at familiar angles in either unit', () => {
    expect(value('sin(30)', 'deg')).toBe(0.5);
    expect(value('cos(60)', 'deg')).toBe(0.5);
    expect(value('sin(pi)')).toBe(0);
    expect(value('tan(pi/4)')).toBe(1);
    expect(code('tan(pi/2)')).toBe('domain@0');
    expect(value('asin(0.5)', 'deg')).toBe(30);
    expect(value('90°')).toBeCloseTo(Math.PI / 2, 12);
    expect(value('90°', 'deg')).toBe(90);
  });

  it('counts with whole numbers only', () => {
    expect(value('5!')).toBe(120);
    expect(value('nCr(52, 5)')).toBe(2598960);
    expect(code('2.5!')).toBe('domain@3');
    expect(code('171!')).toBe('overflow@3');
  });

  it('reads variables and constants from the host', () => {
    expect(evaluate('2a + b', { variables: { a: 3, b: 4 } })).toEqual({ ok: true, value: 10 });
    expect(evaluate('phi^2 - phi')).toMatchObject({ ok: true });
  });

  it('never runs text as code', () => {
    for (const hostile of ['constructor', '__proto__', 'toString(1)', 'this', 'process', 'x.y', '1;2', '`1`']) {
      expect(strict(hostile).ok).toBe(false);
    }
  });
});

describe('lenient mode', () => {
  it('lets NaN and infinity through', () => {
    expect(lenient('1/x', 0)).toBe(Infinity);
    expect(lenient('0/x', 0)).toBeNaN();
    expect(lenient('ln(x)', 0)).toBe(-Infinity);
    expect(lenient('ln(x)', -1)).toBeNaN();
    expect(lenient('sqrt(x)', -1)).toBeNaN();
  });

  it('takes real odd roots of negative numbers', () => {
    expect(lenient('(-8)^(1/3)')).toBeCloseTo(-2, 12);
    expect(lenient('x^(2/3)', -27)).toBeCloseTo(9, 9);
    expect(lenient('x^(1/2)', -4)).toBeNaN();
  });

  it('extends the factorial to fractions with the gamma function', () => {
    expect(lenient('5!')).toBe(120);
    expect(lenient('(1/2)!')).toBeCloseTo(Math.sqrt(Math.PI) / 2, 10);
    expect(lenient('171!')).toBe(Infinity);
  });

  it('gives NaN for a name with no value', () => {
    const run = compileNode<undefined>(parse('2 + y', LETTERS), { strict: false, table: PLAIN, bind: () => undefined });
    expect(run(undefined)).toBeNaN();
  });

  it('uses radians', () => {
    expect(lenient('sin(x)', Math.PI / 2)).toBeCloseTo(1, 12);
  });
});

describe('function tables', () => {
  it('has the same canonical names in both profiles', () => {
    expect(Object.keys(STRICT).sort()).toEqual(Object.keys(PLAIN).sort());
  });

  it('knows each function by its argument counts and inverse', () => {
    expect(STRICT.sin).toMatchObject({ min: 1, max: 1, inverse: 'asin' });
    expect(STRICT.atan2).toMatchObject({ min: 2, max: 2 });
    expect(STRICT.round).toMatchObject({ min: 1, max: 2 });
    expect(PLAIN.asin.inverse).toBe('sin');
  });

  it('agrees between profiles where the answer is defined', () => {
    for (const x of [0.3, 1, 2.5, 7]) {
      expect(STRICT.sqrt.run([x], 'rad')).toBe(PLAIN.sqrt.run([x], 'rad'));
      expect(STRICT.ln.run([x], 'rad')).toBe(PLAIN.ln.run([x], 'rad'));
      expect(STRICT.cbrt.run([x], 'rad')).toBe(PLAIN.cbrt.run([x], 'rad'));
    }
  });
});

describe('snap', () => {
  it('rounds to 15 significant digits and keeps zero, infinity, and NaN', () => {
    expect(snap(0.1 + 0.2)).toBe(0.3);
    expect(snap(-0)).toBe(0);
    expect(snap(Infinity)).toBe(Infinity);
    expect(snap(NaN)).toBeNaN();
    expect(snap(123456789.12345679)).toBe(123456789.123457);
    expect(snap(1234567890123456)).toBe(1234567890123460);
    expect(snap(999999999999999)).toBe(999999999999999);
    expect(snap(-42)).toBe(-42);
  });
});

describe('general dialect', () => {
  it('leaves out names that make better variables', () => {
    expect(GENERAL.functions?.('pow')).toBeUndefined();
    expect(GENERAL.functions?.('deg')).toBeUndefined();
    expect(GENERAL.functions?.('ARCSIN')?.name).toBe('asin');
  });
});
