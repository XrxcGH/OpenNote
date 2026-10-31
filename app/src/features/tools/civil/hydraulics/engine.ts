// Hydrology and open channels: the methods behind the calculations in ./calcs. SI throughout (m, s, m³/s) except
// where a method is defined in US units (the curve-number runoff in inches, the TR-55 lag in feet and hours).
import { brent, erfc } from '../core/num';
import { CivilError, need } from '../core/types';

/** Standard gravity, m/s². */
export const G = 9.80665;

// ---------------------------------------------------------------------------------------------------------------
// Rainfall and runoff

/** Peak flow by the rational method, m³/s, with i in mm/h and A in km². */
export function rational(C: number, i: number, A: number): number {
  need(C > 0 && C <= 1, 'hydraulics.errors.runoffC');
  need(i > 0, 'errors.positive', { name: '~hydraulics.f.i' });
  need(A > 0, 'errors.positive', { name: '~hydraulics.f.A' });
  return 0.278 * C * i * A;
}

/** Intensity from typed IDF parameters, i = a/(t + b)^c, with t in minutes. */
export function idf(a: number, b: number, c: number, t: number): number {
  need(a > 0 && c > 0, 'errors.positive', { name: '~hydraulics.f.idfA' });
  need(t + b > 0, 'hydraulics.errors.idf');
  return a / (t + b) ** c;
}

/** Kirpich's time of concentration in minutes, t = 0.0195 L^0.77 S^-0.385, with L in m. The slope S is in m/m. */
export function kirpich(L: number, S: number): number {
  need(L > 0, 'errors.positive', { name: '~hydraulics.f.L' });
  need(S > 0, 'errors.positive', { name: '~hydraulics.f.S' });
  return 0.0195 * L ** 0.77 * S ** -0.385;
}

/** NRCS curve-number runoff, inches, with Ia = λ S (λ 0.2 by default). */
export function curveNumber(P: number, CN: number, lambda = 0.2) {
  need(P >= 0, 'errors.nonNegative', { name: '~hydraulics.f.P' });
  need(CN > 30 && CN <= 100, 'hydraulics.errors.cn');
  const S = 1000 / CN - 10;
  const Ia = lambda * S;
  const Q = P > Ia ? (P - Ia) ** 2 / (P - Ia + S) : 0;
  return { S, Ia, Q };
}

/** The NRCS lag, hours: L = ℓ^0.8 (S + 1)^0.7 / (1900 Y^0.5), ℓ in ft and Y the slope in percent; tc = L/0.6. */
export function nrcsLag(lengthFt: number, CN: number, slopePct: number) {
  need(lengthFt > 0, 'errors.positive', { name: '~hydraulics.f.L' });
  need(slopePct > 0, 'errors.positive', { name: '~hydraulics.f.S' });
  const S = 1000 / CN - 10;
  const lag = (lengthFt ** 0.8 * (S + 1) ** 0.7) / (1900 * Math.sqrt(slopePct));
  return { lag, tc: lag / 0.6 };
}

/** Direct runoff by discrete convolution of a unit hydrograph with blocks of excess rain. */
export function convolve(uh: readonly number[], excess: readonly number[]): number[] {
  need(uh.length >= 2, 'errors.fewPoints', { count: 2 });
  need(excess.length >= 1, 'errors.noRows');
  need(
    excess.every((p) => p >= 0),
    'hydraulics.errors.negativeRain',
  );
  const out = new Array<number>(uh.length + excess.length - 1).fill(0);
  excess.forEach((p, i) => uh.forEach((u, j) => (out[i + j]! += p * u)));
  return out;
}

/** A unit hydrograph of duration D (k steps) changed to duration D′ (k′ steps) through the S-curve. */
export function sCurve(uh: readonly number[], k: number, kNew: number): { S: number[]; U: number[] } {
  need(Number.isInteger(k) && Number.isInteger(kNew) && k >= 1 && kNew >= 1, 'hydraulics.errors.durations');
  const n = uh.length + 4 * k * Math.ceil(uh.length / k);
  const S: number[] = [];
  for (let t = 0; t < n; t++) {
    let s = 0;
    for (let lag = t; lag >= 0; lag -= k) s += uh[lag] ?? 0;
    S.push(s);
  }
  const U = S.map((s, t) => ((s - (t >= kNew ? S[t - kNew]! : 0)) * k) / kNew);
  // Trim the tail where the new hydrograph has returned to zero.
  let end = U.length;
  while (end > 1 && Math.abs(U[end - 1]!) < 1e-9 * Math.max(...U.map(Math.abs))) end--;
  return { S: S.slice(0, end), U: U.slice(0, end) };
}

