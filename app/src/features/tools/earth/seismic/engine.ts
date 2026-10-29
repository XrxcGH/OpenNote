// Seismology and seismic surveys: distance from the S-P time, the Wadati diagram, an epicenter by least squares,
// moment magnitude and energy, the Gutenberg-Richter b-value, refraction and reflection travel times, and wave
// speeds from elastic moduli. SI units (m, s, N·m, J) unless a name says otherwise.
import { check } from '../core/problem';

const LOG10E = Math.LOG10E;

/** Distance from the S-P time for constant P and S speeds: d = Δt / (1/Vs − 1/Vp). */
export function spDistance(dt: number, vp: number, vs: number): number {
  check(vp > 0 && vs > 0, 'speed');
  check(vp > vs, 'vpvs');
  check(dt >= 0, 'time');
  return dt / (1 / vs - 1 / vp);
}

export interface Line {
  slope: number;
  intercept: number;
  /** Standard errors of the slope and intercept, NaN with two points. */
  seSlope: number;
  seIntercept: number;
}

/** A least-squares straight line y = a + b x. */
export function fitLine(points: readonly (readonly [number, number])[]): Line {
  const n = points.length;
  check(n >= 2, 'points', { count: 2 });
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const sxx = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  check(sxx > 0, 'sameX');
  const slope = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx;
  const intercept = my - slope * mx;
  const sse = points.reduce((s, p) => s + (p[1] - intercept - slope * p[0]) ** 2, 0);
  const s2 = n > 2 ? sse / (n - 2) : Number.NaN;
  return {
    slope,
    intercept,
    seSlope: Math.sqrt(s2 / sxx),
    seIntercept: Math.sqrt(s2 * (1 / n + (mx * mx) / sxx)),
  };
}

/** The Wadati diagram: S−P time against P arrival. Its slope is Vp/Vs − 1 and it crosses zero at the origin time. */
export function wadati(arrivals: readonly (readonly [number, number])[]): {
  ratio: number;
  origin: number;
  line: Line;
} {
  const line = fitLine(arrivals.map(([tp, ts]) => [tp, ts - tp] as const));
  check(line.slope > 0, 'wadati');
  return { ratio: 1 + line.slope, origin: -line.intercept / line.slope, line };
}

export interface Station {
  x: number;
  y: number;
  /** Arrival time of the P wave. */
  t: number;
}

export interface Location {
  x: number;
  y: number;
  origin: number;
  rms: number;
  iterations: number;
  residuals: number[];
  distances: number[];
}

function solve3(a: number[][], b: number[]): number[] | null {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-300) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/**
 * An epicenter on a flat map from P arrivals at three or more stations and one P speed, by Gauss-Newton on the sum
 * of squared time residuals, with a Levenberg damping step whenever an update would make the fit worse.
 */
