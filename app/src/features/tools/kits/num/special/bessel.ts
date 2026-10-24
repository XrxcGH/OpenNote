// Bessel functions of whole order for real x, and J₀ and J₁ of a complex argument. They are written from their
// definitions in Abramowitz and Stegun (a US Government publication, chapter 9):
// - J₀, J₁, Y₀, Y₁: the power series (9.1.10, 9.1.11) for |x| ≤ 12.5 and Hankel's asymptotic expansion (9.2.5 to
//   9.2.10) beyond, which meet with an absolute error below about 1e-11.
// - Jₙ: the series for small |x|, else Bessel's integral (9.1.21) by the trapezoidal rule over a full period, which
//   converges geometrically for this periodic integrand. Yₙ by upward recurrence from Y₀ and Y₁ (stable).
// - Iₙ: the series (9.6.10) for |x| ≤ 30, else the integral 9.6.19 by the trapezoidal rule.
// - Kₙ: the integral K_ν(x) = ∫₀^∞ e^(-x cosh t) cosh(νt) dt (9.6.24) by the trapezoidal rule, whose error falls
//   like e^(-2πd/h) for this doubly decaying integrand; then upward recurrence (stable).
import { cabs, cadd, cmul, cx, ONE, ZERO } from '../complex';
import type { Complex } from '../complex';
import { NumError } from '../errors';

const EULER_GAMMA = 0.5772156649015329;
const SWITCH = 12.5;

function wholeOrder(n: number): void {
  if (!Number.isInteger(n) || Math.abs(n) > 1000) throw new NumError('domain', 'the order must be a whole number');
}

/** Σ (∓x²/4)^k / (k!(k+n)!) · (x/2)^n: J (sign -1) or I (sign +1). */
function series(n: number, x: number, sign: 1 | -1): number {
  if (x === 0) return n === 0 ? 1 : 0;
  const q = (sign * x * x) / 4;
  let term = 1;
  for (let k = 1; k <= n; k += 1) term *= x / 2 / k;
  let sum = term;
  for (let k = 1; k < 500; k += 1) {
    term *= q / (k * (k + n));
    sum += term;
    if (Math.abs(term) <= 1e-17 * Math.abs(sum) && k * k > Math.abs(q)) break;
  }
  return sum;
}

/** Hankel's P and Q for order ν at large x. */
function hankel(nu: number, x: number): { p: number; q: number } {
  const mu = 4 * nu * nu;
  let p = 1;
  let q = 0;
  let term = 1;
  let last = Infinity;
  for (let k = 1; k < 60; k += 1) {
    term *= (mu - (2 * k - 1) ** 2) / (k * 8 * x);
    if (Math.abs(term) > last || term === 0) break;
    last = Math.abs(term);
    const sign = Math.floor(k / 2) % 2 === 0 ? 1 : -1;
    if (k % 2 === 0) p += sign * term;
    else q += sign * term;
  }
  return { p, q };
}

/** J_ν and Y_ν for ν = 0 or 1 and x ≥ SWITCH, from Hankel's expansion. */
function asymptotic(nu: 0 | 1, x: number): { j: number; y: number } {
  const { p, q } = hankel(nu, x);
  const c = Math.cos(x);
  const s = Math.sin(x);
  const cosChi = nu === 0 ? (c + s) / Math.SQRT2 : (s - c) / Math.SQRT2;
  const sinChi = nu === 0 ? (s - c) / Math.SQRT2 : -(s + c) / Math.SQRT2;
  const amp = Math.sqrt(2 / (Math.PI * x));
  return { j: amp * (p * cosChi - q * sinChi), y: amp * (p * sinChi + q * cosChi) };
}

export function besselJ0(x: number): number {
  const ax = Math.abs(x);
  return ax <= SWITCH ? series(0, ax, -1) : asymptotic(0, ax).j;
}

export function besselJ1(x: number): number {
  const ax = Math.abs(x);
  const value = ax <= SWITCH ? series(1, ax, -1) : asymptotic(1, ax).j;
  return x < 0 ? -value : value;
}

/** J_n(x) for a whole n and real x. */
export function besselJ(n: number, x: number): number {
  wholeOrder(n);
  if (n < 0) return (n % 2 === 0 ? 1 : -1) * besselJ(-n, x);
  if (x < 0) return (n % 2 === 0 ? 1 : -1) * besselJ(n, -x);
  if (n === 0) return besselJ0(x);
  if (n === 1) return besselJ1(x);
  if (x <= SWITCH) return series(n, x, -1);
  // J_n(x) = (1/2π) ∫₀^2π cos(nτ - x sin τ) dτ; the rule's error is about J_(N-n)(x), negligible for this N.
  const points = 2 * Math.ceil((n + x + 60) / 2);
  let sum = 0;
  for (let k = 0; k < points; k += 1) {
    const tau = (2 * Math.PI * k) / points;
    sum += Math.cos(n * tau - x * Math.sin(tau));
  }
  return sum / points;
}

function harmonic(k: number): number {
  let h = 0;
  for (let i = 1; i <= k; i += 1) h += 1 / i;
  return h;
}