// ---------------------------------------------------------------------------------------------------------------
// Routing

export function muskingumCoefficients(K: number, X: number, dt: number) {
  need(K > 0 && dt > 0, 'errors.positive', { name: '~hydraulics.f.K' });
  need(X >= 0 && X <= 0.5, 'hydraulics.errors.muskX');
  const D = K * (1 - X) + dt / 2;
  const C0 = (-K * X + dt / 2) / D;
  const C1 = (K * X + dt / 2) / D;
  const C2 = (K * (1 - X) - dt / 2) / D;
  return { C0, C1, C2, stable: C0 >= 0 && C2 >= 0 };
}

export function muskingum(inflow: readonly number[], K: number, X: number, dt: number) {
  need(inflow.length >= 2, 'errors.fewPoints', { count: 2 });
  const c = muskingumCoefficients(K, X, dt);
  const out = [inflow[0]!];
  for (let i = 1; i < inflow.length; i++) out.push(c.C0 * inflow[i]! + c.C1 * inflow[i - 1]! + c.C2 * out[i - 1]!);
  return { ...c, outflow: out };
}

/** Storage-indication (modified Puls) routing through a reservoir with a table of storage and outflow. */
export function puls(inflow: readonly number[], table: readonly (readonly number[])[], dt: number, O0?: number) {
  need(inflow.length >= 2, 'errors.fewPoints', { count: 2 });
  need(table.length >= 2, 'errors.fewPoints', { count: 2 });
  need(dt > 0, 'errors.positive', { name: '~hydraulics.f.dt' });
  for (let i = 1; i < table.length; i++)
    need(table[i]![0]! > table[i - 1]![0]! && table[i]![1]! >= table[i - 1]![1]!, 'hydraulics.errors.storage');
  const indication = table.map((r) => (2 * r[0]!) / dt + r[1]!);
  const outAt = (si: number) => {
    need(si <= indication[indication.length - 1]!, 'hydraulics.errors.overtop');
    let k = 1;
    while (k < indication.length - 1 && indication[k]! < si) k++;
    const [a, b] = [indication[k - 1]!, indication[k]!];
    const f = Math.max(0, (si - a) / (b - a));
    return table[k - 1]![1]! + f * (table[k]![1]! - table[k - 1]![1]!);
  };
  const storageOf = (O: number) => {
    let k = 1;
    while (k < table.length - 1 && table[k]![1]! < O) k++;
    const [a, b] = [table[k - 1]!, table[k]!];
    const f = b[1]! === a[1]! ? 0 : (O - a[1]!) / (b[1]! - a[1]!);
    return a[0]! + f * (b[0]! - a[0]!);
  };
  const out = [O0 ?? table[0]![1]!];
  let S = storageOf(out[0]!);
  const storage = [S];
  for (let i = 1; i < inflow.length; i++) {
    const si = inflow[i - 1]! + inflow[i]! + (2 * S) / dt - out[i - 1]!;
    const O = outAt(si);
    out.push(O);
    S = ((si - O) * dt) / 2;
    storage.push(S);
  }
  return { outflow: out, storage };
}

