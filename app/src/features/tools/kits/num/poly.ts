// Polynomials for the kits, lowest power first (p[k] is the coefficient of x^k), like the math solvers' polynomials.
// It covers arithmetic, composition, and complex coefficients. Every root comes from the eigenvalues of the companion
// matrix, polished by Newton's method. Partial fractions split a rational function N(s)/D(s).
// Control texts write coefficients highest power first; fromDescending and toDescending convert.
import { cabs, cadd, cdiv, cmul, csub, cx, ONE, ZERO } from './complex';
import type { Complex } from './complex';
import { NumError } from './errors';
import { eig } from './matrix';

/** Real coefficients, lowest power first. */
export type Poly = number[];

const EPS = 2 ** -52;

/** Drops the highest-power coefficients that are zero next to the largest one; [0] for the zero polynomial. */
export function trim(p: readonly number[]): Poly {
  const size = Math.max(0, ...p.map(Math.abs));
  let end = p.length;
  while (end > 1 && Math.abs(p[end - 1]) <= 1e-14 * size) end -= 1;
  return end === 0 ? [0] : p.slice(0, end);
}

export function padd(a: readonly number[], b: readonly number[], sign = 1): Poly {
  return trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + sign * (b[i] ?? 0)));
}

export function pmul(a: readonly number[], b: readonly number[]): Poly {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) out[i + j] += a[i] * b[j];
  return trim(out);
}

/** Long division: a = q·b + r with deg r < deg b. */
export function pdiv(a: readonly number[], b: readonly number[]): { q: Poly; r: Poly } {
  const d = trim(b);
  if (d.length === 1 && d[0] === 0) throw new NumError('domain', 'division by the zero polynomial');
  const r = [...trim(a)];
  const q = new Array<number>(Math.max(1, r.length - d.length + 1)).fill(0);
  const lead = d[d.length - 1];
  for (let shift = r.length - d.length; shift >= 0; shift -= 1) {
    const factor = r[shift + d.length - 1] / lead;
    q[shift] = factor;
    for (let i = 0; i < d.length; i += 1) r[shift + i] -= factor * d[i];
  }
  return { q: trim(q), r: trim(r.slice(0, Math.max(1, d.length - 1))) };
}

/** p(x) by Horner's rule. */
export const peval = (p: readonly number[], x: number): number => p.reduceRight((sum, c) => sum * x + c, 0);

/** p(z) for complex z. */
export function pevalC(p: readonly number[], z: Complex): Complex {
  let out = ZERO;
  for (let i = p.length - 1; i >= 0; i -= 1) out = cadd(cmul(out, z), cx(p[i]));
  return out;
}

export const pderiv = (p: readonly number[]): Poly =>
  p.length <= 1 ? [0] : trim(p.slice(1).map((c, i) => c * (i + 1)));

/** Taylor coefficients of p about z: p(z + h) = Σ c_k h^k, by repeated synthetic division. */
export function shiftC(p: readonly number[], z: Complex): Complex[] {
  const c: Complex[] = p.map((x) => cx(x));
  for (let i = 0; i < c.length; i += 1) for (let j = c.length - 2; j >= i; j -= 1) c[j] = cadd(c[j], cmul(z, c[j + 1]));
  return c;
}

/** The first `count` Taylor coefficients of the quotient a/b from the coefficients of both (b[0] ≠ 0). */
export function seriesDivide(a: readonly Complex[], b: readonly Complex[], count: number): Complex[] {
  const out: Complex[] = [];
  for (let k = 0; k < count; k += 1) {
    let sum = a[k] ?? ZERO;
    for (let j = 1; j <= k; j += 1) sum = csub(sum, cmul(b[j] ?? ZERO, out[k - j]));
    out.push(cdiv(sum, b[0]));
  }
  return out;
}

/** Complex coefficients, lowest power first. */
export type CPoly = Complex[];

export const fromDescending = (coefficients: readonly number[]): Poly => trim([...coefficients].reverse());
export const toDescending = (p: Poly): number[] => [...trim(p)].reverse();

