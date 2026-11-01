// Shared pieces for the aerospace tools' engines: worked steps, errors, number text, and the two scalar solvers
// (Brent's root finder and golden-section search) that the inverses use. Engines stay pure: no DOM, no React, no t().
import './text';
import type { kitAero } from '../../../strings/en/kitAero';

type Sections = (typeof kitAero)['t'];

/** A worked-step sentence in some tool's section of the strings ("s"). */
export type AeroStepKey = { [K in keyof Sections]: keyof Sections[K]['s'] & string }[keyof Sections];

/** A problem any tool can report, or one in a tool's own section ("e"). */
export type AeroErrorKey =
  | (keyof (typeof kitAero)['error'] & string)
  | { [K in keyof Sections]: keyof Sections[K]['e'] & string }[keyof Sections];

/** A worked step: a sentence key in the kitAero strings, the values it names, and the LaTeX it shows. */
export interface AeroStep {
  readonly key: AeroStepKey;
  readonly vars?: Readonly<Record<string, string>>;
  readonly math?: string;
}

export const step = (key: AeroStepKey, math?: string, vars?: Record<string, string>): AeroStep => ({
  key,
  ...(math === undefined ? {} : { math }),
  ...(vars ? { vars } : {}),
});

/** Why an engine could not answer. The interface turns the code into a sentence with the vars filled in. */
export class AeroError extends Error {
  constructor(
    readonly code: AeroErrorKey,
    readonly vars: Readonly<Record<string, string>> = {},
  ) {
    super(code);
  }
}

/** A point on a plot, in the plot's own coordinates. */
export interface XY {
  readonly x: number;
  readonly y: number;
}

/** A number as text with `sig` significant figures (plain, or with a power of ten) for steps and answers. */
export function num(x: number, sig = 5): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : x < 0 ? '-\\infty' : 'NaN';
  if (x === 0) return '0';
  const mag = Math.abs(x);
  if (mag >= 1e-3 && mag < 1e7) {
    const text = x.toPrecision(sig);
    return text.includes('e') ? String(Number(text)) : trimZeros(text);
  }
  const [mant, exp] = x.toExponential(sig - 1).split('e');
  return `${trimZeros(mant ?? '')}e${Number(exp)}`;
}

/** The sides of an equation, joined by equals signs, so long worked steps stay readable in the source. */
export const eq = (...sides: readonly string[]): string => sides.join(' = ');

/** The same number for LaTeX: a power of ten as \times 10^{n}. */
export function tex(x: number, sig = 5): string {
  const text = num(x, sig);
  const at = text.indexOf('e');
  if (at < 0 || text.includes('infty')) return text;
  return `${text.slice(0, at)} \\times 10^{${text.slice(at + 1)}}`;
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

export const DEG = Math.PI / 180;

/** Throws when a value is not a finite number. */
export function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new AeroError('notNumber', { name });
  return value;
}

/** Throws unless value > 0 (or >= 0 when zero is allowed). */
export function positive(value: number, name: string, allowZero = false): number {
  finite(value, name);
  if (allowZero ? value < 0 : value <= 0) throw new AeroError(allowZero ? 'notNegative' : 'notPositive', { name });
  return value;
}

/** Throws unless gamma is a ratio of specific heats a real gas can have (1 < gamma <= 5/3 is typical; allow to 2). */
export function checkGamma(gamma: number): number {
  finite(gamma, 'γ');
  if (gamma <= 1 || gamma > 2) throw new AeroError('gammaRange', { value: num(gamma) });
  return gamma;
}

export interface Bracket {
  readonly root: number;
  readonly iterations: number;
  readonly lo: number;
  readonly hi: number;
}

/** Brent's method on [a, b]; f(a) and f(b) must differ in sign. Throws noBracket otherwise. */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-13, maxIter = 200): Bracket {
  const lo0 = a;
  const hi0 = b;
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return { root: a, iterations: 0, lo: lo0, hi: hi0 };
  if (fb === 0) return { root: b, iterations: 0, lo: lo0, hi: hi0 };
  if (!(fa * fb < 0)) throw new AeroError('noBracket');
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 1; i <= maxIter; i += 1) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return { root: b, iterations: i, lo: lo0, hi: hi0 };
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return { root: b, iterations: maxIter, lo: lo0, hi: hi0 };
}

/** The x in [a, b] that maximizes a unimodal f, by golden-section search. */
export function goldenMax(f: (x: number) => number, a: number, b: number, tol = 1e-12): number {
  const r = (Math.sqrt(5) - 1) / 2;
  let x1 = b - r * (b - a);
  let x2 = a + r * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < 300 && Math.abs(b - a) > tol * (1 + Math.abs(a) + Math.abs(b)); i += 1) {
    if (f1 < f2) {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + r * (b - a);
      f2 = f(x2);
    } else {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - r * (b - a);
      f1 = f(x1);
    }
  }
  return (a + b) / 2;
}

/** Solves A x = b by Gaussian elimination with partial pivoting. Throws singular when a pivot vanishes. */
export function luSolve(A: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let k = 0; k < n; k += 1) {
    let p = k;
    for (let i = k + 1; i < n; i += 1) if (Math.abs(m[i]![k]!) > Math.abs(m[p]![k]!)) p = i;
    if (Math.abs(m[p]![k]!) < 1e-14) throw new AeroError('singular');
    [m[k], m[p]] = [m[p]!, m[k]!];
    const rowK = m[k]!;
    for (let i = k + 1; i < n; i += 1) {
      const rowI = m[i]!;
      const factor = rowI[k]! / rowK[k]!;
      if (factor === 0) continue;
      for (let j = k; j <= n; j += 1) rowI[j] = rowI[j]! - factor * rowK[j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = m[i]!;
    let sum = row[n]!;
    for (let j = i + 1; j < n; j += 1) sum -= row[j]! * x[j]!;
    x[i] = sum / row[i]!;
  }
  return x;
}

/** Evenly spaced samples of f on [a, b]; values that are not finite become NaN so a plot breaks there. */
export function sample(f: (x: number) => number, a: number, b: number, count = 120): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= count; i += 1) {
    const x = a + ((b - a) * i) / count;
    const y = f(x);
    out.push({ x, y: Number.isFinite(y) ? y : NaN });
  }
  return out;
}