/** A detention basin of plan area As with an orifice and a weir above it, by RK4 on dh/dt = (I − O)/As. */
export function detention(
  inflow: readonly (readonly number[])[],
  As: number,
  orifice: { Cd: number; area: number },
  weir: { Cw: number; L: number; crest: number },
) {
  need(inflow.length >= 2, 'errors.fewPoints', { count: 2 });
  need(As > 0, 'errors.positive', { name: '~hydraulics.f.As' });
  need(orifice.Cd > 0 && orifice.area >= 0 && weir.Cw >= 0 && weir.L >= 0, 'hydraulics.errors.outlet');
  const t = inflow.map((r) => r[0]!);
  for (let i = 1; i < t.length; i++) need(t[i]! > t[i - 1]!, 'hydraulics.errors.rising');
  const I = (time: number) => {
    if (time <= t[0]!) return inflow[0]![1]!;
    for (let i = 1; i < t.length; i++)
      if (time <= t[i]!)
        return inflow[i - 1]![1]! + ((time - t[i - 1]!) / (t[i]! - t[i - 1]!)) * (inflow[i]![1]! - inflow[i - 1]![1]!);
    return inflow[inflow.length - 1]![1]!;
  };
  const O = (h: number) =>
    (h > 0 ? orifice.Cd * orifice.area * Math.sqrt(2 * G * h) : 0) +
    (h > weir.crest ? weir.Cw * weir.L * (h - weir.crest) ** 1.5 : 0);
  const f = (time: number, h: number) => (I(time) - O(Math.max(0, h))) / As;
  const t0 = t[0]!;
  const t1 = t[t.length - 1]! * 2 - t0;
  const steps = 4000;
  const dt = (t1 - t0) / steps;
  let h = 0;
  const points: [number, number, number, number][] = [[t0, I(t0), O(0), 0]];
  let peakO = 0;
  let peakH = 0;
  for (let k = 0; k < steps; k++) {
    const tk = t0 + k * dt;
    const k1 = f(tk, h);
    const k2 = f(tk + dt / 2, h + (dt / 2) * k1);
    const k3 = f(tk + dt / 2, h + (dt / 2) * k2);
    const k4 = f(tk + dt, h + dt * k3);
    h = Math.max(0, h + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4));
    const o = O(h);
    peakO = Math.max(peakO, o);
    peakH = Math.max(peakH, h);
    if ((k + 1) % 40 === 0) points.push([tk + dt, I(tk + dt), o, h]);
  }
  const peakI = Math.max(...inflow.map((r) => r[1]!));
  return { points, peakI, peakO, peakH, volume: peakH * As };
}

// ---------------------------------------------------------------------------------------------------------------
// Flood frequency

/** Gumbel (EV1) frequency factor for return period T. */
export function gumbelK(T: number): number {
  need(T > 1, 'hydraulics.errors.period');
  return -(Math.sqrt(6) / Math.PI) * (0.5772 + Math.log(Math.log(T / (T - 1))));
}

/** The chance of at least one T-year event in n years. */
export const risk = (T: number, n: number): number => {
  need(T > 1 && n >= 1, 'hydraulics.errors.period');
  return 1 - (1 - 1 / T) ** n;
};