export const degree = (p: Poly): number => trim(p).length - 1;

export const pscale = (p: Poly, k: number): Poly => trim(p.map((c) => c * k));

/** p(q(x)), by Horner's rule on polynomials. */
export function compose(p: Poly, q: Poly): Poly {
  let out: Poly = [0];
  for (let i = p.length - 1; i >= 0; i -= 1) out = padd(pmul(out, q), [p[i]]);
  return trim(out);
}

/** The monic polynomial with these roots: Π (x - r). Real when the complex roots come in conjugate pairs. */
export function fromRoots(roots: readonly Complex[]): CPoly {
  let out: CPoly = [ONE];
  for (const r of roots) {
    const next: CPoly = new Array<Complex>(out.length + 1).fill(ZERO);
    out.forEach((c, k) => {
      next[k + 1] = cadd(next[k + 1], c);
      next[k] = csub(next[k], cmul(c, r));
    });
    out = next;
  }
  return out;
}

/** The real parts of a complex polynomial, when its imaginary parts are rounding noise. */
export function realPart(p: CPoly, tol = 1e-9): Poly {
  const size = Math.max(1, ...p.map(cabs));
  if (p.some((c) => Math.abs(c.im) > tol * size)) throw new NumError('domain', 'the coefficients are not real');
  return p.map((c) => c.re);
}

export function cpEval(p: CPoly, z: Complex): Complex {
  let out = ZERO;
  for (let i = p.length - 1; i >= 0; i -= 1) out = cadd(cmul(out, z), p[i]);
  return out;
}

export const cpDerivative = (p: CPoly): CPoly =>
  p.length <= 1 ? [ZERO] : p.slice(1).map((c, i) => cx(c.re * (i + 1), c.im * (i + 1)));

export interface PolyRoot {
  z: Complex;
  /** How many times the root repeats. */
  times: number;
}

/**
 * Every root of p, from the eigenvalues of its companion matrix, each polished by Newton's method on p (a step is
 * kept only when it makes |p| smaller). Roots that agree to about eps^(1/m) are gathered into one of multiplicity m.
 */
export function polyRoots(input: Poly): PolyRoot[] {
  if (!input.every(Number.isFinite)) throw new NumError('notFinite');
  const p = trim(input);
  if (p.length === 1) {
    if (p[0] === 0) throw new NumError('domain', 'the zero polynomial has every number as a root');
    return [];
  }
  let zerosAtOrigin = 0;
  while (zerosAtOrigin < p.length - 1 && p[zerosAtOrigin] === 0) zerosAtOrigin += 1;
  const q = p.slice(zerosAtOrigin);
  const n = q.length - 1;
  const lead = q[n];
  const raw: Complex[] = [];
  if (n === 1) raw.push(cx(-q[0] / q[1]));
  else if (n > 1) {
    const companion = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === 0 ? -q[n - 1 - j] / lead : i === j + 1 ? 1 : 0)),
    );
    raw.push(...eig(companion).values.map((z) => polish(q, z)));
  }
  const found = gather(raw).map((root) => (root.times > 1 ? { ...root, z: sharpen(q, root) } : root));
  if (zerosAtOrigin > 0) found.push({ z: ZERO, times: zerosAtOrigin });
  return found.sort((a, b) => b.z.re - a.z.re || b.z.im - a.z.im);
}

function polish(p: Poly, start: Complex): Complex {
  const dp = pderiv(p);
  let z = start;
  let size = cabs(pevalC(p, z));
  for (let i = 0; i < 8 && size > 0; i += 1) {
    const step = cdiv(pevalC(p, z), pevalC(dp, z));
    if (!Number.isFinite(step.re) || !Number.isFinite(step.im)) break;
    const next = csub(z, step);
    const nextSize = cabs(pevalC(p, next));
    if (!(nextSize < size)) break;
    z = next;
    size = nextSize;
  }
  return z;
}

/**
 * Gathers roots into repeated roots at their mean: a root repeated m times comes out of the eigenvalues spread by
 * about eps^(1/m), so a group is kept only when its spread is within 100 eps^(1/m) of the roots' size.
 */
