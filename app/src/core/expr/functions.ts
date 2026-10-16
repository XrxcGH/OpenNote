// The standard functions, in two profiles that share one definition of each function.
//
//   'strict' is a calculator. Trigonometry takes an angle in the current mode and is exact at familiar angles.
//   A function outside its domain throws a 'domain' error. Factorial wants a whole number.
//   'plain' is a grapher. Angles are radians. A function outside its domain gives NaN or Infinity.
//   Factorial reaches fractions through the gamma function.
//
// A dialect picks which names it offers and what they are called. The table has canonical names only.

import { ExprError } from './errors';
import {
  combinations,
  fail,
  factorial,
  factorialExtended,
  gamma,
  logBase,
  moduloOrNaN,
  permutations,
  realPower,
  root,
  roundTo,
  snap,
  snapped,
  snapped2,
  snappedModulo,
} from './numeric';
import { cos, fromRadians, sin, tan, type AngleMode } from './trig';

export interface FnDef {
  readonly name: string;
  /** The fewest and most arguments. */
  readonly min: number;
  readonly max: number;
  /** The function that `name^-1` means: asin for sin, and sin for asin. */
  readonly inverse?: string;
  run(args: readonly number[], angle: AngleMode): number;
  /** Faster forms for one and two arguments, which skip building an array. */
  run1?(x: number, angle: AngleMode): number;
  run2?(x: number, y: number, angle: AngleMode): number;
}

export type FunctionTable = Readonly<Record<string, FnDef>>;
export type FunctionProfile = 'strict' | 'plain';

type Mode1 = (x: number, mode: AngleMode) => number;

function unary(name: string, f: Mode1, inverse?: string): FnDef {
  const base: FnDef = { name, min: 1, max: 1, run: ([x], mode) => f(x, mode), run1: f };
  return inverse === undefined ? base : { ...base, inverse };
}

function binary(name: string, f: (x: number, y: number, mode: AngleMode) => number): FnDef {
  return { name, min: 2, max: 2, run: ([x, y], mode) => f(x, y, mode), run2: f };
}

// A one-argument function is used as it is, so a hot loop calls Math.sin and not a wrapper around it. The angle mode
// goes along as a second argument that these functions ignore.
const one = (name: string, f: (x: number) => number, inverse?: string): FnDef => unary(name, f, inverse);
const two = (name: string, f: (x: number, y: number) => number): FnDef => binary(name, f);
const many = (name: string, f: (...values: number[]) => number): FnDef => ({
  name,
  min: 1,
  max: 99,
  run: (args) => f(...args),
});
const optional = (name: string, run: (x: number, y: number | undefined) => number): FnDef => ({
  name,
  min: 1,
  max: 2,
  run: ([x, y]) => run(x, y),
  run1: (x) => run(x, undefined),
  run2: (x, y) => run(x, y),
});

/** A helper that fails with an ExprError becomes one that answers NaN, or Infinity on overflow. */
function quiet<A extends number[]>(f: (...args: A) => number): (...args: A) => number {
  return (...args) => {
    try {
      return f(...args);
    } catch (error) {
      if (!(error instanceof ExprError)) throw error;
      return error.code === 'overflow' ? Infinity : NaN;
    }
  };
}

const positive = (x: number): number => (x > 0 ? x : fail('domain'));

function trigFunctions(strict: boolean): FnDef[] {
  const turn = (strictForm: Mode1, plainForm: (x: number) => number): Mode1 =>
    strict ? strictForm : (x) => plainForm(x);
  const reciprocal = (strictForm: Mode1, plainForm: (x: number) => number): Mode1 =>
    strict
      ? (x, mode) => {
          const value = strictForm(x, mode);
          return value === 0 ? fail('domain') : 1 / value;
        }
      : (x) => 1 / plainForm(x);
  const inverseOf = (f: (x: number) => number): Mode1 => (strict ? (x, mode) => fromRadians(f(x), mode) : (x) => f(x));
  return [
    unary('sin', turn(sin, Math.sin), 'asin'),
    unary('cos', turn(cos, Math.cos), 'acos'),
    unary('tan', turn(tan, Math.tan), 'atan'),
    unary('sec', reciprocal(cos, Math.cos)),
    unary('csc', reciprocal(sin, Math.sin)),
    unary('cot', reciprocal(tan, Math.tan)),
    unary('asin', inverseOf(Math.asin), 'sin'),
    unary('acos', inverseOf(Math.acos), 'cos'),
    unary('atan', inverseOf(Math.atan), 'tan'),
    binary('atan2', (y, x, mode) => (strict ? fromRadians(Math.atan2(y, x), mode) : Math.atan2(y, x))),
    one('sinh', Math.sinh, 'asinh'),
    one('cosh', Math.cosh, 'acosh'),
    one('tanh', Math.tanh, 'atanh'),
    one('asinh', Math.asinh, 'sinh'),
    one('acosh', Math.acosh, 'cosh'),
    one('atanh', (x) => (strict && !(Math.abs(x) < 1) ? fail('domain') : Math.atanh(x)), 'tanh'),
  ];
}