/** The standard normal quantile (Acklam's rational approximation, refined by one Halley step). */
export function normalQuantile(p: number): number {
  need(p > 0 && p < 1, 'hydraulics.errors.period');
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x: number;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  // One Halley step against the error function.
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/**
 * The Pearson III frequency factor by the Wilson-Hilferty transformation of the normal quantile. It reads high by
 * up to about 0.015 against the published table for |skew| <= 1, and the error grows past that.
 */
export function pearsonK(T: number, skew: number): number {
  const z = normalQuantile(1 - 1 / T);
  if (Math.abs(skew) < 1e-9) return z;
  const k = skew / 6;
  return (2 / skew) * ((1 + z * k - k * k) ** 3 - 1);
}

export interface FrequencyFit {
  n: number;
  mean: number;
  sd: number;
  /** Mean, standard deviation, and skew of log₁₀ Q, for log-Pearson III. */
  logMean: number;
  logSd: number;
  logSkew: number;
  /** Ranked data with Weibull plotting positions: Q, rank, exceedance probability, return period. */
  ranked: [number, number, number, number][];
}

export function frequencyFit(peaks: readonly number[]): FrequencyFit {
  need(peaks.length >= 3, 'errors.fewPoints', { count: 3 });
  need(
    peaks.every((q) => q > 0),
    'hydraulics.errors.peaks',
  );
  const n = peaks.length;
  const mean = peaks.reduce((s, q) => s + q, 0) / n;
  const sd = Math.sqrt(peaks.reduce((s, q) => s + (q - mean) ** 2, 0) / (n - 1));
  const logs = peaks.map(Math.log10);
  const logMean = logs.reduce((s, v) => s + v, 0) / n;
  const logSd = Math.sqrt(logs.reduce((s, v) => s + (v - logMean) ** 2, 0) / (n - 1));
  const logSkew =
    logSd > 0 ? (n * logs.reduce((s, v) => s + (v - logMean) ** 3, 0)) / ((n - 1) * (n - 2) * logSd ** 3) : 0;
  const sorted = [...peaks].sort((a, b) => b - a);
  const ranked = sorted.map(
    (q, i) => [q, i + 1, (i + 1) / (n + 1), (n + 1) / (i + 1)] as [number, number, number, number],
  );
  return { n, mean, sd, logMean, logSd, logSkew, ranked };
}

// ---------------------------------------------------------------------------------------------------------------
// Erosion

/** The USLE slope factor of Wischmeier and Smith (1978), with λ in m and the slope in percent. */
export function usleLS(lambda: number, slopePct: number): number {
  need(lambda > 0, 'errors.positive', { name: '~hydraulics.f.lambda' });
  need(slopePct > 0 && slopePct < 100, 'hydraulics.errors.slopePct');
  const theta = Math.atan(slopePct / 100);
  const m = slopePct >= 5 ? 0.5 : slopePct >= 3.5 ? 0.4 : slopePct >= 1 ? 0.3 : 0.2;
  const s = Math.sin(theta);
  return (lambda / 22.13) ** m * (65.41 * s * s + 4.56 * s + 0.065);
}

// ---------------------------------------------------------------------------------------------------------------
// Open channels

export type Section =
  | { kind: 'rectangle'; b: number }
  | { kind: 'trapezoid'; b: number; z: number }
  | { kind: 'triangle'; z: number }
  | { kind: 'circle'; D: number };

export interface Geometry {
  A: number;
  P: number;
  T: number;
  R: number;
  /** Hydraulic depth A/T. */
  Dh: number;
}

export function geometry(s: Section, y: number): Geometry {
  need(y > 0, 'errors.positive', { name: '~hydraulics.f.y' });
  let A: number;
  let P: number;
  let T: number;
  switch (s.kind) {
    case 'rectangle':
      need(s.b > 0, 'errors.positive', { name: '~hydraulics.f.b' });
      [A, P, T] = [s.b * y, s.b + 2 * y, s.b];
      break;
    case 'trapezoid':
      need(s.b >= 0 && s.z >= 0 && s.b + s.z > 0, 'hydraulics.errors.section');
      [A, P, T] = [(s.b + s.z * y) * y, s.b + 2 * y * Math.sqrt(1 + s.z * s.z), s.b + 2 * s.z * y];
      break;
    case 'triangle':
      need(s.z > 0, 'errors.positive', { name: '~hydraulics.f.z' });
      [A, P, T] = [s.z * y * y, 2 * y * Math.sqrt(1 + s.z * s.z), 2 * s.z * y];
      break;
    case 'circle': {
      need(s.D > 0, 'errors.positive', { name: '~hydraulics.f.D' });
      need(y < s.D, 'hydraulics.errors.full');
      const th = 2 * Math.acos(1 - (2 * y) / s.D);
      [A, P, T] = [((th - Math.sin(th)) * s.D * s.D) / 8, (th * s.D) / 2, s.D * Math.sin(th / 2)];
      break;
    }
  }
  return { A, P, T, R: A / P, Dh: A / T };
}

/** Manning's flow, SI: Q = (1/n) A R^(2/3) S^(1/2). */
export function manning(s: Section, y: number, n: number, S: number): number {
  need(n > 0, 'errors.positive', { name: '~hydraulics.f.n' });
  need(S > 0, 'errors.positive', { name: '~hydraulics.f.S' });
  const g = geometry(s, y);
  return (g.A * g.R ** (2 / 3) * Math.sqrt(S)) / n;
}

function depthCap(s: Section): number {
  return s.kind === 'circle' ? s.D * 0.938 : Infinity;
}

/** The normal depth for Q (for a circle, below the depth of greatest flow). */
export function normalDepth(s: Section, Q: number, n: number, S: number): number {
  need(Q > 0, 'errors.positive', { name: '~hydraulics.f.Q' });
  const cap = depthCap(s);
  const f = (y: number) => manning(s, y, n, S) - Q;
  let hi = Number.isFinite(cap) ? cap : 1;
  if (!Number.isFinite(cap)) for (let i = 0; i < 200 && f(hi) < 0; i++) hi *= 2;
  need(f(hi) >= 0, 'hydraulics.errors.capacity');
  return brent(f, 1e-9, hi, 1e-13);
}

/** The critical depth, where Q² T / (g A³) = 1. */
export function criticalDepth(s: Section, Q: number): number {
  need(Q > 0, 'errors.positive', { name: '~hydraulics.f.Q' });
  const f = (y: number) => {
    const g = geometry(s, y);
    return (Q * Q * g.T) / (G * g.A ** 3) - 1;
  };
  const cap = s.kind === 'circle' ? s.D * 0.999 : Infinity;
  let hi = Number.isFinite(cap) ? cap : 1;
  if (!Number.isFinite(cap)) for (let i = 0; i < 200 && f(hi) > 0; i++) hi *= 2;
  need(f(hi) <= 0, 'hydraulics.errors.capacity');
  return brent(f, 1e-9, hi, 1e-13);
}

export const froude = (s: Section, Q: number, y: number): number => {
  const g = geometry(s, y);
  return Q / (g.A * Math.sqrt(G * g.Dh));
};

export const specificEnergy = (s: Section, Q: number, y: number): number =>
  y + (Q * Q) / (2 * G * geometry(s, y).A ** 2);

/** A hydraulic jump in a rectangular channel with unit discharge q. */
export function jump(q: number, y1: number) {
  need(q > 0, 'errors.positive', { name: '~hydraulics.f.q' });
  need(y1 > 0, 'errors.positive', { name: '~hydraulics.f.y1' });
  const Fr1 = q / (y1 * Math.sqrt(G * y1));
  need(Fr1 > 1, 'hydraulics.errors.subcritical');
  const y2 = (y1 / 2) * (Math.sqrt(1 + 8 * Fr1 * Fr1) - 1);
  const loss = (y2 - y1) ** 3 / (4 * y1 * y2);
  const Fr2 = q / (y2 * Math.sqrt(G * y2));
  const E1 = y1 + (q * q) / (2 * G * y1 * y1);
  return { Fr1, y2, loss, Fr2, E1, efficiency: (E1 - loss) / E1 };
}

export type ProfileType = 'M1' | 'M2' | 'M3' | 'S1' | 'S2' | 'S3' | 'C1' | 'C3' | 'H2' | 'H3' | 'A2' | 'A3';

/** The class of a gradually varied flow profile from the slope and the depths. */
export function classify(S0: number, y: number, yn: number | null, yc: number): ProfileType {
  if (S0 < 0) return y > yc ? 'A2' : 'A3';
  if (S0 === 0 || yn === null) return y > yc ? 'H2' : 'H3';
  if (Math.abs(yn - yc) < 1e-9 * yc) return y > yc ? 'C1' : 'C3';
  if (yn > yc) return y > yn ? 'M1' : y > yc ? 'M2' : 'M3';
  return y > yc ? 'S1' : y > yn ? 'S2' : 'S3';
}

/** The direct step method from the control depth y1 toward y2, in N steps; x runs upstream when negative. */
export function directStep(s: Section, Q: number, n: number, S0: number, y1: number, y2: number, N = 40) {
  need(n > 0, 'errors.positive', { name: '~hydraulics.f.n' });
  need(N >= 2 && N <= 400, 'hydraulics.errors.steps');
  need(y1 > 0 && y2 > 0 && y1 !== y2, 'hydraulics.errors.depths');
  const Sf = (y: number) => {
    const g = geometry(s, y);
    return ((n * Q) / (g.A * g.R ** (2 / 3))) ** 2;
  };
  const E = (y: number) => specificEnergy(s, Q, y);
  const points: [number, number][] = [[0, y1]];
  let x = 0;
  for (let i = 1; i <= N; i++) {
    const ya = y1 + ((y2 - y1) * (i - 1)) / N;
    const yb = y1 + ((y2 - y1) * i) / N;
    const sf = (Sf(ya) + Sf(yb)) / 2;
    need(Math.abs(S0 - sf) > 1e-15, 'hydraulics.errors.normal');
    x += (E(yb) - E(ya)) / (S0 - sf);
    points.push([x, yb]);
  }
  return { points, length: x };
}

/** Sharp-crested weirs and orifices with typed discharge coefficients. */
export function weirFlow(kind: 'rect' | 'vnotch' | 'orifice', Cd: number, H: number, size: number): number {
  need(Cd > 0 && Cd <= 1.2, 'hydraulics.errors.cd');
  need(H > 0, 'errors.positive', { name: '~hydraulics.f.H' });
  need(size > 0, 'errors.positive', { name: '~hydraulics.f.size' });
  if (kind === 'rect') return Cd * (2 / 3) * Math.sqrt(2 * G) * size * H ** 1.5;
  if (kind === 'vnotch') {
    need(size < 180, 'hydraulics.errors.notch');
    return Cd * (8 / 15) * Math.sqrt(2 * G) * Math.tan((size * Math.PI) / 360) * H ** 2.5;
  }
  return Cd * size * Math.sqrt(2 * G * H);
}

// ---------------------------------------------------------------------------------------------------------------
// Pipe networks

export interface NetworkPipe {
  /** h = k Q |Q|^(e - 1). */
  k: number;
  e: number;
  Q0: number;
  /** Signs of the pipe in each loop: +1 clockwise, −1 counterclockwise, 0 not in the loop. */
  loops: readonly number[];
}

/** Hardy Cross loop corrections, ΔQ = −Σ h / (e Σ |h/Q|), until every correction is below tol. */
export function hardyCross(pipes: readonly NetworkPipe[], tol = 1e-10, maxIter = 500) {
  need(pipes.length >= 2, 'errors.fewPoints', { count: 2 });
  const nLoops = Math.max(...pipes.map((p) => p.loops.length));
  for (const p of pipes) {
    need(p.k > 0, 'errors.positive', { name: '~hydraulics.f.kCol' });
    need(p.e >= 1 && p.e <= 3, 'hydraulics.errors.exponent');
    need(
      p.loops.every((s) => s === 0 || s === 1 || s === -1),
      'hydraulics.errors.loopSign',
    );
  }
  const used = Array.from({ length: nLoops }, (_, j) => pipes.some((p) => (p.loops[j] ?? 0) !== 0));
  need(used.some(Boolean), 'hydraulics.errors.noLoop');
  // Flows are kept in each pipe's own direction; a loop sees the pipe's flow times its sign.
  const Q = pipes.map((p) => p.Q0);
  const history: number[][] = [];
  for (let it = 0; it < maxIter; it++) {
    const corrections: number[] = [];
    for (let j = 0; j < nLoops; j++) {
      if (!used[j]) {
        corrections.push(0);
        continue;
      }
      let num = 0;
      let den = 0;
      pipes.forEach((p, i) => {
        const s = p.loops[j] ?? 0;
        if (!s) return;
        const q = s * Q[i]!;
        const h = p.k * q * Math.abs(q) ** (p.e - 1);
        num += h;
        den += p.e * p.k * Math.abs(q) ** (p.e - 1);
      });
      need(den > 0, 'hydraulics.errors.zeroFlow');
      const dQ = -num / den;
      corrections.push(dQ);
      pipes.forEach((p, i) => {
        const s = p.loops[j] ?? 0;
        if (s) Q[i]! += s * dQ;
      });
    }
    history.push(corrections);
    if (Math.max(...corrections.map(Math.abs)) < tol) {
      const heads = pipes.map((p, i) => p.k * Q[i]! * Math.abs(Q[i]!) ** (p.e - 1));
      return { Q, heads, iterations: history.length, history };
    }
  }
  throw new CivilError('errors.noConvergence');
}

/** The Hazen-Williams resistance in SI, h = k Q^1.852 with k = 10.67 L / (C^1.852 D^4.87). */
export const hazenK = (L: number, D: number, C: number): number => {
  need(L > 0 && D > 0 && C > 0, 'errors.positive', { name: '~hydraulics.f.D' });
  return (10.67 * L) / (C ** 1.852 * D ** 4.87);
};
