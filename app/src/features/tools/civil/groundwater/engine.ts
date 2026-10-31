// Groundwater and wells: Darcy flow, gradients from 3 wells, layered aquifers, well hydraulics at steady state and
// over time, pumping-test fits, image wells, capture zones, flow nets, seepage under a dam, and 1D transport.
// SI throughout: m, s (or d where the field says so), m/s, m²/s, m³/s.
import { EULER_GAMMA, expErfc, expint1, leastSquares, lineFit, quad } from '../core/num';
import { CivilError, need } from '../core/types';

export const GAMMA_W = 9.81;

export function darcy(K: number, i: number, ne: number, area: number | null) {
  need(K > 0, 'errors.positive', { name: 'K' });
  need(ne > 0 && ne <= 1, 'errors.fraction', { name: 'nₑ' });
  const q = K * i;
  return { q, v: q / ne, Q: area === null ? null : q * area };
}

/** The plane h = ax + by + c through 3 wells, the gradient, and the direction water flows (azimuth from +y). */
export function threeWells(wells: readonly (readonly number[])[]) {
  need(wells.length === 3, 'groundwater.errors.threeWells');
  const [[x1, y1, h1], [x2, y2, h2], [x3, y3, h3]] = wells as [number[], number[], number[]];
  const det = (x2! - x1!) * (y3! - y1!) - (x3! - x1!) * (y2! - y1!);
  need(Math.abs(det) > 1e-9, 'groundwater.errors.inLine');
  const a = ((h2! - h1!) * (y3! - y1!) - (h3! - h1!) * (y2! - y1!)) / det;
  const b = ((x2! - x1!) * (h3! - h1!) - (x3! - x1!) * (h2! - h1!)) / det;
  const gradient = Math.hypot(a, b);
  need(gradient > 0, 'groundwater.errors.flat');
  // Water flows down the gradient, toward -(a, b). The azimuth is measured clockwise from +y (north).
  let azimuth = (Math.atan2(-a, -b) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return { a, b, c: h1! - a * x1! - b * y1!, gradient, azimuth };
}

/** Equivalent conductivity of layers (thickness, K): along the layers and across them. */
export function layered(layers: readonly (readonly number[])[]) {
  need(layers.length > 0, 'errors.noRows');
  let total = 0;
  let along = 0;
  let resist = 0;
  for (const [b, K] of layers) {
    need(b! > 0 && K! > 0, 'groundwater.errors.layer');
    total += b!;
    along += b! * K!;
    resist += b! / K!;
  }
  return { total, kh: along / total, kv: total / resist };
}

/** Steady drawdown in a confined aquifer (Thiem) at r, for a radius of influence R. */
export function thiem(Q: number, T: number, R: number, r: number): number {
  need(T > 0, 'errors.positive', { name: 'T' });
  need(r > 0 && R > r, 'groundwater.errors.radii');
  return (Q / (2 * Math.PI * T)) * Math.log(R / r);
}

/** Steady head and drawdown in an unconfined aquifer (Dupuit-Forchheimer). */
export function dupuit(Q: number, K: number, H: number, R: number, r: number) {
  need(K > 0 && H > 0, 'errors.positive', { name: 'K, H' });
  need(r > 0 && R > r, 'groundwater.errors.radii');
  const h2 = H * H - (Q / (Math.PI * K)) * Math.log(R / r);
  need(h2 > 0, 'groundwater.errors.dry');
  const h = Math.sqrt(h2);
  return { h, s: H - h };
}

export const theisU = (r: number, S: number, T: number, t: number) => (r * r * S) / (4 * T * t);

export function theis(Q: number, T: number, S: number, r: number, t: number) {
  need(T > 0 && S > 0, 'errors.positive', { name: 'T, S' });
  need(r > 0 && t > 0, 'errors.positive', { name: 'r, t' });
  const u = theisU(r, S, T, t);
  const W = expint1(u);
  const factor = Q / (4 * Math.PI * T);
  return { u, W, factor, s: factor * W, jacob: factor * (-EULER_GAMMA - Math.log(u)) };
}

/** The Hantush-Jacob leaky well function W(u, r/B) = ∫_u^∞ (1/y) exp(-y - (r/B)²/(4y)) dy. */
export function hantushW(u: number, rOverB: number): number {
  need(u > 0, 'errors.positive', { name: 'u' });
  need(rOverB >= 0, 'errors.nonNegative', { name: 'r/B' });
  if (rOverB === 0) return expint1(u);
  if (u >= 60) return 0;
  // With y = u e^z the integral is ∫_0^∞ exp(-u e^z - β²/(4 u e^z)) dz, which ends where u e^z passes 60.
  const beta2 = rOverB * rOverB;
  const top = Math.log(60 / u);
  return quad(
    (z) => {
      const y = u * Math.exp(z);
      return Math.exp(-y - beta2 / (4 * y));
    },
    0,
    top,
    1e-12,
  );
}

/** Cooper-Jacob straight line through drawdown against log time: T and S from the slope and the time at s = 0. */
export function fitJacob(data: readonly (readonly number[])[], Q: number, r: number) {
  need(data.length >= 2, 'errors.fewPoints', { count: 2 });
  need(
    data.every(([t]) => t! > 0),
    'groundwater.errors.times',
  );
  const line = lineFit(
    data.map(([t]) => Math.log10(t!)),
    data.map(([, s]) => s!),
  );
  need(line.slope > 0, 'groundwater.errors.noRise');
  const T = (2.302585092994046 * Q) / (4 * Math.PI * line.slope);
  const t0 = 10 ** (-line.intercept / line.slope);
  return { T, S: (2.25 * T * t0) / (r * r), slope: line.slope, t0, r2: line.r2 };
}

/** Theis curve fit: T and S that make the squared drawdown misfit smallest (fitted in log space, so both stay > 0). */
export function fitTheis(data: readonly (readonly number[])[], Q: number, r: number) {
  need(data.length >= 3, 'errors.fewPoints', { count: 3 });
  let start = [Math.log(1e-3), Math.log(1e-4)];
  try {
    const jacob = fitJacob(data, Q, r);
    if (jacob.T > 0 && jacob.S > 0) start = [Math.log(jacob.T), Math.log(jacob.S)];
  } catch {
    // The default start serves.
  }
  const model = (p: readonly number[], t: number) => theis(Q, Math.exp(p[0]!), Math.exp(p[1]!), r, t).s;
  const fit = leastSquares((p) => data.map(([t, s]) => model(p, t!) - s!), start);
  return { T: Math.exp(fit.p[0]!), S: Math.exp(fit.p[1]!), rms: Math.sqrt(fit.cost / data.length) };
}

export type Boundary = 'none' | 'recharge' | 'barrier';

/** Drawdown at a point from wells (x, y, Q) by superposition, with image wells across the line x = 0. */
export function superpose(
  wells: readonly (readonly number[])[],
  point: readonly [number, number],
  aquifer: { T: number; S: number; t: number },
  boundary: Boundary,
) {
  need(wells.length > 0, 'errors.noRows');
  const all: { x: number; y: number; Q: number; image: boolean }[] = [];
  for (const [x, y, Q] of wells) {
    all.push({ x: x!, y: y!, Q: Q!, image: false });
    if (boundary !== 'none') {
      need(x! > 0, 'groundwater.errors.wellSide');
      all.push({ x: -x!, y: y!, Q: boundary === 'recharge' ? -Q! : Q!, image: true });
    }
  }
  const parts = all.map((well) => {
    const r = Math.max(Math.hypot(point[0] - well.x, point[1] - well.y), 1e-6);
    const { u, s } = theis(well.Q, aquifer.T, aquifer.S, r, aquifer.t);
    return { ...well, r, u, s };
  });
  return { parts, total: parts.reduce((sum, part) => sum + part.s, 0) };
}

/** A well's capture zone in a uniform regional flow q = K i through thickness b. */
export function captureZone(Q: number, b: number, K: number, i: number) {
  need(Q > 0 && b > 0 && K > 0 && i > 0, 'errors.positive', { name: 'Q, b, K, i' });
  const q = K * i;
  return { q, stagnation: Q / (2 * Math.PI * b * q), atWell: Q / (2 * b * q), far: Q / (b * q) };
}

export function flowNet(k: number, H: number, Nf: number, Nd: number, exitLength: number | null) {
  need(k > 0 && H > 0, 'errors.positive', { name: 'k, H' });
  need(Nf > 0 && Nd > 0, 'errors.positive', { name: 'N_f, N_d' });
  const drop = H / Nd;
  return { q: (k * H * Nf) / Nd, drop, exit: exitLength === null ? null : drop / exitLength };
}

export interface DamGrid {
  q: number;
  inflow: number;
  uplift: [number, number][];
  upliftForce: number;
  exitGradient: number;
  headAtCenter: number;
  iterations: number;
}

/**
 * Steady seepage under a dam with an impermeable base of width B on a permeable layer of depth D, with soil `side`
 * meters either side, by finite differences on Laplace's equation (SOR). Head is H upstream and 0 downstream.
 */
export function damSeepage(spec: { k: number; H: number; B: number; D: number; side: number }): DamGrid {
  const { k, H, B, D, side } = spec;
  need(k > 0 && H > 0 && B > 0 && D > 0 && side > 0, 'errors.positive', { name: 'k, H, B, D' });
  const length = B + 2 * side;
  const step = Math.min(D, B, side) / 16;
  const nx = Math.min(241, Math.round(length / step) + 1);
  const ny = Math.min(81, Math.round(D / step) + 1);
  const dx = length / (nx - 1);
  const dy = D / (ny - 1);
  const heelX = side;
  const toeX = side + B;
  const h = Array.from({ length: ny }, () => new Float64Array(nx).fill(H / 2));
  const kind = (j: number) => (j * dx < heelX - 1e-9 ? 'up' : j * dx > toeX + 1e-9 ? 'down' : 'dam');
  for (let j = 0; j < nx; j++) if (kind(j) !== 'dam') h[0]![j] = kind(j) === 'up' ? H : 0;
  const ax = 1 / (dx * dx);
  const ay = 1 / (dy * dy);
  const omega = 1.85;
  let iterations = 0;
  for (; iterations < 20000; iterations++) {
    let change = 0;
    for (let i = 0; i < ny; i++) {
      for (let j = 0; j < nx; j++) {
        if (i === 0 && kind(j) !== 'dam') continue;
        // No-flow edges mirror the node inside them.
        const up = i === 0 ? h[1]![j]! : h[i - 1]![j]!;
        const down = i === ny - 1 ? h[ny - 2]![j]! : h[i + 1]![j]!;
        const left = j === 0 ? h[i]![1]! : h[i]![j - 1]!;
        const right = j === nx - 1 ? h[i]![nx - 2]! : h[i]![j + 1]!;
        const next = (ax * (left + right) + ay * (up + down)) / (2 * ax + 2 * ay);
        const delta = omega * (next - h[i]![j]!);
        h[i]![j]! += delta;
        change = Math.max(change, Math.abs(delta));
      }
    }
    if (change < 1e-10 * H) break;
  }
  if (iterations >= 20000) throw new CivilError('errors.noConvergence');
  // Flow per unit width through the ground surface, by the trapezoid rule on the vertical gradient there.
  const surfaceFlux = (want: 'up' | 'down') => {
    let sum = 0;
    for (let j = 0; j < nx; j++) {
      if (kind(j) !== want) continue;
      const weight = j === 0 || j === nx - 1 || kind(j - 1) !== want || kind(j + 1) !== want ? 0.5 : 1;
      sum += (weight * dx * k * Math.abs(h[1]![j]! - h[0]![j]!)) / dy;
    }
    return sum;
  };
  const uplift: [number, number][] = [];
  for (let j = 0; j < nx; j++) if (kind(j) === 'dam') uplift.push([j * dx - heelX, GAMMA_W * h[0]![j]!]);
  let upliftForce = 0;
  for (let m = 1; m < uplift.length; m++)
    upliftForce += ((uplift[m]![0] - uplift[m - 1]![0]) * (uplift[m]![1] + uplift[m - 1]![1])) / 2;
  const toe = Math.min(nx - 1, Math.ceil(toeX / dx - 1e-9));
  const center = Math.round((heelX + B / 2) / dx);
  return {
    q: surfaceFlux('down'),
    inflow: surfaceFlux('up'),
    uplift,
    upliftForce,
    exitGradient: (h[1]![toe]! - h[0]![toe]!) / dy,
    headAtCenter: h[0]![center]!,
    iterations,
  };
}

export const retardation = (rhoB: number, Kd: number, n: number) => {
  need(n > 0 && n <= 1, 'errors.fraction', { name: 'n' });
  need(rhoB >= 0 && Kd >= 0, 'errors.nonNegative', { name: 'ρ_b, K_d' });
  return 1 + (rhoB * Kd) / n;
};

/**
 * Relative concentration C/C0 for a continuous source at x = 0 in 1D flow (Ogata-Banks), with retardation R and
 * first-order decay λ in both phases: v and D are divided by R, and U = √(v² + 4 λ D).
 */
export function ogataBanks(x: number, v: number, D: number, t: number, R = 1, lambda = 0): number {
  need(D > 0 && t > 0, 'errors.positive', { name: 'D, t' });
  need(R >= 1, 'groundwater.errors.retardation');
  need(x >= 0 && lambda >= 0, 'errors.nonNegative', { name: 'x, λ' });
  const vr = v / R;
  const dr = D / R;
  const U = Math.sqrt(vr * vr + 4 * lambda * dr);
  const root = 2 * Math.sqrt(dr * t);
  const first = expErfc((x / (2 * dr)) * (vr - U), (x - U * t) / root);
  const second = expErfc((x / (2 * dr)) * (vr + U), (x + U * t) / root);
  return 0.5 * (first + second);
}
