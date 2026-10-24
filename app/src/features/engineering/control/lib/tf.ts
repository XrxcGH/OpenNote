// Transfer functions with real coefficients: algebra (series, parallel, feedback), poles and zeros, gains,
// conversion to and from state space, reading from typed text and writing as LaTeX. Polynomials keep the lowest
// power first, as in math/solvers/polynomial.

import { formatNumber } from '../../../../core/expr';
import { read, ExprError } from './expr';
import { cabs, cadd, cdiv, cmul, csub, cx, padd, pevalC, pmul, roots, trim, type Complex, type Poly } from './poly';
import { rationalOf } from './poly';
import { eye, leverrier, mul, zeros, type Mat, type ReadonlyMat } from './linalg';

export type { Complex, Poly };
export { cabs, cadd, cdiv, cmul, csub, cx, pevalC };

/** N(s)/D(s), lowest power first. */
export interface TF {
  readonly num: Poly;
  readonly den: Poly;
}

/** Why a transfer function could not be read or used. */
export class TFError extends Error {
  constructor(
    readonly code: 'empty' | 'notRational' | 'zeroDenominator' | 'improper' | 'tooHigh' | 'notFinite' | 'syntax',
  ) {
    super(code);
  }
}

export const MAX_ORDER = 12;

/** Trims, checks, and scales N/D so that D is monic. */
export function makeTF(num: Poly, den: Poly): TF {
  const d = trim(den.map((c) => (Math.abs(c) < 1e-300 ? 0 : c)));
  const n = trim(num);
  if (![...n, ...d].every(Number.isFinite)) throw new TFError('notFinite');
  if (d.length === 1 && d[0] === 0) throw new TFError('zeroDenominator');
  if (d.length - 1 > MAX_ORDER || n.length - 1 > MAX_ORDER) throw new TFError('tooHigh');
  const lead = d[d.length - 1];
  return { num: n.map((c) => c / lead), den: d.map((c) => c / lead) };
}

/** Reads text such as "4/(s^2 + 2s + 4)" or "10 (s + 1)/(s (s + 5))" as a rational function of `v`. */
export function readTF(text: string, v = 's'): TF {
  if (!text.trim()) throw new TFError('empty');
  let node;
  try {
    node = read(text);
  } catch (e) {
    if (e instanceof ExprError && e.code === 'empty') throw new TFError('empty');
    throw new TFError('syntax');
  }
  const r = rationalOf(node, v);
  if (!r) throw new TFError('notRational');
  return makeTF(r.n, r.d);
}

/** Reads a coefficient list "1 2 4" or "1, 2, 4" (highest power first, as typed) into a Poly. */
export function readCoefficients(text: string): Poly {
  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!parts.length) throw new TFError('empty');
  const values = parts.map((p) => Number(p.replace(/−/g, '-')));
  if (!values.every(Number.isFinite)) throw new TFError('syntax');
  return values.reverse();
}

export const order = (p: Poly): number => trim(p).length - 1;
export const isProper = (g: TF): boolean => order(g.num) <= order(g.den);
export const isStrictlyProper = (g: TF): boolean => order(g.num) < order(g.den) || isZeroPoly(g.num);
export const isZeroPoly = (p: Poly): boolean => trim(p).every((c) => c === 0);

export const series = (a: TF, b: TF): TF => makeTF(pmul(a.num, b.num), pmul(a.den, b.den));
export const parallel = (a: TF, b: TF): TF => makeTF(padd(pmul(a.num, b.den), pmul(b.num, a.den)), pmul(a.den, b.den));

/** G/(1 ∓ GH): sign −1 is negative feedback (the usual case). */
export function feedback(g: TF, h: TF = { num: [1], den: [1] }, sign: 1 | -1 = -1): TF {
  const num = pmul(g.num, h.den);
  const den = padd(pmul(g.den, h.den), pmul(g.num, h.num), -sign);
  return makeTF(num, den);
}

/** G(s) at a complex s. */
export const evalTF = (g: TF, s: Complex): Complex => cdiv(pevalC(g.num, s), pevalC(g.den, s));

/** All roots, each listed as many times as it repeats, sorted by real part then imaginary part. */
export function rootsOf(p: Poly): Complex[] {
  const out: Complex[] = [];
  const t = trim(p);
  // Exact zeros at the origin first: they make the other roots better conditioned.
  let k = 0;
  while (k < t.length - 1 && t[k] === 0) k += 1;
  for (let i = 0; i < k; i += 1) out.push(cx(0));
  for (const r of roots(t.slice(k))) for (let i = 0; i < r.times; i += 1) out.push(r.z);
  return out.sort((a, b) => a.re - b.re || a.im - b.im);
}

export const poles = (g: TF): Complex[] => rootsOf(g.den);
export const zerosOf = (g: TF): Complex[] => (isZeroPoly(g.num) ? [] : rootsOf(g.num));