function gather(raw: readonly Complex[]): PolyRoot[] {
  const scale = Math.max(1, ...raw.map(cabs));
  const groups: Complex[][] = [];
  for (const z of raw) {
    const group = groups.find((g) => cabs(csub(g[0], z)) < 1e-3 * scale);
    if (group) group.push(z);
    else groups.push([z]);
  }
  const tidy = (x: number) => (Math.abs(x) < 1e-12 * scale ? 0 : x);
  return groups.flatMap((g) => {
    const re = g.reduce((s, w) => s + w.re, 0) / g.length;
    const im = g.reduce((s, w) => s + w.im, 0) / g.length;
    const spread = Math.max(...g.map((w) => cabs(csub(w, cx(re, im)))));
    if (g.length > 1 && spread > 100 * EPS ** (1 / g.length) * scale) {
      return g.map((w) => ({ z: cx(tidy(w.re), tidy(w.im)), times: 1 }));
    }
    return [{ z: cx(tidy(re), tidy(im)), times: g.length }];
  });
}

/** A root repeated m times is a simple root of the (m-1)th derivative: Newton's method there sharpens it. */
function sharpen(p: Poly, root: PolyRoot): Complex {
  let target = p;
  for (let i = 1; i < root.times; i += 1) target = pderiv(target);
  const real = root.z.im === 0;
  let z = root.z;
  let size = cabs(pevalC(target, z));
  const dt = pderiv(target);
  for (let i = 0; i < 6 && size > 0; i += 1) {
    const step = cdiv(pevalC(target, z), pevalC(dt, z));
    const next = csub(z, real ? cx(step.re) : step);
    const nextSize = cabs(pevalC(target, next));
    if (!(nextSize < size)) break;
    z = next;
    size = nextSize;
  }
  return z;
}

/** One term r / (s - pole)^power of a partial fraction expansion. */
export interface Residue {
  pole: Complex;
  power: number;
  residue: Complex;
}

export interface PartialFractions {
  /** The polynomial part when deg N >= deg D (lowest power first); [0] when proper. */
  direct: Poly;
  terms: Residue[];
}

/**
 * N(s)/D(s) = direct(s) + Σ r / (s - p)^k, like MATLAB's residue. Each residue of a pole of multiplicity m comes from
 * the Taylor series of (s - p)^m N(s)/D(s) about p.
 */
export function partialFractions(numerator: Poly, denominator: Poly): PartialFractions {
  const d = trim(denominator);
  if (d.length === 1 && d[0] === 0) throw new NumError('domain', 'the denominator is zero');
  const { q, r } = d.length <= trim(numerator).length ? pdiv(numerator, d) : { q: [0], r: trim(numerator) };
  const poles = polyRoots(d);
  const lead = d[d.length - 1];
  const terms: Residue[] = [];
  poles.forEach(({ z: pole, times }, index) => {
    // The other poles' factors, as Taylor coefficients about this pole.
    let rest: Complex[] = [cx(lead)];
    poles.forEach((other, j) => {
      if (j === index) return;
      for (let k = 0; k < other.times; k += 1) rest = mulSeries(rest, [csub(pole, other.z), ONE]);
    });
    const series = seriesDivide(shiftC(r, pole), rest, times);
    for (let k = 0; k < times; k += 1) terms.push({ pole, power: times - k, residue: tidyComplex(series[k]) });
  });
  return { direct: trim(q), terms };
}

function mulSeries(a: readonly Complex[], b: readonly Complex[]): Complex[] {
  const out: Complex[] = new Array<Complex>(a.length + b.length - 1).fill(ZERO);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] = cadd(out[i + j], cmul(x, y)))));
  return out;
}

const tidyComplex = (z: Complex): Complex => {
  const size = cabs(z);
  return cx(Math.abs(z.re) < 1e-13 * size ? 0 : z.re, Math.abs(z.im) < 1e-13 * size ? 0 : z.im);
};

/** p(x) for real x, re-exported under the kits' name. */
export const evaluate = (p: Poly, x: number): number => peval(p, x);
