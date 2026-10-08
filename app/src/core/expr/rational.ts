// Exact fractions on big integers. A decimal such as 0.1 is exactly 1/10 here, so 0.1 + 0.2 is exactly 3/10 with no
// rounding. A fraction is always in lowest terms with a positive denominator. Operations that would grow past
// MAX_BITS fail with an 'overflow' error instead of using all the memory.

import { ExprError } from './errors';

export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

/** The most bits a numerator or denominator may have. */
export const MAX_BITS = 20_000;

const ZERO: Rational = { n: 0n, d: 1n };
const ONE: Rational = { n: 1n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function bits(n: bigint): number {
  return (n < 0n ? -n : n).toString(2).length;
}

/** The fraction n/d in lowest terms. Throws 'divide-by-zero' for a zero denominator and 'overflow' for a huge one. */
export function rational(n: bigint, d: bigint = 1n): Rational {
  if (d === 0n) throw new ExprError('divide-by-zero');
  const sign = d < 0n ? -1n : 1n;
  const divisor = gcd(n, d);
  const result = { n: (sign * n) / divisor, d: (sign * d) / divisor };
  if (bits(result.n) > MAX_BITS || bits(result.d) > MAX_BITS) throw new ExprError('overflow');
  return result;
}

export const ZERO_RATIONAL = ZERO;
export const ONE_RATIONAL = ONE;

/** Reads number text such as "12", "1.5", ".5", "1.", "2e3", or "1.5e-3" exactly. Returns null for anything else. */
export function fromDecimalText(text: string): Rational | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return null;
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0) - fraction.length;
  if (Math.abs(exponent) > MAX_BITS / 4) throw new ExprError('overflow');
  const digits = BigInt(`${match[2]}${fraction}` || '0') * (match[1] === '-' ? -1n : 1n);
  return exponent >= 0 ? rational(digits * 10n ** BigInt(exponent)) : rational(digits, 10n ** BigInt(-exponent));
}

/** The decimal a person means by a number: 0.1 is 1/10 and not the nearest double. Null for NaN and Infinity. */
export function fromNumber(value: number): Rational | null {
  return Number.isFinite(value) ? fromDecimalText(String(value)) : null;
}

export function add(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}

export function div(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d, a.d * b.n);
}

export function neg(a: Rational): Rational {
  return { n: -a.n, d: a.d };
}

export function abs(a: Rational): Rational {
  return a.n < 0n ? neg(a) : a;
}

export function sign(a: Rational): number {
  return a.n < 0n ? -1 : a.n > 0n ? 1 : 0;
}