/** The monic polynomial with the given roots (complex roots must come in conjugate pairs). */
export function polyFromRoots(rs: readonly Complex[]): Poly {
  let re: number[] = [1];
  let im: number[] = [0];
  for (const r of rs) {
    // (s − r) · (re + i·im)
    const nre = new Array<number>(re.length + 1).fill(0);
    const nim = new Array<number>(re.length + 1).fill(0);
    for (let i = 0; i < re.length; i += 1) {
      nre[i + 1] += re[i];
      nim[i + 1] += im[i];
      nre[i] += -r.re * re[i] + r.im * im[i];
      nim[i] += -r.re * im[i] - r.im * re[i];
    }
    re = nre;
    im = nim;
  }
  return re;
}

/** The number of open-loop poles at the origin: the system type. */
export function systemType(g: TF): number {
  let k = 0;
  while (k < g.den.length - 1 && Math.abs(g.den[k]) < 1e-12 * Math.max(1, Math.abs(g.den[g.den.length - 1]))) k += 1;
  return k;
}

/** lim_{s→0} s^k G(s) for k = 0, 1, 2: the position, velocity, and acceleration error constants. */
export function errorConstants(g: TF): { kp: number; kv: number; ka: number; type: number } {
  const type = systemType(g);
  const lowNum = g.num[0] ?? 0;
  const limit = (k: number): number => {
    // s^k N / D near 0: D ≈ d_type s^type, so the limit is N(0)/d_type when k = type.
    if (k < type) return lowNum === 0 ? 0 : Infinity * Math.sign(lowNum / g.den[type]);
    if (k > type) return 0;
    return lowNum / g.den[type];
  };
  return { kp: limit(0), kv: limit(1), ka: limit(2), type };
}

/** G(0), or ±∞ with a pole at the origin. */
export function dcGain(g: TF): number {
  const d0 = g.den[0];
  const n0 = g.num[0] ?? 0;
  if (Math.abs(d0) < 1e-14) return n0 === 0 ? Number.NaN : Infinity * Math.sign(n0);
  return n0 / d0;
}

/**
 * Cancels pole-zero pairs that agree within tol (relative): returns the reduced TF and the canceled roots.
 */
export function minreal(g: TF, tol = 1e-7): { tf: TF; cancelled: Complex[] } {
  if (isZeroPoly(g.num)) return { tf: makeTF([0], [1]), cancelled: [] };
  const z = zerosOf(g);
  const p = poles(g);
  const cancelled: Complex[] = [];
  const keepP = [...p];
  const keepZ: Complex[] = [];
  for (const zz of z) {
    const i = keepP.findIndex((pp) => cabs(csub(pp, zz)) <= tol * Math.max(1, cabs(zz)));
    if (i >= 0) {
      cancelled.push(keepP[i]);
      keepP.splice(i, 1);
    } else keepZ.push(zz);
  }
  if (!cancelled.length) return { tf: g, cancelled };
  const gain = g.num[g.num.length - 1];
  const num = polyFromRoots(keepZ).map((c) => c * gain);
  return { tf: makeTF(num, polyFromRoots(keepP)), cancelled };
}

/** A state-space model ẋ = Ax + Bu, y = Cx + Du. */
export interface SS {
  readonly a: Mat;
  readonly b: Mat;
  readonly c: Mat;
  readonly d: Mat;
}

/** Controllable canonical form of a proper TF. Throws 'improper' when deg N > deg D. */
export function tfToSS(g: TF): SS {
  if (!isProper(g)) throw new TFError('improper');
  const n = order(g.den);
  const den = g.den; // monic
  const num = [...g.num];
  while (num.length < n + 1) num.push(0);
  const dd = num[n] ?? 0; // feedthrough: b_n (den monic)
  if (n === 0) return { a: [], b: [], c: [], d: [[dd]] };
  const a = zeros(n, n);
  for (let i = 0; i < n - 1; i += 1) a[i][i + 1] = 1;
  for (let j = 0; j < n; j += 1) a[n - 1][j] = -den[j];
  const b = zeros(n, 1);
  b[n - 1][0] = 1;
  // Strictly proper part: N − dd·D, coefficients of s^0 … s^{n−1}.
  const c = [Array.from({ length: n }, (_, j) => num[j] - dd * den[j])];
  return { a, b, c, d: [[dd]] };
}

/** The TF from input j to output i of a state-space model, by the Faddeev–Leverrier method. */
export function ssToTF(ss: SS, i = 0, j = 0): TF {
  const n = ss.a.length;
  const d = ss.d[i]?.[j] ?? 0;
  if (n === 0) return makeTF([d], [1]);
  const { coeffs, adj } = leverrier(ss.a);
  const den = [...coeffs].reverse(); // lowest power first
  const ci: ReadonlyMat = [ss.c[i]];
  const bj: ReadonlyMat = ss.b.map((row) => [row[j]]);
  // adj(sI − A) = Σ_k M_k s^{n−1−k}
  const numStrict = new Array<number>(n + 1).fill(0);
  adj.forEach((m, k) => {
    numStrict[n - 1 - k] += mul(mul(ci, m), bj)[0][0];
  });
  const num = numStrict.map((x, k) => x + d * den[k]);
  return makeTF(num, den);
}

