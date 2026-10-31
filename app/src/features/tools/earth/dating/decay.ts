// Radiometric ages, times in years. Decay constants carry their published sources. Ages come from daughter-to-parent
// ratios, isochron slopes, U-Pb concordia and discordia intercepts, and K-Ar or Ar-Ar ratios with a plateau check.
// Radiocarbon ages take a δ13C normalization and calibrate against a curve the student pastes.
import { check } from '../core/problem';

export interface DecaySystem {
  /** Decay constant per year. */
  lambda: number;
  source: string;
}

export const SYSTEMS = {
  rbsr: { lambda: 1.42e-11, source: 'Steiger and Jäger (1977)' },
  smnd: { lambda: 6.54e-12, source: 'Lugmair and Marti (1978)' },
  u238: { lambda: 1.55125e-10, source: 'Jaffey et al. (1971), as Steiger and Jäger (1977) adopt it' },
  u235: { lambda: 9.8485e-10, source: 'Jaffey et al. (1971), as Steiger and Jäger (1977) adopt it' },
  th232: { lambda: 4.9475e-11, source: 'Steiger and Jäger (1977)' },
  luhf: { lambda: 1.867e-11, source: 'Söderlund et al. (2004)' },
  reos: { lambda: 1.666e-11, source: 'Smoliar et al. (1996)' },
  k40: { lambda: 5.543e-10, source: 'Steiger and Jäger (1977), total 40K decay' },
} as const satisfies Record<string, DecaySystem>;

/** The 40K branch to 40Ar (electron capture), per year (Steiger and Jäger 1977). */
export const LAMBDA_EC = 0.581e-10;

export const halfLife = (lambda: number): number => Math.LN2 / lambda;

/** t = ln(1 + D* / P)/λ. */
export function ratioAge(ratio: number, lambda: number): number {
  check(lambda > 0, 'lambda');
  check(ratio > -1, 'ratio');
  check(ratio >= 0, 'negativeRatio');
  return Math.log1p(ratio) / lambda;
}

/** K-Ar: t = (1/λ) ln(1 + (λ/λe) ⁴⁰Ar* / ⁴⁰K). */
export function kArAge(ratio: number, lambda: number = SYSTEMS.k40.lambda, lambdaEc: number = LAMBDA_EC): number {
  check(lambda > 0 && lambdaEc > 0 && lambdaEc <= lambda, 'lambda');
  check(ratio >= 0, 'negativeRatio');
  return Math.log1p((lambda / lambdaEc) * ratio) / lambda;
}

/** Ar-Ar: J from a standard of known age, J = (e^(λt) − 1)/R_std. */
export const jFactor = (standardAge: number, standardRatio: number, lambda: number = SYSTEMS.k40.lambda): number => {
  check(standardAge > 0 && standardRatio > 0, 'standard');
  return Math.expm1(lambda * standardAge) / standardRatio;
};

/** Ar-Ar: t = (1/λ) ln(1 + J R) with R = ⁴⁰Ar* / ³⁹Ar_K. */
export function arArAge(ratio: number, j: number, lambda: number = SYSTEMS.k40.lambda): number {
  check(j > 0, 'standard');
  check(ratio >= 0, 'negativeRatio');
  return Math.log1p(j * ratio) / lambda;
}

export interface Step {
  /** The fraction of ³⁹Ar released in this step, any units (they are scaled to 100%). */
  gas: number;
  age: number;
  sigma: number;
}

export interface Plateau {
  from: number;
  to: number;
  /** Percent of ³⁹Ar in the plateau. */
  gas: number;
  age: number;
  sigma: number;
  mswd: number;
}

function weighted(steps: readonly Step[]): { age: number; sigma: number; mswd: number } {
  const w = steps.map((s) => 1 / (s.sigma * s.sigma));
  const sw = w.reduce((a, b) => a + b, 0);
  const age = steps.reduce((a, s, i) => a + w[i] * s.age, 0) / sw;
  const chi = steps.reduce((a, s, i) => a + w[i] * (s.age - age) ** 2, 0);
  return { age, sigma: Math.sqrt(1 / sw), mswd: steps.length > 1 ? chi / (steps.length - 1) : 0 };
}

/**
 * The plateau with the most gas: at least 3 contiguous steps holding at least 50% of the ³⁹Ar, each within 2σ of
 * the run's weighted mean age. Null when no run qualifies.
 */
export function plateau(steps: readonly Step[]): Plateau | null {
  check(steps.length >= 3, 'steps');
  for (const s of steps) check(s.gas >= 0 && s.sigma > 0, 'step');
  const total = steps.reduce((a, s) => a + s.gas, 0);
  check(total > 0, 'step');
  let best: Plateau | null = null;
  for (let i = 0; i < steps.length; i++)
    for (let j = i + 2; j < steps.length; j++) {
      const run = steps.slice(i, j + 1);
      const gas = (100 * run.reduce((a, s) => a + s.gas, 0)) / total;
      if (gas < 50) continue;
      const mean = weighted(run);
      if (!run.every((s) => Math.abs(s.age - mean.age) <= 2 * s.sigma)) continue;
      if (!best || gas > best.gas) best = { from: i + 1, to: j + 1, gas, ...mean };
    }
  return best;
}

