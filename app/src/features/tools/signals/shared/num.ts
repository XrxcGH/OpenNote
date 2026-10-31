// Numbers the signals tools share: complex arithmetic, reading lists of numbers typed or pasted, a seeded random
// source, and formatting for results. Pure: no DOM, no React, no strings shown to a person.
import { SignalError } from './errors';

export interface Complex {
  readonly re: number;
  readonly im: number;
}

export const cx = (re: number, im = 0): Complex => ({ re, im });
export const cadd = (a: Complex, b: Complex): Complex => cx(a.re + b.re, a.im + b.im);
export const csub = (a: Complex, b: Complex): Complex => cx(a.re - b.re, a.im - b.im);
export const cmul = (a: Complex, b: Complex): Complex => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cscale = (a: Complex, k: number): Complex => cx(a.re * k, a.im * k);
export const cabs = (a: Complex): number => Math.hypot(a.re, a.im);
export const carg = (a: Complex): number => Math.atan2(a.im, a.re);
export const cconj = (a: Complex): Complex => cx(a.re, -a.im);
export const cpolar = (r: number, theta: number): Complex => cx(r * Math.cos(theta), r * Math.sin(theta));
export const cexp = (a: Complex): Complex => cpolar(Math.exp(a.re), a.im);

export function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) throw new SignalError('divideByZero');
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

export function csqrt(a: Complex): Complex {
  const r = cabs(a);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  return cx(re, a.im < 0 ? -im : im);
}

/** The value of a polynomial with real coefficients (highest power first) at a complex point. */
export function polyAt(coefficients: readonly number[], z: Complex): Complex {
  let out = cx(0);
  for (const c of coefficients) out = cadd(cmul(out, z), cx(c));
  return out;
}

/** The product of (z - root) over the roots, as real coefficients, highest power first. */
export function polyFromRoots(roots: readonly Complex[]): number[] {
  let poly: Complex[] = [cx(1)];
  for (const root of roots) {
    const next: Complex[] = poly.map((c) => c).concat([cx(0)]);
    for (let i = 1; i < next.length; i += 1) next[i] = csub(next[i]!, cmul(root, poly[i - 1]!));
    poly = next;
  }
  return poly.map((c) => c.re);
}

/** The roots of a real polynomial (highest power first) by the Durand-Kerner iteration. */
export function polyRoots(coefficients: readonly number[]): Complex[] {
  let first = 0;
  while (first < coefficients.length && coefficients[first] === 0) first += 1;
  const p = coefficients.slice(first);
  let trailingZeros = 0;
  while (p.length > 1 && p[p.length - 1] === 0) {
    p.pop();
    trailingZeros += 1;
  }
  const n = p.length - 1;
  const zeros = Array.from({ length: trailingZeros }, () => cx(0));
  if (n < 1) return zeros;
  const monic = p.map((c) => c / p[0]!);
  const radius = 1 + Math.max(...monic.slice(1).map(Math.abs));
  let roots = Array.from({ length: n }, (_, k) => cpolar(radius * 0.9, (2 * Math.PI * k) / n + 0.4));
  for (let iteration = 0; iteration < 500; iteration += 1) {
    let moved = 0;
    roots = roots.map((root, i) => {
      let denominator = cx(1);
      roots.forEach((other, j) => {
        if (j !== i) denominator = cmul(denominator, csub(root, other));
      });
      const step = cdiv(polyAt(monic, root), cabs(denominator) === 0 ? cx(1e-12) : denominator);
      moved = Math.max(moved, cabs(step));
      return csub(root, step);
    });
    if (moved < 1e-14) break;
  }
  return [...roots.map((r) => cx(r.re, Math.abs(r.im) < 1e-10 ? 0 : r.im)), ...zeros];
}

/**
 * The numbers in typed or pasted text: separated by commas, semicolons, spaces, tabs, or new lines. Each piece must be
 * a plain decimal number (with an optional exponent); anything else is an error that names the piece.
 */
export function readNumbers(text: string): number[] {
  const out: number[] = [];
  for (const piece of text.split(/[\s,;]+/)) {
    if (piece === '') continue;
    const value = Number(piece);
    if (!Number.isFinite(value) || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(piece)) {
      throw new SignalError('notNumber', { text: piece.slice(0, 24) });
    }
    out.push(value);
  }
  return out;
}

/** Rows of numbers, one row per line, for tables of two or more columns. */
export function readRows(text: string): number[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^[A-Za-z#]/.test(line))
    .map(readNumbers);
}

/** A seeded random source (mulberry32): the same seed gives the same numbers on any device. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal numbers from a seeded uniform source (Box-Muller). */
export function gaussian(random: () => number): () => number {
  return () => {
    const u = Math.max(random(), 1e-300);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
}

/** A number for reading: up to `digits` significant figures, no trailing zeros, exponent form when very large or small. */
export function fmt(value: number, digits = 6): string {
  if (Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  const text =
    magnitude >= 1e6 || magnitude < 1e-4
      ? value.toExponential(digits - 1).replace(/\.?0+e/, 'e')
      : Number(value.toPrecision(digits)).toString();
  return text.replace('-', '−');
}

/** A complex number for reading, in rectangular form: 40 − j30. */
export function fmtComplex(z: Complex, digits = 6): string {
  const im = Math.abs(z.im) < 1e-12 * Math.max(1, Math.abs(z.re)) ? 0 : z.im;
  if (im === 0) return fmt(z.re, digits);
  const re = Math.abs(z.re) < 1e-12 * Math.max(1, Math.abs(z.im)) ? 0 : z.re;
  const sign = im < 0 ? '−' : '+';
  return `${re === 0 ? '' : `${fmt(re, digits)} ${sign} `}${re === 0 && im < 0 ? '−' : ''}j${fmt(Math.abs(im), digits)}`;
}

export const sum = (values: ArrayLike<number>): number => {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i]!;
  return total;
};

export const mean = (values: ArrayLike<number>): number => (values.length ? sum(values) / values.length : NaN);

/** The standard deviation, of the sample (n - 1) unless `population` is set. */
export function sd(values: ArrayLike<number>, population = false): number {
  const n = values.length;
  if (n < (population ? 1 : 2)) return NaN;
  const m = mean(values);
  let squares = 0;
  for (let i = 0; i < n; i += 1) squares += (values[i]! - m) ** 2;
  return Math.sqrt(squares / (population ? n : n - 1));
}

export const db10 = (power: number): number => 10 * Math.log10(power);
export const db20 = (amplitude: number): number => 20 * Math.log10(amplitude);

/** Requires a finite number in a range, or throws the error that names the field. */
export function need(value: number, field: string, min = -Infinity, max = Infinity, open = false): number {
  const ok = Number.isFinite(value) && (open ? value > min && value < max : value >= min && value <= max);
  if (!ok) throw new SignalError('outOfRange', { field });
  return value;
}

/** A typed number, or NaN when the text is not one plain number. */
export function num(text: string): number {
  const trimmed = text.trim().replace('−', '-');
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}