function logFunctions(strict: boolean): FnDef[] {
  const guard = strict ? positive : (x: number) => x;
  return [
    one('exp', Math.exp),
    one('ln', (x) => Math.log(guard(x))),
    optional('log', (x, base) => {
      if (strict) return base === undefined ? Math.log10(positive(x)) : logBase(x, base);
      return base === undefined || base === 10 ? Math.log10(x) : Math.log(x) / Math.log(base);
    }),
    one('log2', (x) => Math.log2(guard(x))),
    one('log10', (x) => Math.log10(guard(x))),
  ];
}

function roundingFunctions(strict: boolean): FnDef[] {
  // The strict steps read their input rounded to 15 digits, so floor(0.3/0.1) is 3. The grapher's stay raw and fast.
  const jump = strict ? snapped : (f: (x: number) => number) => f;
  const toPlaces = strict ? (x: number, places: number) => roundTo(snap(x), places) : quiet(roundTo);
  return [
    one('abs', Math.abs),
    one('sign', Math.sign),
    one('floor', jump(Math.floor)),
    one('ceil', jump(Math.ceil)),
    one('trunc', jump(Math.trunc)),
    optional('round', (x, places) => {
      if (places !== undefined || strict) return toPlaces(x, places ?? 0);
      return Math.sign(x) * Math.round(Math.abs(x));
    }),
  ];
}

function countingFunctions(strict: boolean): FnDef[] {
  const fact = strict ? snapped(factorial) : factorialExtended;
  return [
    one('factorial', fact),
    one('fact', fact),
    two('npr', strict ? snapped2(permutations) : quiet(permutations)),
    two('ncr', strict ? snapped2(combinations) : quiet(combinations)),
    one('gamma', gamma),
  ];
}

function algebraFunctions(strict: boolean): FnDef[] {
  const power = strict
    ? (x: number, y: number) => (x === 0 && y < 0 ? fail('divide-by-zero') : Math.pow(x, y))
    : realPower;
  return [
    one('sqrt', Math.sqrt),
    one('cbrt', Math.cbrt),
    two('root', strict ? root : quiet(root)),
    two('pow', power),
    two('mod', strict ? snappedModulo : moduloOrNaN),
    many('min', Math.min),
    many('max', Math.max),
    many('hypot', Math.hypot),
    one('deg', (x) => (x * 180) / Math.PI),
    one('rad', (x) => (x * Math.PI) / 180),
  ];
}

const cache = new Map<FunctionProfile, FunctionTable>();

/** The standard functions in a profile, by canonical name. Built once and shared. */
export function standardFunctions(profile: FunctionProfile): FunctionTable {
  let table = cache.get(profile);
  if (table === undefined) {
    const strict = profile === 'strict';
    const all = [
      ...trigFunctions(strict),
      ...logFunctions(strict),
      ...roundingFunctions(strict),
      ...countingFunctions(strict),
      ...algebraFunctions(strict),
    ];
    table = Object.freeze(Object.fromEntries(all.map((f) => [f.name, f])));
    cache.set(profile, table);
  }
  return table;
}

/** The function with this canonical name, or undefined. Names such as "constructor" are not functions. */
export function findFunction(table: FunctionTable, name: string): FnDef | undefined {
  return Object.hasOwn(table, name) ? table[name] : undefined;
}