export function locate(stations: readonly Station[], v: number): Location {
  check(stations.length >= 3, 'stations');
  check(v > 0, 'speed');
  const n = stations.length;
  let x = stations.reduce((s, p) => s + p.x, 0) / n;
  let y = stations.reduce((s, p) => s + p.y, 0) / n;
  const spread = Math.max(...stations.map((s) => Math.hypot(s.x - x, s.y - y)), 1);
  let t0 = Math.min(...stations.map((s) => s.t)) - spread / (2 * v);
  const cost = (px: number, py: number, pt: number) =>
    stations.reduce((s, st) => s + (st.t - pt - Math.hypot(st.x - px, st.y - py) / v) ** 2, 0);
  let current = cost(x, y, t0);
  let lambda = 1e-3;
  let iterations = 0;
  let done = false;
  while (!done && iterations < 200) {
    iterations++;
    const jtj = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const jtr = [0, 0, 0];
    for (const st of stations) {
      const d = Math.max(Math.hypot(st.x - x, st.y - y), 1e-9 * spread);
      const j = [-(st.x - x) / (v * d), -(st.y - y) / (v * d), 1];
      const r = st.t - t0 - d / v;
      for (let a = 0; a < 3; a++) {
        jtr[a] += j[a] * r;
        for (let b = 0; b < 3; b++) jtj[a][b] += j[a] * j[b];
      }
    }
    let moved = false;
    for (let tries = 0; tries < 30 && !moved; tries++) {
      const damped = jtj.map((row, i) => row.map((value, k) => (i === k ? value * (1 + lambda) : value)));
      const step = solve3(damped, jtr);
      if (!step) break;
      const next = cost(x + step[0], y + step[1], t0 + step[2]);
      if (next <= current) {
        x += step[0];
        y += step[1];
        t0 += step[2];
        const gain = current - next;
        current = next;
        lambda = Math.max(lambda / 10, 1e-12);
        moved = true;
        done = gain <= 1e-24 + current * 1e-15 && Math.hypot(step[0], step[1]) < 1e-9 * spread;
      } else lambda *= 10;
    }
    if (!moved) done = true;
  }
  check(Number.isFinite(x) && Number.isFinite(y), 'locate');
  const distances = stations.map((st) => Math.hypot(st.x - x, st.y - y));
  const residuals = stations.map((st, i) => st.t - t0 - distances[i] / v);
  return {
    x,
    y,
    origin: t0,
    rms: Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n),
    iterations,
    residuals,
    distances,
  };
}

/** Seismic moment M₀ = μ A D. */
export function moment(rigidity: number, area: number, slip: number): number {
  check(rigidity > 0 && area > 0 && slip > 0, 'positive');
  return rigidity * area * slip;
}

/** Moment magnitude Mw = (2/3)(log₁₀ M₀ − 9.1) with M₀ in N·m, and the radiated energy log₁₀ E = 1.5 M + 4.8. */
export function magnitude(m0: number): { mw: number; logEnergy: number } {
  check(m0 > 0, 'positive');
  const mw = (2 / 3) * (Math.log10(m0) - 9.1);
  return { mw, logEnergy: 1.5 * mw + 4.8 };
}

/** The moment for a moment magnitude: the inverse of `magnitude`. */
export const momentOf = (mw: number): number => 10 ** (1.5 * mw + 9.1);

export interface BValue {
  b: number;
  /** Shi and Bolt (1982) standard error. */
  se: number;
  /** Aki (1965) standard error b/√N. */
  seAki: number;
  a: number;
  count: number;
  below: number;
  mean: number;
}

/** Aki's maximum-likelihood b-value with Utsu's correction for bins of width dM, from magnitudes at or above Mc. */
export function bValue(magnitudes: readonly number[], mc: number, bin: number): BValue {
  check(bin >= 0, 'bin');
  const used = magnitudes.filter((m) => m >= mc - 1e-9);
  check(used.length >= 2, 'magnitudes');
  const n = used.length;
  const mean = used.reduce((s, m) => s + m, 0) / n;
  const gap = mean - (mc - bin / 2);
  check(gap > 0, 'magnitudes');
  const b = LOG10E / gap;
  const variance = used.reduce((s, m) => s + (m - mean) ** 2, 0) / (n * (n - 1));
  return {
    b,
    se: 2.3 * b * b * Math.sqrt(variance),
    seAki: b / Math.sqrt(n),
    a: Math.log10(n) + b * mc,
    count: n,
    below: magnitudes.length - n,
    mean,
  };
}

/** Counts of events at or above each magnitude bin, for a Gutenberg-Richter plot. */
export function cumulative(magnitudes: readonly number[], mc: number, bin: number): [number, number][] {
  const step = bin > 0 ? bin : 0.1;
  const top = Math.max(...magnitudes);
  const out: [number, number][] = [];
  for (let m = mc; m <= top + 1e-9; m += step) {
    const count = magnitudes.filter((x) => x >= m - 1e-9).length;
    if (count > 0) out.push([Number(m.toFixed(6)), count]);
  }
  return out;
}