export function besselY0(x: number): number {
  if (!(x > 0)) throw new NumError('domain', 'Y needs x > 0');
  if (x > SWITCH) return asymptotic(0, x).y;
  const q = (x * x) / 4;
  let term = 1;
  let sum = 0;
  for (let k = 1; k < 200; k += 1) {
    term *= -q / (k * k);
    const add = -term * harmonic(k);
    sum += add;
    if (Math.abs(add) <= 1e-17 * Math.abs(sum) && k * k > q) break;
  }
  return (2 / Math.PI) * ((Math.log(x / 2) + EULER_GAMMA) * besselJ0(x) + sum);
}

export function besselY1(x: number): number {
  if (!(x > 0)) throw new NumError('domain', 'Y needs x > 0');
  if (x > SWITCH) return asymptotic(1, x).y;
  const q = (-x * x) / 4;
  let term = 1;
  let sum = 0;
  for (let k = 0; k < 200; k += 1) {
    if (k > 0) term *= q / (k * (k + 1));
    const add = term * (harmonic(k) + harmonic(k + 1) - 2 * EULER_GAMMA);
    sum += add;
    if (k > 0 && Math.abs(add) <= 1e-17 * Math.abs(sum) && k * k > -q) break;
  }
  return (2 / Math.PI) * Math.log(x / 2) * besselJ1(x) - 2 / (Math.PI * x) - (x / 2 / Math.PI) * sum;
}

/** Y_n(x) for a whole n and x > 0. */
export function besselY(n: number, x: number): number {
  wholeOrder(n);
  if (n < 0) return (n % 2 === 0 ? 1 : -1) * besselY(-n, x);
  let y0 = besselY0(x);
  if (n === 0) return y0;
  let y1 = besselY1(x);
  for (let k = 1; k < n; k += 1) [y0, y1] = [y1, ((2 * k) / x) * y1 - y0];
  return y1;
}

/** I_n(x) for a whole n and real x. */
export function besselI(n: number, x: number): number {
  wholeOrder(n);
  const m = Math.abs(n);
  if (x < 0) return (m % 2 === 0 ? 1 : -1) * besselI(m, -x);
  if (x <= 30) return series(m, x, 1);
  // I_n(x) = (1/2π) ∫₀^2π e^(x cos τ) cos(nτ) dτ, with e^x taken out so the sum cannot overflow early.
  const points = 2 * Math.ceil((m + 12 * Math.sqrt(x) + 40) / 2);
  let sum = 0;
  for (let k = 0; k < points; k += 1) {
    const tau = (2 * Math.PI * k) / points;
    sum += Math.exp(x * (Math.cos(tau) - 1)) * Math.cos(m * tau);
  }
  return Math.exp(x) * (sum / points);
}

export const besselI0 = (x: number): number => besselI(0, x);
export const besselI1 = (x: number): number => besselI(1, x);

/** K_ν(x) = ∫₀^∞ e^(-x cosh t) cosh(νt) dt for ν = 0 or 1, by the trapezoidal rule with a step for 1e-16. */
function kIntegral(nu: 0 | 1, x: number): number {
  const d = Math.min(1.2, Math.sqrt(80 / x));
  const h = (2 * Math.PI * d) / (x * (1 - Math.cos(d)) + 38);
  // e^(-x) is taken out, so the terms stay near 1 for large x.
  const f = (t: number) => Math.exp(-x * (Math.cosh(t) - 1)) * (nu === 0 ? 1 : Math.cosh(t));
  let sum = f(0) / 2;
  for (let k = 1; k < 100000; k += 1) {
    const value = f(k * h);
    sum += value;
    if (value < 1e-18 * sum) break;
  }
  return Math.exp(-x) * h * sum;
}

/** K_n(x) for a whole n and x > 0. */
export function besselK(n: number, x: number): number {
  wholeOrder(n);
  if (!(x > 0)) throw new NumError('domain', 'K needs x > 0');
  const m = Math.abs(n);
  let k0 = kIntegral(0, x);
  if (m === 0) return k0;
  let k1 = kIntegral(1, x);
  for (let k = 1; k < m; k += 1) [k0, k1] = [k1, k0 + ((2 * k) / x) * k1];
  return k1;
}

export const besselK0 = (x: number): number => besselK(0, x);
export const besselK1 = (x: number): number => besselK(1, x);

/** J₀(z) or J₁(z) for complex z with |z| ≤ 60, by the power series. */
export function besselJComplex(n: 0 | 1, z: Complex): Complex {
  if (cabs(z) > 60) throw new NumError('domain', 'complex J needs |z| ≤ 60');
  const half = cx(z.re / 2, z.im / 2);
  const q = cmul(half, half);
  let term = n === 0 ? ONE : half;
  let sum = term;
  for (let k = 1; k < 400; k += 1) {
    term = cmul(term, cx(-q.re / (k * (k + n)), -q.im / (k * (k + n))));
    sum = cadd(sum, term);
    if (cabs(term) <= 1e-17 * cabs(sum) && k * k > cabs(q)) break;
  }
  return cabs(sum) === 0 ? ZERO : sum;
}

/** The Kelvin functions ber x and bei x: J₀(x e^(3πi/4)) = ber x + i bei x. */
export function kelvin(x: number): { ber: number; bei: number } {
  const z = besselJComplex(0, cx(-x / Math.SQRT2, x / Math.SQRT2));
  return { ber: z.re, bei: z.im };
}
