// Statistics and exact fractions the genetics tools share: the chi-square distribution through the regularized
// incomplete gamma function, a seeded random source, and fractions for Mendelian probabilities.
import { fail, readNumber } from './shared';
import type { MolKey } from './shared';

/** ln Gamma(x) for x > 0 by the Lanczos approximation (g = 7, 9 terms). */
export function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let sum = c[0]!;
  for (let i = 1; i < 9; i++) sum += c[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** The regularized upper incomplete gamma Q(a, x), by its series below a + 1 and a continued fraction above. */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const front = Math.exp(-x + a * Math.log(x) - lnGamma(a));
  if (x < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 1000 && Math.abs(term) > Math.abs(sum) * 1e-16; n++) {
      term *= x / (a + n);
      sum += term;
    }
    return Math.max(0, 1 - sum * front);
  }
  // Modified Lentz evaluation of the continued fraction for Q.
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return front * h;
}

/** P(chi-square with `df` degrees of freedom is at least x). */
export const chiSquareP = (x: number, df: number): number => gammaQ(df / 2, x / 2);

export interface ChiSquare {
  chi2: number;
  df: number;
  p: number;
  expected: number[];
  terms: number[];
}

/** Goodness of fit of counts to a ratio; df = classes - 1 - `fitted` parameters. */
export function chiSquareFit(observed: number[], ratio: number[], fitted = 0): ChiSquare {
  if (observed.length !== ratio.length)
    return fail('e.ratioLength', { classes: String(observed.length), ratio: String(ratio.length) });
  if (observed.length < 2) return fail('e.fewClasses');
  if (observed.some((o) => o < 0) || ratio.some((r) => r <= 0)) return fail('e.ratioPositive');
  const total = observed.reduce((s, o) => s + o, 0);
  const weight = ratio.reduce((s, r) => s + r, 0);
  if (total <= 0) return fail('e.noCounts');
  const expected = ratio.map((r) => (total * r) / weight);
  const terms = observed.map((o, i) => (o - expected[i]!) ** 2 / expected[i]!);
  const chi2 = terms.reduce((s, t) => s + t, 0);
  const df = observed.length - 1 - fitted;
  if (df < 1) return fail('e.noDf');
  return { chi2, df, p: chiSquareP(chi2, df), expected, terms };
}

// ---- Fractions ----

export interface Frac {
  n: number;
  d: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

export function frac(n: number, d = 1): Frac {
  if (d === 0) return fail('e.zeroDenominator');
  const g = gcd(n, d) || 1;
  const sign = d < 0 ? -1 : 1;
  return { n: (sign * n) / g, d: (sign * d) / g };
}

export const fAdd = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const fMul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
export const fDiv = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n);
export const fNum = (a: Frac): number => a.n / a.d;
export const fText = (a: Frac): string => (a.d === 1 ? String(a.n) : `${a.n}/${a.d}`);

/** A probability typed as a fraction (2/3), a decimal (0.25) or a percentage (25%); it must lie in [0, 1]. */
export function readProbability(text: string, label: MolKey): number {
  const t = text.trim();
  let value: number | null;
  if (t.includes('/')) {
    const [a, b] = t.split('/');
    const n = readNumber(a ?? '');
    const d = readNumber(b ?? '');
    value = n === null || d === null || d === 0 ? null : n / d;
  } else if (t.endsWith('%')) {
    const p = readNumber(t.slice(0, -1));
    value = p === null ? null : p / 100;
  } else value = readNumber(t);
  if (value === null) return fail('e.probability', { field: label });
  return value >= 0 && value <= 1 ? value : fail('e.probabilityRange', { field: label });
}

// ---- Randomness ----

/** A seeded random source (mulberry32), so a seed gives the same run on any device. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Binomial draw by inversion of the probability mass function, for a mean below 30. */
function binomialSmall(n: number, p: number, random: () => number): number {
  const q = 1 - p;
  const s = p / q;
  const a = (n + 1) * s;
  let r = q ** n;
  let u = random();
  let k = 0;
  while (u > r && k < n) {
    u -= r;
    k += 1;
    r *= a / k - s;
  }
  return k;
}

/**
 * A binomial draw: exact by inversion when the smaller of n p and n (1 - p) is below 30, else the normal
 * approximation with a continuity-free rounding, clamped to 0..n.
 */
export function binomial(n: number, p: number, random: () => number): number {
  if (p <= 0 || n <= 0) return 0;
  if (p >= 1) return n;
  if (n * Math.min(p, 1 - p) < 30) return p <= 0.5 ? binomialSmall(n, p, random) : n - binomialSmall(n, 1 - p, random);
  const u = Math.max(random(), 1e-12);
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  return Math.min(n, Math.max(0, Math.round(n * p + z * Math.sqrt(n * p * (1 - p)))));
}