export interface Refraction {
  crossover: number;
  intercept: number;
  critical: number;
  /** Critical angle in degrees. */
  angle: number;
}

/** A layer of speed V1 and thickness h over a faster half-space of speed V2. */
export function refraction(v1: number, v2: number, h: number): Refraction {
  check(v1 > 0 && v2 > 0, 'speed');
  check(v2 > v1, 'faster');
  check(h > 0, 'thickness');
  const angle = Math.asin(v1 / v2);
  return {
    crossover: 2 * h * Math.sqrt((v2 + v1) / (v2 - v1)),
    intercept: (2 * h * Math.sqrt(v2 * v2 - v1 * v1)) / (v1 * v2),
    critical: 2 * h * Math.tan(angle),
    angle: (angle * 180) / Math.PI,
  };
}

/** Thickness from the intercept time: h = tᵢ V1 V2 / (2 √(V2² − V1²)). */
export function depthFromIntercept(ti: number, v1: number, v2: number): number {
  check(v2 > v1 && v1 > 0, 'faster');
  check(ti > 0, 'interceptTime');
  return (ti * v1 * v2) / (2 * Math.sqrt(v2 * v2 - v1 * v1));
}

export interface Picks {
  v1: number;
  v2: number;
  intercept: number;
  depth: number;
  direct: Line;
  head: Line;
}

/** Speeds and depth from picked first arrivals: direct-wave picks (branch 1) and head-wave picks (branch 2). */
export function fromPicks(picks: readonly (readonly [number, number, number])[]): Picks {
  const direct = fitLine(picks.filter((p) => p[2] === 1).map(([x, t]) => [x, t] as const));
  const head = fitLine(picks.filter((p) => p[2] === 2).map(([x, t]) => [x, t] as const));
  check(direct.slope > 0 && head.slope > 0, 'slopes');
  const v1 = 1 / direct.slope;
  const v2 = 1 / head.slope;
  check(v2 > v1, 'faster');
  check(head.intercept > 0, 'interceptTime');
  return { v1, v2, intercept: head.intercept, depth: depthFromIntercept(head.intercept, v1, v2), direct, head };
}

/** Two-way time of a flat reflector at offset x: t(x) = √(t₀² + x²/V²), and the normal moveout t − t₀. */
export function nmo(t0: number, x: number, v: number): { t: number; moveout: number } {
  check(t0 > 0, 'time');
  check(v > 0, 'speed');
  const t = Math.sqrt(t0 * t0 + (x * x) / (v * v));
  return { t, moveout: t - t0 };
}

/** Dix interval speed between two reflections: √((V2² t2 − V1² t1) / (t2 − t1)), and the interval thickness. */
export function dix(t1: number, v1: number, t2: number, v2: number): { speed: number; thickness: number } {
  check(t2 > t1 && t1 >= 0, 'order');
  check(v1 > 0 && v2 > 0, 'speed');
  const square = (v2 * v2 * t2 - v1 * v1 * t1) / (t2 - t1);
  check(square > 0, 'dix');
  const speed = Math.sqrt(square);
  return { speed, thickness: (speed * (t2 - t1)) / 2 };
}

/** P and S speeds from the bulk modulus K, the shear modulus μ, and the density ρ, with Poisson's ratio. */
export function waveSpeeds(bulk: number, shear: number, density: number) {
  check(bulk > 0 && shear >= 0 && density > 0, 'moduli');
  const vp = Math.sqrt((bulk + (4 / 3) * shear) / density);
  const vs = Math.sqrt(shear / density);
  const poisson = (3 * bulk - 2 * shear) / (2 * (3 * bulk + shear));
  return { vp, vs, ratio: shear > 0 ? vp / vs : Number.POSITIVE_INFINITY, poisson };
}
