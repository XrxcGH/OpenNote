// Math and trigonometry functions. Owner: tables:fn-math. Angles are in radians, as in Excel. ROUND rounds half away
// from zero. The family is split over files to stay readable: this one holds the basics and the trigonometry,
// mathRound.ts the rounding, mathInt.ts the whole-number functions, mathSum.ts the sums, mathAgg.ts SUBTOTAL and
// AGGREGATE. Written from the documented behavior of each function.

import { err, finish, type Value } from '../../values';
import type { FnSpec2 } from './types';
import { functions as aggregates } from './mathAgg';
import { functions as integers } from './mathInt';
import { math1, math1d, number, optional, scalar } from './mathKit';
import { functions as rounding } from './mathRound';
import { functions as sums } from './mathSum';

function power(x: number, y: number): Value {
  if (x === 0 && y < 0) return err('DIV0');
  // Excel calls zero to the power of zero undefined, so it is a number error here too.
  if (x === 0 && y === 0) return err('NUM');
  return finish(x ** y);
}

/** SIN, COS, and TAN refuse an angle of 2^27 radians or more, where the result would have no meaning. */
const inAngleRange = (x: number) => Math.abs(x) < 2 ** 27;
const isZero = (x: number) => x === 0;
const acoth = (x: number) => 0.5 * Math.log((x + 1) / (x - 1));

const basics: readonly FnSpec2[] = [
  math1('ABS', Math.abs, '=ABS(-3) gives 3'),
  math1('INT', Math.floor, '=INT(-8.9) gives -9'),
  math1('SIGN', Math.sign, '=SIGN(-8) gives -1'),
  math1('SQRT', Math.sqrt, '=SQRT(49) gives 7', (x) => x >= 0),
  math1(
    'SQRTPI',
    (x) => Math.sqrt(x * Math.PI),
    '=SQRTPI(1) gives 1.77245385090552',
    (x) => x >= 0,
  ),
  math1('EXP', Math.exp, '=EXP(0) gives 1'),
  math1('LN', Math.log, '=LN(1) gives 0', (x) => x > 0),
  math1('LOG10', Math.log10, '=LOG10(1000) gives 3', (x) => x > 0),
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
    [number(), optional('base', 10)],
    ([x, base = 10]) => (x > 0 && base > 0 && base !== 1 ? finish(Math.log(x) / Math.log(base)) : err('NUM')),
    '=LOG(8, 2) gives 3',
  ),
  {
    name: 'RAND',
    family: 'math',
    params: [],
    volatile: true,
    run: () => Math.random(),
    meta: { signature: 'RAND()', example: '=RAND() gives a number from 0 up to, but not including, 1' },
  },
  {
    ...scalar(
      'RANDBETWEEN',
      [number('bottom'), number('top')],
      ([a, b]) => {
        const low = Math.ceil(a);
        const high = Math.floor(b);
        return low <= high ? low + Math.floor(Math.random() * (high - low + 1)) : err('NUM');
      },
      '=RANDBETWEEN(1, 6) gives a whole number from 1 to 6',
    ),
    volatile: true,
  },
];

const trig: readonly FnSpec2[] = [
  math1('SIN', Math.sin, '=SIN(0) gives 0', inAngleRange),
  math1('COS', Math.cos, '=COS(0) gives 1', inAngleRange),
  math1('TAN', Math.tan, '=TAN(0) gives 0', inAngleRange),
  math1('ASIN', Math.asin, '=ASIN(0) gives 0', (x) => Math.abs(x) <= 1),
  math1('ACOS', Math.acos, '=ACOS(1) gives 0', (x) => Math.abs(x) <= 1),
  math1('ATAN', Math.atan, '=ATAN(0) gives 0'),
  scalar(
    'ATAN2',
    [number('x'), number('y')],
    ([x, y]) => (x === 0 && y === 0 ? err('DIV0') : finish(Math.atan2(y, x))),
    '=ATAN2(1, 1) gives 0.785398163397448',
  ),
  math1('SINH', Math.sinh, '=SINH(0) gives 0'),
  math1('COSH', Math.cosh, '=COSH(0) gives 1'),
  math1('TANH', Math.tanh, '=TANH(0) gives 0'),
  math1('ASINH', Math.asinh, '=ASINH(0) gives 0'),
  math1('ACOSH', Math.acosh, '=ACOSH(1) gives 0', (x) => x >= 1),
  math1('ATANH', Math.atanh, '=ATANH(0) gives 0', (x) => Math.abs(x) < 1),
  // The inverse cotangent runs from 0 to pi, so ACOT(0) is a quarter turn and a negative number is past it.
  math1(
    'ACOT',
    (x) => (x === 0 ? Math.PI / 2 : x > 0 ? Math.atan(1 / x) : Math.PI + Math.atan(1 / x)),
    '=ACOT(1) gives 0.785398163397448',
  ),
  math1('ACOTH', acoth, '=ACOTH(2) gives 0.549306144334055', (x) => Math.abs(x) > 1),
  math1d('COT', (x) => 1 / Math.tan(x), '=COT(1) gives 0.642092615934331', isZero),
  math1d('COTH', (x) => 1 / Math.tanh(x), '=COTH(1) gives 1.31303528549933', isZero),
  math1d('CSC', (x) => 1 / Math.sin(x), '=CSC(1) gives 1.18839510577812', isZero),
  math1d('CSCH', (x) => 1 / Math.sinh(x), '=CSCH(1) gives 0.850918128239322', isZero),
  math1('SEC', (x) => 1 / Math.cos(x), '=SEC(0) gives 1'),
  math1('SECH', (x) => 1 / Math.cosh(x), '=SECH(0) gives 1'),
  math1('DEGREES', (x) => (x * 180) / Math.PI, '=DEGREES(PI()) gives 180'),
  math1('RADIANS', (x) => (x * Math.PI) / 180, '=RADIANS(180) gives 3.14159265358979'),
];

export const functions: readonly FnSpec2[] = [...basics, ...trig, ...rounding, ...integers, ...sums, ...aggregates];
