// Natural and step responses of first- and second-order circuits, in closed form. The unknown x(t) is the capacitor
// voltage or the inductor current; it moves from x(0) toward its final value xf. Everything is in SI units.
import { fail } from '../shared';

export interface FirstOrder {
  tau: number;
  x0: number;
  xf: number;
  at(t: number): number;
}

/** x(t) = xf + (x0 − xf) e^(−t/τ). */
export function firstOrder(tau: number, x0: number, xf: number): FirstOrder {
  if (!(tau > 0)) return fail('positive', { field: 'resistance' });
  return { tau, x0, xf, at: (t) => xf + (x0 - xf) * Math.exp(-t / tau) };
}

export type Damping = 'underdamped' | 'overdamped' | 'critical';

export interface SecondOrder {
  alpha: number;
  omega0: number;
  /** ω_d for an underdamped circuit, else 0. */
  omegaD: number;
  damping: Damping;
  /** The roots of s² + 2α s + ω₀² (real for over and critical damping). */
  s1: number;
  s2: number;
  /** The constants of the natural response (see `form`). */
  a: number;
  b: number;
  x0: number;
  dx0: number;
  xf: number;
  at(t: number): number;
  slope(t: number): number;
}

/** Two numbers are the same circuit to within rounding of the inputs. */
const SAME = 1e-9;

/** The second-order response with natural part A,B fixed by x(0) and x'(0), and final value xf. */
export function secondOrder(alpha: number, omega0: number, x0: number, dx0: number, xf: number): SecondOrder {
  if (!(alpha >= 0) || !(omega0 > 0)) return fail('positive', { field: 'resistance' });
  const n0 = x0 - xf;
  if (Math.abs(alpha - omega0) <= SAME * omega0) {
    const a = n0;
    const b = dx0 + alpha * n0;
    return {
      alpha,
      omega0,
      omegaD: 0,
      damping: 'critical',
      s1: -alpha,
      s2: -alpha,
      a,
      b,
      x0,
      dx0,
      xf,
      at: (t) => xf + (a + b * t) * Math.exp(-alpha * t),
      slope: (t) => (b - alpha * (a + b * t)) * Math.exp(-alpha * t),
    };
  }
  if (alpha < omega0) {
    const wd = Math.sqrt(omega0 * omega0 - alpha * alpha);
    const a = n0;
    const b = (dx0 + alpha * n0) / wd;
    return {
      alpha,
      omega0,
      omegaD: wd,
      damping: 'underdamped',
      s1: -alpha,
      s2: -alpha,
      a,
      b,
      x0,
      dx0,
      xf,
      at: (t) => xf + Math.exp(-alpha * t) * (a * Math.cos(wd * t) + b * Math.sin(wd * t)),
      slope: (t) =>
        Math.exp(-alpha * t) * ((-alpha * a + wd * b) * Math.cos(wd * t) + (-alpha * b - wd * a) * Math.sin(wd * t)),
    };
  }
  const root = Math.sqrt(alpha * alpha - omega0 * omega0);
  const s1 = -alpha + root;
  // −α − root can lose digits when α ≫ ω₀; the product of the roots is ω₀², which keeps both accurate.
  const s2 = -alpha - root;
  const s1Accurate = alpha > 0 ? (omega0 * omega0) / s2 : s1;
  const a = (dx0 - s2 * n0) / (s1Accurate - s2);
  const b = n0 - a;
  return {
    alpha,
    omega0,
    omegaD: 0,
    damping: 'overdamped',
    s1: s1Accurate,
    s2,
    a,
    b,
    x0,
    dx0,
    xf,
    at: (t) => xf + a * Math.exp(s1Accurate * t) + b * Math.exp(s2 * t),
    slope: (t) => a * s1Accurate * Math.exp(s1Accurate * t) + b * s2 * Math.exp(s2 * t),
  };
}

export interface Peak {
  time: number;
  value: number;
}

/**
 * The first extreme of the response that goes beyond the final value (an overshoot), or null when the response
 * approaches its final value without passing it. Found where the slope first changes sign.
 */
export function firstPeak(r: SecondOrder): Peak | null {
  const slowest = r.damping === 'overdamped' ? Math.abs(r.s1) : r.alpha || r.omega0;
  const horizon = 12 / slowest;
  const steps = 40_000;
  let previousT = 0;
  let previous = r.slope(0);
  for (let i = 1; i <= steps; i++) {
    const t = (horizon * i) / steps;
    const slope = r.slope(t);
    if (previous !== 0 && slope !== 0 && Math.sign(slope) !== Math.sign(previous)) {
      let lo = previousT;
      let hi = t;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(r.slope(mid)) === Math.sign(previous)) lo = mid;
        else hi = mid;
      }
      const time = (lo + hi) / 2;
      const value = r.at(time);
      const beyond = (value - r.xf) * Math.sign(r.xf - r.x0 || r.dx0 || 1) > 0;
      return beyond || r.damping === 'underdamped' ? { time, value } : null;
    }
    previousT = t;
    previous = slope;
  }
  return null;
}

/** Samples of x(t) for a plot: `count` points from 0 to `horizon`. */
export function sample(at: (t: number) => number, horizon: number, count = 240): { x: number[]; y: number[] } {
  const x = Array.from({ length: count }, (_, i) => (horizon * i) / (count - 1));
  return { x, y: x.map(at) };
}