export const identityTF: TF = { num: [1], den: [1] };
export const eyeN = eye;

// ---------------------------------------------------------------------------------------------------------------
// Writing

/** A number as a short decimal: six significant digits, trailing zeros dropped. */
export function fmt(x: number, digits = 6): string {
  if (Number.isNaN(x)) return '—';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  if (x === 0 || Math.abs(x) < 1e-300) return '0';
  return formatNumber(x, { digits }).replace(/^-/, '−');
}

/** A number for LaTeX: the same as fmt with a plain minus and ×10 powers in LaTeX. */
export function fmtTex(x: number, digits = 6): string {
  const text = fmt(x, digits).replace(/−/g, '-').replace(/∞/g, '\\infty ');
  return text.replace(/[×x]\s?10\^?\(?(-?\d+)\)?/, ' \\times 10^{$1}').replace(/e([+-]?\d+)$/, ' \\times 10^{$1}');
}

/** A polynomial as LaTeX in `v`, highest power first: "s^{2} + 2s + 4". */
export function polyTex(p: Poly, v = 's', digits = 6): string {
  const t = trim(p);
  const terms: string[] = [];
  for (let k = t.length - 1; k >= 0; k -= 1) {
    const c = t[k];
    if (c === 0 && t.length > 1) continue;
    const abs = Math.abs(c);
    const coef = k === 0 || Math.abs(abs - 1) > 1e-12 ? fmtTex(abs, digits) : '';
    const power = k === 0 ? '' : k === 1 ? v : `${v}^{${k}}`;
    const body = `${coef}${coef && power ? ' ' : ''}${power}`;
    terms.push(`${c < 0 ? '-' : '+'} ${body}`);
  }
  if (!terms.length) return '0';
  const text = terms.join(' ');
  return text.startsWith('+ ') ? text.slice(2) : `-${text.slice(2)}`;
}

/** A polynomial as plain text, highest power first: "s² + 2s + 4". */
export function polyText(p: Poly, v = 's', digits = 6): string {
  const sup = (k: number) =>
    String(k)
      .split('')
      .map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
      .join('');
  const t = trim(p);
  const terms: string[] = [];
  for (let k = t.length - 1; k >= 0; k -= 1) {
    const c = t[k];
    if (c === 0 && t.length > 1) continue;
    const abs = Math.abs(c);
    const coef = k === 0 || Math.abs(abs - 1) > 1e-12 ? fmt(abs, digits) : '';
    const power = k === 0 ? '' : k === 1 ? v : `${v}${sup(k)}`;
    terms.push(`${c < 0 ? '−' : '+'} ${coef}${power}`);
  }
  if (!terms.length) return '0';
  const text = terms.join(' ');
  return text.startsWith('+ ') ? text.slice(2) : `−${text.slice(2)}`;
}

/** G(s) as a LaTeX fraction. */
export const tfTex = (g: TF, v = 's', digits = 6): string =>
  order(g.den) === 0 && g.den[0] === 1
    ? polyTex(g.num, v, digits)
    : `\\frac{${polyTex(g.num, v, digits)}}{${polyTex(g.den, v, digits)}}`;

/** G(s) as plain text: "(4)/(s² + 2s + 4)". */
export const tfText = (g: TF, v = 's', digits = 6): string =>
  order(g.den) === 0 && g.den[0] === 1
    ? polyText(g.num, v, digits)
    : `(${polyText(g.num, v, digits)})/(${polyText(g.den, v, digits)})`;

/** A complex number as text: "−1 + 1.73205i". */
export function complexText(z: Complex, digits = 6): string {
  const im = Math.abs(z.im) < 1e-12 * Math.max(1, Math.abs(z.re)) ? 0 : z.im;
  if (im === 0) return fmt(z.re, digits);
  const re = Math.abs(z.re) < 1e-12 * Math.max(1, Math.abs(im)) ? 0 : z.re;
  const imText = `${fmt(Math.abs(im), digits)}i`;
  if (re === 0) return im < 0 ? `−${imText}` : imText;
  return `${fmt(re, digits)} ${im < 0 ? '−' : '+'} ${imText}`;
}

/** A complex number as LaTeX. */
export const complexTex = (z: Complex, digits = 6): string =>
  complexText(z, digits).replace(/−/g, '-').replace(/i$/, 'j');

/** Zero-pole-gain form: zeros, poles, and the gain k with G = k Π(s − z)/Π(s − p). */
export function zpk(g: TF): { zeros: Complex[]; poles: Complex[]; k: number } {
  const lead = isZeroPoly(g.num) ? 0 : g.num[trim(g.num).length - 1];
  return { zeros: zerosOf(g), poles: poles(g), k: lead / g.den[g.den.length - 1] };
}
