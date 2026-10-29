// Number helpers shared by every evaluator. Where a helper has no answer it throws an ExprError without a place, and
// the evaluator adds the place. A host that wants NaN instead of an error wraps the helper (see functions.ts).

import { ExprError, type ExprErrorCode } from './errors';

export function fail(code: ExprErrorCode): never {
  throw new ExprError(code);
}

/**
 * Rounds to 15 significant digits, so 0.1 + 0.2 is 0.3 and asin(0.5) in degrees is 30. A double holds about 16
 * digits, so this removes only the noise in the last place.
 */
export function snap(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return value === 0 ? 0 : value;
  // A whole number below 1e15 has at most 15 digits already, and skipping the text round trip is much faster.
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return value;
  return Number(value.toPrecision(15));
}

/** The remainder with the sign of the divisor, so modulo(-1, 3) is 2. */
export function modulo(a: number, b: number): number {
  if (b === 0) fail('divide-by-zero');
  const remainder = a % b;
  return remainder !== 0 && remainder < 0 !== b < 0 ? remainder + b : remainder;
}

function wholeCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) fail('domain');
  return value;
}

/** n! for whole numbers up to 170, the most a double holds. */
export function factorial(n: number): number {
  if (wholeCount(n) > 170) fail('overflow');
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

/** The number of ordered ways to pick r of n. */
export function permutations(n: number, r: number): number {
  if (wholeCount(r) > wholeCount(n)) fail('domain');
  let result = 1;
  for (let i = 0; i < r; i += 1) {
    result *= n - i;
    if (!Number.isFinite(result)) fail('overflow');
  }
  return result;
}

/** The number of ways to pick r of n, in any order. */
export function combinations(n: number, r: number): number {
  if (wholeCount(r) > wholeCount(n)) fail('domain');
  const k = Math.min(r, n - r);
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
    if (!Number.isFinite(result)) fail('overflow');
  }
  return result < Number.MAX_SAFE_INTEGER ? Math.round(result) : result;
}

/** The nth root. An odd root of a negative number is negative. */
export function root(x: number, n: number): number {
  if (n === 0) fail('divide-by-zero');
  if (x < 0 && Number.isInteger(n) && Math.abs(n % 2) === 1) return -Math.pow(-x, 1 / n);
  return x < 0 ? fail('domain') : Math.pow(x, 1 / n);
}

/** Rounds half away from zero to a number of decimal places, so round(2.5) is 3 and round(-2.5) is -3. */
export function roundTo(x: number, places: number): number {
  if (!Number.isInteger(places) || places < 0 || places > 15) fail('domain');
  const scale = 10 ** places;
  return (Math.sign(x) * Math.round(snap(Math.abs(x) * scale))) / scale;
}

/** The logarithm of x to a base. Bases 10 and 2 are exact for their powers, so log(1000, 10) is 3. */
export function logBase(x: number, base: number): number {
  if (x <= 0 || base <= 0 || base === 1) fail('domain');
  if (base === 10) return Math.log10(x);
  if (base === 2) return Math.log2(x);
  return Math.log(x) / Math.log(base);
}

/**
 * The remainder for a calculator. Both sides are rounded to 15 digits first, and a quotient that is whole to 15
 * digits leaves nothing, so 0.3 mod 0.1 is 0, where the doubles would give 0.1 (and -0.3 mod 0.1 would give 3e-17).
 */
export function snappedModulo(a: number, b: number): number {
  const x = snap(a);
  const y = snap(b);
  if (y === 0) fail('divide-by-zero');
  if (Number.isInteger(x) && Number.isInteger(y)) return modulo(x, y);
  return Number.isInteger(snap(x / y)) ? 0 : snap(modulo(x, y));
}

/**
 * For a calculator, a step that jumps (floor, a factorial, a count of choices) reads its input rounded to 15 digits,
 * so binary noise such as 0.3/0.1 = 2.9999999999999996 lands on the side of the jump that the decimals mean.
 */
export function snapped(f: (x: number) => number): (x: number) => number {
  return (x) => f(snap(x));
}

/** `snapped` for a step that takes two numbers. */
export function snapped2(f: (x: number, y: number) => number): (x: number, y: number) => number {
  return (x, y) => f(snap(x), snap(y));
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** The gamma function, which extends the factorial: gamma(n + 1) = n!. NaN at 0 and the negative whole numbers. */
export function gamma(z: number): number {
  if (Number.isInteger(z) && z <= 0) return NaN;
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const x = z - 1;
  let sum = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i += 1) sum += LANCZOS[i] / (x + i + 1);
  const t = x + LANCZOS.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * sum;
}

/** n! for whole numbers (Infinity above 170) and gamma(n + 1) for the rest. Never throws. */
export function factorialExtended(n: number): number {
  if (Number.isInteger(n) && n >= 0) {
    if (n > 170) return Infinity;
    let product = 1;
    for (let i = 2; i <= n; i += 1) product *= i;
    return product;
  }
  return gamma(n + 1);
}

/** The odd denominator q (up to 99) when `exponent` is a whole number of q-th parts, such as 1/3 or 2/5, else 0. */
function oddDenominator(exponent: number): number {
  for (let q = 3; q < 100; q += 2) {
    const scaled = exponent * q;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * q) return q;
  }
  return 0;
}

/** Power with real results for odd roots of negative numbers, so (-8)^(1/3) is -2, as a graphing calculator shows. */
export function realPower(base: number, exponent: number): number {
  if (base >= 0 || Number.isInteger(exponent) || !Number.isFinite(exponent)) return Math.pow(base, exponent);
  const q = oddDenominator(exponent);
  if (q === 0) return NaN;
  const numerator = Math.round(exponent * q);
  const magnitude = Math.pow(-base, exponent);
  return Math.abs(numerator) % 2 === 1 ? -magnitude : magnitude;
}

/** The remainder with the sign of the divisor, NaN for a zero divisor. */
export function moduloOrNaN(a: number, b: number): number {
  return b === 0 ? NaN : a - b * Math.floor(a / b);
}
