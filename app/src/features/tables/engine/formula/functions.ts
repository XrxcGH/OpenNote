// Formula functions: aggregates, math, and logic. Text and date functions live in textDate.ts. Angles are in
// radians, as in Excel and OneNote. ROUND rounds half away from zero.

import { err, finish, isError, isNumber, toBool, toNumbers, type FormulaError, type Value } from '../values';
import { DATE_TEXT_FUNCTIONS } from './textDate';

export interface Env {
  /** Today as a day number, read when a formula is calculated. */
  today: () => number;
}

export interface FnSpec {
  /** Aggregates take flat lists, so a column argument means every cell in it. */
  kind: 'scalar' | 'aggregate';
  min: number;
  /** Infinity for functions that take any number of arguments. */
  max: number;
  /** When set, an error argument reaches the function instead of becoming its result. */
  handlesErrors?: boolean;
  /** When set, arguments pass as they are and aren't coerced to numbers. */
  raw?: boolean;
  run: (args: Value[], env: Env) => Value;
}

function numbers(values: Value[]): number[] | FormulaError {
  const out: number[] = [];
  for (const v of values) {
    if (isError(v)) return v;
    if (isNumber(v)) out.push(v);
  }
  return out;
}

function aggregate(min: number, run: (nums: number[]) => Value): FnSpec {
  return {
    kind: 'aggregate',
    min,
    max: Infinity,
    run: (args) => {
      const nums = numbers(args);
      return Array.isArray(nums) ? run(nums) : nums;
    },
  };
}

function scalar(min: number, max: number, run: (n: number[]) => Value): FnSpec {
  return {
    kind: 'scalar',
    min,
    max,
    run: (args) => {
      const nums = toNumbers(args);
      return Array.isArray(nums) ? run(nums) : nums;
    },
  };
}

function math1(f: (x: number) => number, ok: (x: number) => boolean = () => true): FnSpec {
  return scalar(1, 1, ([x]) => (ok(x) ? finish(f(x)) : err('NUM')));
}

/** Shifts the decimal point with exponent text, so 1.005 rounds as a person expects. */
function shift(n: number, digits: number): number {
  const [mantissa, exponent] = n.toExponential().split('e');
  return Number(`${mantissa}e${Number(exponent) + digits}`);
}

function roundWith(mode: 'half' | 'up' | 'down'): FnSpec {
  return scalar(1, 2, ([x, d = 0]) => {
    const digits = Math.trunc(d);
    const abs = shift(Math.abs(x), digits);
    const whole = mode === 'half' ? Math.round(abs) : mode === 'up' ? Math.ceil(abs) : Math.floor(abs);
    return finish(Math.sign(x) * shift(whole, -digits));
  });
}

function power(x: number, y: number): Value {
  if (x === 0 && y < 0) return err('DIV0');
  return finish(x ** y);
}

function median(nums: number[]): Value {
  if (nums.length === 0) return err('NUM');
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : finish((sorted[mid - 1] + sorted[mid]) / 2);
}

function logic(combine: (bools: boolean[]) => boolean): FnSpec {
  return {
    kind: 'scalar',
    min: 1,
    max: Infinity,
    run: (args) => {
      const bools: boolean[] = [];
      for (const v of args) {
        const b = toBool(v);
        if (typeof b !== 'boolean') return b;
        bools.push(b);
      }
      return combine(bools);
    },
  };
}

const MATH_FUNCTIONS: Record<string, FnSpec> = {
  SUM: aggregate(1, (n) => finish(n.reduce((a, b) => a + b, 0))),
  AVERAGE: aggregate(1, (n) => (n.length ? finish(n.reduce((a, b) => a + b, 0) / n.length) : err('DIV0'))),
  MIN: aggregate(1, (n) => (n.length ? Math.min(...n) : 0)),
  MAX: aggregate(1, (n) => (n.length ? Math.max(...n) : 0)),
  COUNT: { kind: 'aggregate', min: 1, max: Infinity, run: (args) => args.filter(isNumber).length },
  COUNTA: {
    kind: 'aggregate',
    min: 1,
    max: Infinity,
    raw: true,
    run: (args) => args.filter((v) => v !== null && v !== '').length,
  },
  MEDIAN: aggregate(1, median),
  ABS: math1(Math.abs),
  INT: math1(Math.floor),
  SIGN: math1(Math.sign),
  SQRT: math1(Math.sqrt, (x) => x >= 0),
  EXP: math1(Math.exp),
  LN: math1(Math.log, (x) => x > 0),
  LOG10: math1(Math.log10, (x) => x > 0),
  SIN: math1(Math.sin),
  COS: math1(Math.cos),
  TAN: math1(Math.tan),
  ASIN: math1(Math.asin, (x) => Math.abs(x) <= 1),
  ACOS: math1(Math.acos, (x) => Math.abs(x) <= 1),
  ATAN: math1(Math.atan),
  DEGREES: math1((x) => (x * 180) / Math.PI),
  RADIANS: math1((x) => (x * Math.PI) / 180),
  PI: scalar(0, 0, () => Math.PI),
  POWER: scalar(2, 2, ([x, y]) => power(x, y)),
  MOD: scalar(2, 2, ([n, d]) => (d === 0 ? err('DIV0') : finish(n - d * Math.floor(n / d)))),
  LOG: scalar(1, 2, ([x, base = 10]) =>
    x > 0 && base > 0 && base !== 1 ? finish(Math.log(x) / Math.log(base)) : err('NUM'),
  ),
  ROUND: roundWith('half'),
  ROUNDUP: roundWith('up'),
  ROUNDDOWN: roundWith('down'),
  AND: logic((b) => b.every(Boolean)),
  OR: logic((b) => b.some(Boolean)),
  NOT: {
    kind: 'scalar',
    min: 1,
    max: 1,
    run: ([v]) => {
      const b = toBool(v);
      return typeof b === 'boolean' ? !b : b;
    },
  },
  ISBLANK: { kind: 'scalar', min: 1, max: 1, handlesErrors: true, run: ([v]) => v === null },
};

/** Every function by uppercase name. IF and IFERROR are special forms, handled where formulas are compiled. */
export const FUNCTIONS: Record<string, FnSpec> = { ...MATH_FUNCTIONS, ...DATE_TEXT_FUNCTIONS };

export const SPECIAL_FORMS: Record<string, { min: number; max: number }> = {
  IF: { min: 2, max: 3 },
  IFERROR: { min: 2, max: 2 },
};