/** The Libby mean life of radiocarbon, 8033 years (half-life 5568 years), used for conventional ages. */
export const LIBBY = 8033;

/** The δ13C normalization factor (0.975/(1 + δ13C/1000))², to the −25 per mil of wood. */
export function normalization(d13c: number): number {
  check(d13c > -1000, 'delta');
  return (0.975 / (1 + d13c / 1000)) ** 2;
}

export interface Radiocarbon {
  /** Conventional radiocarbon age in years BP (before 1950). */
  age: number;
  fn: number;
  pmc: number;
  /** Δ14C in per mil, when the year of growth or measurement is known (Stuiver and Polach 1977). */
  big?: number;
}

/** A conventional radiocarbon age, −8033 ln F_N, from the fraction modern and an optional δ13C. */
export function radiocarbon(f: number, d13c: number | null, year: number | null = null): Radiocarbon {
  check(f > 0, 'fraction');
  const fn = d13c === null ? f : f * normalization(d13c);
  const out: Radiocarbon = { age: -LIBBY * Math.log(fn), fn, pmc: 100 * fn };
  if (year !== null) out.big = (fn * Math.exp((1950 - year) / 8267) - 1) * 1000;
  return out;
}

export interface CurvePoint {
  /** Calendar age, years BP. */
  cal: number;
  c14: number;
  sigma: number;
}

export interface Calibration {
  /** Probability per calendar year, at whole years from `start`. */
  start: number;
  density: number[];
  /** Highest-density ranges holding 68.3% and 95.4% of the probability, as [older, younger] in years BP. */
  ranges68: [number, number][];
  ranges95: [number, number][];
  median: number;
}

/** Calibrates an age ± σ against a curve: P(t) ∝ N(age; μ(t), √(σ² + σc(t)²)), interpolated each calendar year. */
export function calibrate(age: number, sigma: number, curve: readonly CurvePoint[]): Calibration {
  check(sigma > 0, 'sigma');
  check(curve.length >= 2, 'curve');
  const sorted = [...curve].sort((a, b) => a.cal - b.cal);
  const start = Math.ceil(sorted[0].cal);
  const end = Math.floor(sorted[sorted.length - 1].cal);
  check(end - start <= 60000, 'curveLong');
  const density: number[] = [];
  let k = 0;
  for (let t = start; t <= end; t++) {
    while (k < sorted.length - 2 && sorted[k + 1].cal < t) k++;
    const a = sorted[k];
    const b = sorted[k + 1];
    const s = b.cal === a.cal ? 0 : (t - a.cal) / (b.cal - a.cal);
    const mu = a.c14 + s * (b.c14 - a.c14);
    const sc = a.sigma + s * (b.sigma - a.sigma);
    const total = sigma * sigma + sc * sc;
    density.push(Math.exp(-((age - mu) ** 2) / (2 * total)) / Math.sqrt(total));
  }
  const sum = density.reduce((x, y) => x + y, 0);
  check(sum > 1e-300, 'outside');
  const p = density.map((d) => d / sum);
  const ranges = (level: number): [number, number][] => {
    const order = p.map((v, i) => [v, i] as const).sort((x, y) => y[0] - x[0]);
    const keep = new Array<boolean>(p.length).fill(false);
    let acc = 0;
    for (const [v, i] of order) {
      if (acc >= level) break;
      keep[i] = true;
      acc += v;
    }
    const out: [number, number][] = [];
    let open = -1;
    keep.forEach((on, i) => {
      if (on && open < 0) open = i;
      if ((!on || i === keep.length - 1) && open >= 0) {
        const close = on ? i : i - 1;
        out.push([start + close, start + open]);
        open = -1;
      }
    });
    return out.sort((x, y) => y[0] - x[0]);
  };
  let acc = 0;
  let median = start;
  for (let i = 0; i < p.length; i++) {
    acc += p[i];
    if (acc >= 0.5) {
      median = start + i;
      break;
    }
  }
  return { start, density: p, ranges68: ranges(0.6827), ranges95: ranges(0.9545), median };
}

/** The Wetherill concordia point at age t: (²⁰⁷Pb* / ²³⁵U, ²⁰⁶Pb* / ²³⁸U). */
export const concordia = (t: number): [number, number] => [
  Math.expm1(SYSTEMS.u235.lambda * t),
  Math.expm1(SYSTEMS.u238.lambda * t),
];

/** The ages where the line y = a + b x meets concordia, from 0 to 4.6 Gyr, youngest first. */
export function concordiaIntercepts(a: number, b: number): number[] {
  const f = (t: number) => {
    const [x, y] = concordia(t);
    return y - a - b * x;
  };
  const out: number[] = [];
  // The grid is offset from round ages so a root on a grid point cannot slip between two cells.
  const step = 1e6;
  let t0 = 0;
  let f0 = f(0);
  if (Math.abs(f0) < 1e-12) out.push(0);
  for (let k = 0; (k + 0.37) * step <= 4.6e9; k++) {
    const t = (k + 0.37) * step;
    const f1 = f(t);
    if (f0 * f1 < 0) {
      let lo = t0;
      let hi = t;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (f(lo) * f(mid) <= 0) hi = mid;
        else lo = mid;
      }
      out.push((lo + hi) / 2);
    }
    t0 = t;
    f0 = f1;
  }
  return out;
}
