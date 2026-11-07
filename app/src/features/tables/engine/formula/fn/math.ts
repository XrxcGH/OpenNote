// Math and trigonometry functions. Owner: tables:fn-math. Angles are in radians, as in Excel. ROUND rounds half away
// from zero. These are the functions tables had before the library; their behavior is unchanged.

import { err, finish, toNumbers, type Value } from '../../values';
import { numbersIn, type FnSpec2, type Param } from './types';

const number = (name = 'number'): Param => ({ name, kind: 'number' });

function scalar(name: string, params: Param[], run: (n: number[]) => Value, example: string): FnSpec2 {
  const signature = `${name}(${params.map((p) => (p.optional === true ? `[${p.name}]` : p.name)).join(', ')})`;
  return {
    name,
    family: 'math',
    params,
    run: (args) => {
      const nums = toNumbers(args);
      return Array.isArray(nums) ? run(nums) : nums;
    },
    meta: { signature, example },
  };
}

function math1(name: string, f: (x: number) => number, example: string, ok: (x: number) => boolean = () => true) {
  return scalar(name, [number()], ([x]) => (ok(x) ? finish(f(x)) : err('NUM')), example);
}

/** Shifts the decimal point with exponent text, so 1.005 rounds as a person expects. */
function shift(n: number, digits: number): number {
  const [mantissa, exponent] = n.toExponential().split('e');
  return Number(`${mantissa}e${Number(exponent) + digits}`);
}

function roundWith(name: string, mode: 'half' | 'up' | 'down', example: string): FnSpec2 {
  const params = [number(), { name: 'digits', kind: 'number', optional: true, default: 0 } as const];
  return scalar(
    name,
    params,
    ([x, d = 0]) => {
      const digits = Math.trunc(d);
      const abs = shift(Math.abs(x), digits);
      const whole = mode === 'half' ? Math.round(abs) : mode === 'up' ? Math.ceil(abs) : Math.floor(abs);
      return finish(Math.sign(x) * shift(whole, -digits));
    },
    example,
  );
}

function power(x: number, y: number): Value {
  if (x === 0 && y < 0) return err('DIV0');
  // Excel calls zero to the power of zero undefined, so it is a number error here too.
  if (x === 0 && y === 0) return err('NUM');
  return finish(x ** y);
}

export const functions: readonly FnSpec2[] = [
  {
    name: 'SUM',
    family: 'math',
    params: [{ repeat: [{ name: 'value', kind: 'range' }], min: 1 }],
    run: (args) => {
      const nums = numbersIn(args);
      return Array.isArray(nums) ? finish(nums.reduce((a, b) => a + b, 0)) : nums;
    },
    meta: { signature: 'SUM(value, ...)', example: '=SUM(2, 3, 4) gives 9' },
  },
  math1('ABS', Math.abs, '=ABS(-3) gives 3'),
  math1('INT', Math.floor, '=INT(-2.5) gives -3'),
  math1('SIGN', Math.sign, '=SIGN(-8) gives -1'),
  math1('SQRT', Math.sqrt, '=SQRT(49) gives 7', (x) => x >= 0),
  math1('EXP', Math.exp, '=EXP(0) gives 1'),
  math1('LN', Math.log, '=LN(1) gives 0', (x) => x > 0),
  math1('LOG10', Math.log10, '=LOG10(1000) gives 3', (x) => x > 0),
  math1('SIN', Math.sin, '=SIN(0) gives 0'),
  math1('COS', Math.cos, '=COS(0) gives 1'),
  math1('TAN', Math.tan, '=TAN(0) gives 0'),
  math1('ASIN', Math.asin, '=ASIN(0) gives 0', (x) => Math.abs(x) <= 1),
  math1('ACOS', Math.acos, '=ACOS(1) gives 0', (x) => Math.abs(x) <= 1),
  math1('ATAN', Math.atan, '=ATAN(0) gives 0'),
  math1('DEGREES', (x) => (x * 180) / Math.PI, '=DEGREES(PI()) gives 180'),
  math1('RADIANS', (x) => (x * Math.PI) / 180, '=RADIANS(180) gives 3.14159265358979'),
  scalar('PI', [], () => Math.PI, '=PI() gives 3.14159265358979'),
  scalar('POWER', [number(), number('power')], ([x, y]) => power(x, y), '=POWER(2, 10) gives 1024'),
  scalar(
    'MOD',
    [number(), number('divisor')],
    ([n, d]) => (d === 0 ? err('DIV0') : finish(n - d * Math.floor(n / d))),
    '=MOD(-7, 3) gives 2',
  ),
  scalar(
    'LOG',
    [number(), { name: 'base', kind: 'number', optional: true, default: 10 }],
    ([x, base = 10]) => (x > 0 && base > 0 && base !== 1 ? finish(Math.log(x) / Math.log(base)) : err('NUM')),
    '=LOG(8, 2) gives 3',
  ),
  roundWith('ROUND', 'half', '=ROUND(2.675, 2) gives 2.68'),
  roundWith('ROUNDUP', 'up', '=ROUNDUP(2.01, 1) gives 2.1'),
  roundWith('ROUNDDOWN', 'down', '=ROUNDDOWN(-2.09, 1) gives -2'),
];
