// Decimal digits of a number, rounded the way spreadsheets show them: first to 15 significant digits, then half away
// from zero on the decimal digits, so 1.005 with two decimals shows 1.01 and 2.675 shows 2.68.

export interface Digits {
  /** The significant digits, without leading zeros ("0" for zero). */
  d: string;
  /** Where the decimal point goes: the value is 0.d × 10^p. */
  p: number;
}

/** The 15 significant digits of a value's magnitude. */
export function toDigits(value: number): Digits {
  const abs = Math.abs(value);
  if (abs === 0 || !Number.isFinite(abs)) return { d: '0', p: 1 };
  const text = abs.toPrecision(15);
  const [mantissa, exp] = text.split('e');
  const dot = mantissa.indexOf('.');
  let d = mantissa.replace('.', '');
  let p = (dot < 0 ? mantissa.length : dot) + (exp ? Number(exp) : 0);
  while (d.length > 1 && d[0] === '0') {
    d = d.slice(1);
    p--;
  }
  d = d.replace(/0+$/, '') || '0';
  return { d, p };
}

/** The digits of a whole number, without the exponent form String gives from 1e21: 15 digits, then zeros. */
export function intText(n: number): string {
  return Math.abs(n) < 1e15 ? String(n) : fixedDigits(toDigits(n), 0).int;
}

/** Adds one to a string of digits, which may grow by one digit. */
function increment(digits: string): string {
  const chars = digits.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] === '9') chars[i] = '0';
    else {
      chars[i] = String(Number(chars[i]) + 1);
      return chars.join('');
    }
  }
  return `1${chars.join('')}`;
}

/** The value rounded to `decimals` digits after the point: the integer digits ("" for none) and the decimals. */
export function fixedDigits(digits: Digits, decimals: number): { int: string; frac: string } {
  const { d } = digits;
  let p = digits.p;
  // Digit i of d stands for 10^(p-1-i); `count` digits reach down to 10^-decimals.
  const count = p + decimals;
  let kept: string;
  if (d === '0' || count < 0 || (count === 0 && d[0] < '5')) return { int: '', frac: '0'.repeat(decimals) };
  if (count === 0) {
    kept = '1';
    p = 1 - decimals;
  } else if (count >= d.length) kept = d + '0'.repeat(count - d.length);
  else {
    kept = d.slice(0, count);
    if (d[count] >= '5') {
      const bumped = increment(kept);
      if (bumped.length > kept.length) p++;
      kept = bumped;
    }
  }
  if (p <= 0) return { int: '', frac: ('0'.repeat(-p) + kept).slice(0, decimals).padEnd(decimals, '0') };
  return { int: kept.slice(0, p).replace(/^0+/, ''), frac: kept.slice(p, p + decimals).padEnd(decimals, '0') };
}

/** Groups integer digits: "1234567" to "1,234,567" with sizes [3] or "12,34,567" with [3, 2]. */
export function groupDigits(int: string, separator: string, sizes: readonly number[]): string {
  const [first, rest = first] = sizes;
  if (int.length <= first) return int;
  let out = int.slice(-first);
  let i = int.length - first;
  while (i > 0) {
    const start = Math.max(0, i - rest);
    out = `${int.slice(start, i)}${separator}${out}`;
    i = start;
  }
  return out;
}

/** The closest fraction to x (0 <= x < 1) with a denominator up to maxDen; ties go to the smaller denominator. */
export function bestFraction(x: number, maxDen: number): [number, number] {
  if (x <= 0) return [0, 1];
  let p0 = 0;
  let q0 = 1;
  let p1 = 1;
  let q1 = 0;
  let r = x;
  for (let guard = 0; guard < 64; guard++) {
    const a = Math.floor(r);
    const q2 = q0 + a * q1;
    if (q2 > maxDen) break;
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    const rest = r - a;
    if (rest < 1e-12 || Math.abs(p1 / q1 - x) < 1e-15) return [p1, q1];
    r = 1 / rest;
  }
  const k = Math.floor((maxDen - q0) / q1);
  const b1: [number, number] = [p0 + k * p1, q0 + k * q1];
  const b2: [number, number] = [p1, q1];
  return Math.abs(b2[0] / b2[1] - x) <= Math.abs(b1[0] / b1[1] - x) ? b2 : b1;
}

/** Rounds half away from zero, through the 15-digit form, to an integer. */
export function roundHalfAway(value: number): number {
  const { int } = fixedDigits(toDigits(value), 0);
  const n = Number(int || '0');
  return value < 0 ? -n : n;
}