/** Negative, zero, or positive, as a - b would be. */
export function compare(a: Rational, b: Rational): number {
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function isInteger(a: Rational): boolean {
  return a.d === 1n;
}

export function floor(a: Rational): Rational {
  const q = a.n / a.d;
  return rational(a.n < 0n && a.n % a.d !== 0n ? q - 1n : q);
}

export function ceil(a: Rational): Rational {
  return neg(floor(neg(a)));
}

export function trunc(a: Rational): Rational {
  return rational(a.n / a.d);
}

/** Rounds half away from zero to a whole number. */
export function round(a: Rational): Rational {
  const half = rational(1n, 2n);
  return a.n < 0n ? neg(floor(add(neg(a), half))) : floor(add(a, half));
}

/** The remainder with the sign of the divisor, so mod(-1, 3) is 2. */
export function mod(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new ExprError('divide-by-zero');
  return sub(a, mul(b, floor(div(a, b))));
}

/** a to a whole-number power. A negative power takes the reciprocal. */
export function powInt(a: Rational, exponent: bigint): Rational {
  if (exponent === 0n) return ONE;
  if (a.n === 0n) {
    if (exponent < 0n) throw new ExprError('divide-by-zero');
    return ZERO;
  }
  const magnitude = exponent < 0n ? -exponent : exponent;
  if (magnitude > 100_000n || (bits(a.n) + bits(a.d)) * Number(magnitude) > MAX_BITS * 2) {
    if (a.n === 1n && a.d === 1n) return ONE;
    if (a.n === -1n && a.d === 1n) return magnitude % 2n === 0n ? ONE : a;
    throw new ExprError('overflow');
  }
  const power = rational(a.n ** magnitude, a.d ** magnitude);
  return exponent < 0n ? rational(power.d, power.n) : power;
}

/** The integer k-th root of a non-negative integer when it is exact, else null. */
function exactRoot(value: bigint, k: number): bigint | null {
  if (value < 2n) return value;
  let low = 1n;
  let high = 1n << BigInt(Math.ceil(bits(value) / k) + 1);
  while (low <= high) {
    const mid = (low + high) >> 1n;
    const power = mid ** BigInt(k);
    if (power === value) return mid;
    if (power < value) low = mid + 1n;
    else high = mid - 1n;
  }
  return null;
}

/** The k-th root of a non-negative fraction when it is exact, else null. */
export function rootExact(a: Rational, k: number): Rational | null {
  if (a.n < 0n || k < 1 || !Number.isInteger(k)) return null;
  const n = exactRoot(a.n, k);
  const d = exactRoot(a.d, k);
  return n === null || d === null ? null : rational(n, d);
}

/** n! as an exact integer. Fails with 'domain' for a negative or fractional n and 'overflow' above 3000. */
export function factorialExact(a: Rational): Rational {
  if (!isInteger(a) || a.n < 0n) throw new ExprError('domain');
  if (a.n > 3000n) throw new ExprError('overflow');
  let result = 1n;
  for (let i = 2n; i <= a.n; i += 1n) result *= i;
  return rational(result);
}

/** The nearest double. Large fractions are scaled first, so a ratio of two huge integers still converts. */
export function toNumber(a: Rational): number {
  const nBits = bits(a.n);
  const dBits = bits(a.d);
  if (nBits < 1000 && dBits < 1000) return Number(a.n) / Number(a.d);
  const shift = Math.max(nBits, dBits) - 900;
  const scaled = shift > 0 ? [a.n >> BigInt(shift), a.d >> BigInt(shift)] : [a.n, a.d];
  if (scaled[1] === 0n) return a.n < 0n ? -Infinity : Infinity;
  return Number(scaled[0]) / Number(scaled[1]);
}

/** "3/10" for a fraction, "5" for a whole number. */
export function formatFraction(a: Rational): string {
  return a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
}

export interface DecimalText {
  text: string;
  /** True when the text is the exact value, because the decimal ends or its repeating part is marked. */
  exact: boolean;
}

/**
 * The fraction as a decimal. A decimal that ends, such as 3/10, is written out. One that repeats is written with the
 * repeating digits in brackets, so 1/3 is 0.(3) and 1/7 is 0.(142857). A repeat that does not show within
 * `maxDigits` digits is cut off and marked not exact.
 */
export function formatDecimal(a: Rational, maxDigits = 30): DecimalText {
  const negative = a.n < 0n;
  const top = negative ? -a.n : a.n;
  const whole = top / a.d;
  let remainder = top % a.d;
  const sign = negative ? '-' : '';
  if (remainder === 0n) return { text: `${sign}${whole}`, exact: true };
  const digits: string[] = [];
  const seen = new Map<bigint, number>();
  while (remainder !== 0n && digits.length < maxDigits) {
    const at = seen.get(remainder);
    if (at !== undefined) {
      const lead = digits.slice(0, at).join('');
      return { text: `${sign}${whole}.${lead}(${digits.slice(at).join('')})`, exact: true };
    }
    seen.set(remainder, digits.length);
    remainder *= 10n;
    digits.push(String(remainder / a.d));
    remainder %= a.d;
  }
  return { text: `${sign}${whole}.${digits.join('')}`, exact: remainder === 0n };
}
