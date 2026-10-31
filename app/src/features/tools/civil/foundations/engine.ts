// Earth pressure, foundations, and slopes: the methods behind the calculations in ./calcs. Everything is in kN, kPa,
// kN/m³, meters, and degrees, and nothing here reads the DOM or the strings.
import { rad } from '../core/format';
import { brent } from '../core/num';
import { need } from '../core/types';

export const GAMMA_W = 9.81;

const tanD = (deg: number): number => Math.tan(rad(deg));
const sinD = (deg: number): number => Math.sin(rad(deg));
const cosD = (deg: number): number => Math.cos(rad(deg));

function checkPhi(phi: number, max = 50): void {
  need(phi >= 0 && phi <= max, 'foundations.errors.phi', { max });
}

// ---------------------------------------------------------------------------------------------------------------
// Lateral earth pressure

export type EarthState = 'active' | 'passive' | 'rest';

/** Rankine's coefficient for a vertical wall and level backfill, or Jaky's K₀ = 1 - sin φ′ at rest. */
export function rankineK(phi: number, state: EarthState): number {
  checkPhi(phi);
  if (state === 'rest') return 1 - sinD(phi);
  const t = tanD(45 + (state === 'passive' ? phi : -phi) / 2);
  return t * t;
}

export interface Layer {
  /** Thickness, m. */
  h: number;
  /** Unit weight above the water table, kN/m³. */
  gamma: number;
  /** Saturated unit weight, kN/m³. */
  gammaSat: number;
  /** Effective cohesion, kPa. */
  c: number;
  /** Effective friction angle, degrees. */
  phi: number;
}

export interface PressurePoint {
  z: number;
  /** Vertical effective stress, kPa. */
  sv: number;
  /** Lateral effective stress, kPa, negative where the soil would be in tension. */
  sh: number;
  /** Pore pressure, kPa. */
  u: number;
}

export interface PressureProfile {
  K: readonly number[];
  points: readonly PressurePoint[];
  /** Resultant per meter of wall, kN/m, with tension ignored. */
  P: number;
  /** Height of the resultant above the base, m. */
  zBar: number;
  /** Depth of the tension crack, m (0 when there is none). */
  zc: number;
  /** The water's part of P, kN/m. */
  Pw: number;
}

/**
 * The Rankine pressure diagram behind a wall of layered soil with a surcharge q and the water table zw below the top
 * (Infinity for none). Each layer's lateral stress is K σ′v ∓ 2c√K; the pore pressure adds below the water table.
 * Tension (active, with cohesion) is set to zero for the resultant, which is the usual conservative choice.
 */
export function rankineProfile(layers: readonly Layer[], q: number, zw: number, state: EarthState): PressureProfile {
  need(layers.length > 0, 'errors.noRows');
  need(q >= 0, 'errors.nonNegative', { name: '~foundations.f.q' });
  need(zw >= 0, 'errors.nonNegative', { name: '~foundations.f.zw' });
  for (const layer of layers) {
    need(layer.h > 0, 'errors.positive', { name: '~foundations.f.hCol' });
    need(layer.gamma > 0 && layer.gammaSat > 0, 'errors.positive', { name: '~foundations.f.gammaCol' });
    need(layer.c >= 0, 'errors.nonNegative', { name: '~foundations.f.cCol' });
    need(layer.gammaSat > GAMMA_W || zw >= layers.reduce((s, l) => s + l.h, 0), 'foundations.errors.buoyant');
  }
  const K = layers.map((layer) => rankineK(layer.phi, state));
  const sign = state === 'passive' ? 1 : -1;
  const points: PressurePoint[] = [];
  let top = 0;
  let sv = q;
  layers.forEach((layer, i) => {
    const k = K[i]!;
    const cTerm = state === 'rest' ? 0 : 2 * layer.c * Math.sqrt(k);
    const at = (z: number, s: number): PressurePoint => ({
      z,
      sv: s,
      sh: k * s + sign * cTerm,
      u: z > zw ? GAMMA_W * (z - zw) : 0,
    });
    const bottom = top + layer.h;
    points.push(at(top, sv));
    if (zw > top && zw < bottom) {
      sv += layer.gamma * (zw - top);
      points.push(at(zw, sv));
      sv += (layer.gammaSat - GAMMA_W) * (bottom - zw);
    } else {
      sv += (zw <= top ? layer.gammaSat - GAMMA_W : layer.gamma) * layer.h;
    }
    points.push(at(bottom, sv));
    top = bottom;
  });
  const H = top;
  // Integrate the piecewise-linear diagram exactly: split each piece where the effective part changes sign.
  let P = 0;
  let M = 0;
  let Pw = 0;
  let zc = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (b.z <= a.z) continue;
    const pieces: [PressurePoint, PressurePoint][] = [];
    if (a.sh * b.sh < 0) {
      const f = a.sh / (a.sh - b.sh);
      const lerp = (x: number, y: number) => x + f * (y - x);
      const mid: PressurePoint = { z: lerp(a.z, b.z), sv: lerp(a.sv, b.sv), sh: 0, u: lerp(a.u, b.u) };
      pieces.push([a, mid], [mid, b]);
      if (a.sh < 0) zc = Math.max(zc, mid.z);
    } else {
      pieces.push([a, b]);
      if (a.sh <= 0 && b.sh <= 0) zc = Math.max(zc, b.z);
    }
    for (const [p0, p1] of pieces) {
      const d = p1.z - p0.z;
      const s0 = Math.max(0, p0.sh) + p0.u;
      const s1 = Math.max(0, p1.sh) + p1.u;
      const area = ((s0 + s1) / 2) * d;
      // The centroid of a trapezoid measured from its top edge.
      const zTop = s0 + s1 > 0 ? (d * (s0 + 2 * s1)) / (3 * (s0 + s1)) : 0;
      P += area;
      M += area * (H - (p0.z + zTop));
      Pw += ((p0.u + p1.u) / 2) * d;
    }
  }
  return { K, points, P, zBar: P > 0 ? M / P : 0, zc, Pw };
}

/** Coulomb's coefficient with wall friction δ, the wall's back at θ from vertical, and backfill at β. */
export function coulombK(phi: number, delta: number, theta: number, beta: number, state: 'active' | 'passive'): number {
  checkPhi(phi);
  need(phi > 0, 'errors.positive', { name: '~foundations.f.phi' });
  need(delta >= 0 && delta <= phi, 'foundations.errors.delta');
  need(Math.abs(theta) < 45, 'foundations.errors.theta');
  if (state === 'active') {
    need(beta <= phi, 'foundations.errors.beta');
    const root = Math.sqrt((sinD(phi + delta) * sinD(phi - beta)) / (cosD(delta + theta) * cosD(theta - beta)));
    return cosD(phi - theta) ** 2 / (cosD(theta) ** 2 * cosD(delta + theta) * (1 + root) ** 2);
  }
  const inner = (sinD(phi + delta) * sinD(phi + beta)) / (cosD(delta - theta) * cosD(beta - theta));
  need(inner < 1, 'foundations.errors.passive');
  return cosD(phi + theta) ** 2 / (cosD(theta) ** 2 * cosD(delta - theta) * (1 - Math.sqrt(inner)) ** 2);
}

// ---------------------------------------------------------------------------------------------------------------
// Retaining walls

export interface WallInput {
  /** Stem height above the base slab, m. */
  stem: number;
  /** Stem width at the top and at the base, m. The back face is vertical; the front face batters. */
  t1: number;
  t2: number;
  /** Base slab thickness, toe length, and heel length, m. */
  tb: number;
  toe: number;
  heel: number;
  gammaC: number;
  gamma: number;
  phi: number;
  /** Surcharge on the backfill, kPa. */
  q: number;
  /** Friction angle and adhesion between the base and the soil. */
  deltaB: number;
  ca: number;
  /** Depth of soil in front of the toe that may push back (passive), m; 0 ignores it. */
  front: number;
}

export interface WallForce {
  part: 'stem' | 'batter' | 'base' | 'soil' | 'surcharge';
  W: number;
  x: number;
}

export interface WallResult {
  Ka: number;
  Kp: number;
  H: number;
  B: number;
  Pa: number;
  Pq: number;
  Pp: number;
  forces: readonly WallForce[];
  V: number;
  MR: number;
  MO: number;
  FSo: number;
  FSs: number;
  e: number;
  qMax: number;
  qMin: number;
  inThird: boolean;
}

/** A cantilever (or, with a wide stem and short heel, gravity) wall: weights, thrust, and the three checks. */
export function retainingWall(w: WallInput): WallResult {
  for (const [value, name] of [
    [w.stem, 'stem'],
    [w.t1, 't1'],
    [w.t2, 't2'],
    [w.tb, 'tb'],
    [w.gammaC, 'gammaC'],
    [w.gamma, 'gamma'],
  ] as const)
    need(value > 0, 'errors.positive', { name: `~foundations.f.${name}` });
  for (const [value, name] of [
    [w.toe, 'toe'],
    [w.heel, 'heel'],
    [w.q, 'q'],
    [w.ca, 'ca'],
    [w.front, 'front'],
  ] as const)
    need(value >= 0, 'errors.nonNegative', { name: `~foundations.f.${name}` });
  need(w.t2 >= w.t1, 'foundations.errors.stem');
  need(w.front <= w.tb + w.stem, 'foundations.errors.front');
  const Ka = rankineK(w.phi, 'active');
  const Kp = rankineK(w.phi, 'passive');
  const H = w.stem + w.tb;
  const B = w.toe + w.t2 + w.heel;
  const Pa = 0.5 * Ka * w.gamma * H * H;
  const Pq = Ka * w.q * H;
  const Pp = 0.5 * Kp * w.gamma * w.front * w.front;
  const forces: WallForce[] = [
    { part: 'stem', W: w.gammaC * w.t1 * w.stem, x: w.toe + w.t2 - w.t1 / 2 },
    { part: 'batter', W: (w.gammaC * (w.t2 - w.t1) * w.stem) / 2, x: w.toe + ((w.t2 - w.t1) * 2) / 3 },
    { part: 'base', W: w.gammaC * B * w.tb, x: B / 2 },
    { part: 'soil', W: w.gamma * w.heel * w.stem, x: B - w.heel / 2 },
    { part: 'surcharge', W: w.q * w.heel, x: B - w.heel / 2 },
  ].filter((f) => f.W > 0) as WallForce[];
  const V = forces.reduce((s, f) => s + f.W, 0);
  const MR = forces.reduce((s, f) => s + f.W * f.x, 0);
  const MO = (Pa * H) / 3 + (Pq * H) / 2;
  const FSo = MR / MO;
  const FSs = (V * Math.tan(rad(w.deltaB)) + B * w.ca + Pp) / (Pa + Pq);
  const xR = (MR - MO) / V;
  const e = B / 2 - xR;
  const inThird = Math.abs(e) <= B / 6;
  const qMax = inThird
    ? (V / B) * (1 + (6 * Math.abs(e)) / B)
    : xR > 0 && xR < B
      ? (2 * V) / (3 * Math.min(xR, B - xR))
      : Infinity;
  const qMin = inThird ? (V / B) * (1 - (6 * Math.abs(e)) / B) : 0;
  return { Ka, Kp, H, B, Pa, Pq, Pp, forces, V, MR, MO, FSo, FSs, e, qMax, qMin, inThird };
}

// ---------------------------------------------------------------------------------------------------------------
// Bearing capacity

export type BearingMethod = 'terzaghi' | 'meyerhof' | 'hansen' | 'vesic';
export type FootingShape = 'strip' | 'square' | 'circle' | 'rectangle';

export interface BearingFactors {
  Nc: number;
  Nq: number;
  Ng: number;
}

/**
 * Terzaghi's Nγ for φ = 0° to 50° in 1° steps, as computed by Kumbhojkar (1993) and tabulated by Das. Terzaghi gave
 * Nγ only as a chart, and Coduto's closed-form fit runs up to about 20% high at 20° and 40°.
 */
const TERZAGHI_NG = [
  0, 0.01, 0.04, 0.06, 0.1, 0.14, 0.2, 0.27, 0.35, 0.44, 0.56, 0.69, 0.85, 1.04, 1.26, 1.52, 1.82, 2.18, 2.59, 3.07,
  3.64, 4.31, 5.09, 6.0, 7.08, 8.34, 9.84, 11.6, 13.7, 16.18, 19.13, 22.65, 26.87, 31.94, 38.04, 45.41, 54.36, 65.27,
  78.61, 95.03, 115.31, 140.51, 171.99, 211.56, 261.6, 325.34, 407.11, 512.84, 650.67, 831.99, 1072.8,
] as const;

const terzaghiNg = (phi: number): number => {
  const i = Math.min(Math.floor(phi), 49);
  return TERZAGHI_NG[i]! + (phi - i) * (TERZAGHI_NG[i + 1]! - TERZAGHI_NG[i]!);
};

/** Nc, Nq, and Nγ. Terzaghi's Nγ comes from Kumbhojkar's table, read linearly between whole degrees. */
export function bearingFactors(phi: number, method: BearingMethod): BearingFactors {
  checkPhi(phi, 50);
  const t = tanD(phi);
  if (method === 'terzaghi') {
    if (phi === 0) return { Nc: 5.7, Nq: 1, Ng: 0 };
    const a = Math.exp((0.75 * Math.PI - rad(phi) / 2) * t);
    const Nq = (a * a) / (2 * cosD(45 + phi / 2) ** 2);
    const Nc = (Nq - 1) / t;
    return { Nc, Nq, Ng: terzaghiNg(phi) };
  }
  const Nq = Math.exp(Math.PI * t) * tanD(45 + phi / 2) ** 2;
  const Nc = phi === 0 ? Math.PI + 2 : (Nq - 1) / t;
  const Ng =
    method === 'meyerhof'
      ? (Nq - 1) * Math.tan(rad(1.4 * phi))
      : method === 'hansen'
        ? 1.5 * (Nq - 1) * t
        : 2 * (Nq + 1) * t;
  return { Nc, Nq, Ng };
}

export interface BearingInput {
  method: BearingMethod;
  shape: FootingShape;
  /** Width and, for a rectangle, length, m. */
  B: number;
  L: number;
  Df: number;
  gamma: number;
  gammaSat: number;
  c: number;
  phi: number;
  /** Depth of the water table below the ground, m; Infinity for none. */
  zw: number;
  /** Load eccentricity across B, m. */
  e: number;
  /** Load inclination from vertical, degrees. */
  incline: number;
  depthFactors: boolean;
  FS: number;
}

export interface BearingResult extends BearingFactors {
  /** The effective width after eccentricity, and the length used. */
  Bp: number;
  Lp: number;
  q: number;
  /** The unit weight in the Nγ term. */
  gBar: number;
  waterCase: 1 | 2 | 3;
  s: readonly [number, number, number];
  d: readonly [number, number, number];
  i: readonly [number, number, number];
  terms: readonly [number, number, number];
  qult: number;
  qall: number;
  /** Ultimate and allowable load, kN (per meter for a strip). */
  Qult: number;
  Qall: number;
}

/**
 * The ultimate bearing pressure. Terzaghi's equation uses his shape constants (1.3 and 0.4 or 0.3); the general
 * equation uses De Beer's shape factors, Hansen's depth factors (optional), and Meyerhof's inclination factors.
 */
export function bearing(input: BearingInput): BearingResult {
  const { method, shape, Df, gamma, gammaSat, c, phi, zw, e, incline } = input;
  need(input.B > 0, 'errors.positive', { name: '~foundations.f.B' });
  need(Df >= 0, 'errors.nonNegative', { name: '~foundations.f.Df' });
  need(gamma > 0, 'errors.positive', { name: '~foundations.f.gamma' });
  need(c >= 0, 'errors.nonNegative', { name: '~foundations.f.c' });
  need(input.FS >= 1, 'foundations.errors.fs');
  need(e >= 0 && e < input.B / 2, 'foundations.errors.eccentric');
  need(incline >= 0 && incline < 90, 'foundations.errors.incline');
  need(zw >= Df + input.B || gammaSat > GAMMA_W, 'foundations.errors.buoyant');
  if (shape === 'rectangle') need(input.L >= input.B, 'foundations.errors.length');
  need(method !== 'terzaghi' || (e === 0 && incline === 0 && shape !== 'rectangle'), 'foundations.errors.terzaghi');
  const f = bearingFactors(phi, method);
  const Bp = input.B - 2 * e;
  const Lp = shape === 'rectangle' ? input.L : shape === 'strip' ? Infinity : Bp;
  const sub = gammaSat - GAMMA_W;
  let q: number;
  let gBar: number;
  let waterCase: 1 | 2 | 3;
  if (zw < Df) {
    waterCase = 1;
    q = gamma * zw + sub * (Df - zw);
    gBar = sub;
  } else if (zw < Df + Bp) {
    waterCase = 2;
    q = gamma * Df;
    gBar = sub + ((zw - Df) / Bp) * (gamma - sub);
  } else {
    waterCase = 3;
    q = gamma * Df;
    gBar = gamma;
  }
  let s: [number, number, number] = [1, 1, 1];
  let d: [number, number, number] = [1, 1, 1];
  let i: [number, number, number] = [1, 1, 1];
  if (method === 'terzaghi') {
    if (shape === 'square') s = [1.3, 1, 0.4 / 0.5];
    else if (shape === 'circle') s = [1.3, 1, 0.3 / 0.5];
  } else {
    const r = shape === 'strip' ? 0 : Bp / Lp;
    s = [1 + r * (f.Nq / f.Nc), 1 + r * tanD(phi), Math.max(0.6, 1 - 0.4 * r)];
    if (input.depthFactors) {
      const k = Df / input.B <= 1 ? Df / input.B : Math.atan(Df / input.B);
      d = [1 + 0.4 * k, 1 + 2 * tanD(phi) * (1 - sinD(phi)) ** 2 * k, 1];
    }
    const ic = (1 - incline / 90) ** 2;
    i = [ic, ic, phi > 0 ? Math.max(0, 1 - incline / phi) ** 2 : 0];
  }
  const terms: [number, number, number] = [
    c * f.Nc * s[0] * d[0] * i[0],
    q * f.Nq * s[1] * d[1] * i[1],
    0.5 * gBar * Bp * f.Ng * s[2] * d[2] * i[2],
  ];
  const qult = terms[0] + terms[1] + terms[2];
  const qall = qult / input.FS;
  const area = shape === 'strip' ? Bp : shape === 'circle' ? (Math.PI * Bp * Bp) / 4 : Bp * Lp;
  return { ...f, Bp, Lp, q, gBar, waterCase, s, d, i, terms, qult, qall, Qult: qult * area, Qall: qall * area };
}

// ---------------------------------------------------------------------------------------------------------------
// Slopes

export type SlopeWater = 'dry' | 'submerged' | 'seepage';

/** Factor of safety of an infinite slope with a slip plane at depth z (needed only when c′ > 0). */
export function infiniteSlope(
  phi: number,
  beta: number,
  c: number,
  z: number,
  gamma: number,
  gammaSat: number,
  water: SlopeWater,
): { FS: number; frictional: number; cohesive: number } {
  checkPhi(phi);
  need(beta > 0 && beta < 90, 'foundations.errors.slope');
  need(c >= 0, 'errors.nonNegative', { name: '~foundations.f.c' });
  if (c > 0) need(z > 0, 'errors.positive', { name: '~foundations.f.z' });
  const g = water === 'dry' ? gamma : gammaSat;
  need(g > 0, 'errors.positive', { name: '~foundations.f.gamma' });
  if (water !== 'dry') need(gammaSat > GAMMA_W, 'foundations.errors.buoyant');
  const sub = gammaSat - GAMMA_W;
  const ratio = water === 'dry' ? 1 : water === 'submerged' ? 1 : sub / gammaSat;
  const frictional = (ratio * tanD(phi)) / tanD(beta);
  const weight = water === 'submerged' ? sub : g;
  const cohesive = c > 0 ? c / (weight * z * cosD(beta) ** 2 * tanD(beta)) : 0;
  return { FS: frictional + cohesive, frictional, cohesive };
}

/** Culmann's planar wedge through the toe at angle θ in a slope of height H at β. θ omitted: the critical plane. */
export function culmann(
  H: number,
  beta: number,
  c: number,
  phi: number,
  gamma: number,
  theta?: number,
): { theta: number; W: number; L: number; FS: number; Hcr: number } {
  need(H > 0, 'errors.positive', { name: '~foundations.f.H' });
  need(gamma > 0, 'errors.positive', { name: '~foundations.f.gamma' });
  need(beta > 0 && beta <= 90, 'foundations.errors.slope');
  checkPhi(phi);
  const th = theta ?? (beta + phi) / 2;
  need(th > 0 && th < beta, 'foundations.errors.plane');
  const W = (0.5 * gamma * H * H * sinD(beta - th)) / (sinD(beta) * sinD(th));
  const L = H / sinD(th);
  const driving = W * sinD(th);
  const FS = (c * L + W * cosD(th) * tanD(phi)) / driving;
  const Hcr = beta > phi ? (4 * c * sinD(beta) * cosD(phi)) / (gamma * (1 - cosD(beta - phi))) : Infinity;
  return { theta: th, W, L, FS, Hcr };
}

export interface SlopeSoil {
  H: number;
  beta: number;
  gamma: number;
  c: number;
  phi: number;
  /** Pore pressure ratio u / (γ h). */
  ru: number;
}

export interface Slice {
  x: number;
  b: number;
  h: number;
  W: number;
  /** Base angle, degrees, positive where the base dips toward the toe. */
  alpha: number;
  u: number;
  ordinary: number;
  bishop: number;
}

export interface CircleResult {
  xc: number;
  yc: number;
  R: number;
  slices: readonly Slice[];
  ordinary: number;
  bishop: number;
  /** Each Bishop iterate, starting from the ordinary value. */
  iterations: readonly number[];
}

/** The ground of the slope: the crest at height H for x ≤ 0, the face down to the toe at (H cot β, 0), then level. */
export function ground(soil: SlopeSoil, x: number): number {
  const run = soil.H / tanD(soil.beta);
  return x <= 0 ? soil.H : x >= run ? 0 : soil.H - x * tanD(soil.beta);
}

export const toeOf = (soil: SlopeSoil): number => soil.H / tanD(soil.beta);

function checkSoil(soil: SlopeSoil): void {
  need(soil.H > 0, 'errors.positive', { name: '~foundations.f.H' });
  need(soil.beta > 0 && soil.beta < 90, 'foundations.errors.slope');
  need(soil.gamma > 0, 'errors.positive', { name: '~foundations.f.gamma' });
  need(soil.c >= 0, 'errors.nonNegative', { name: '~foundations.f.c' });
  need(soil.ru >= 0 && soil.ru < 1, 'foundations.errors.ru');
  checkPhi(soil.phi);
  need(soil.c > 0 || soil.phi > 0, 'foundations.errors.strength');
}

/** The ordinary (Fellenius) and Bishop simplified factors of safety on one circle, by n vertical slices. */
export function slipCircle(soil: SlopeSoil, xc: number, yc: number, R: number, n = 30): CircleResult {
  checkSoil(soil);
  need(R > 0 && n >= 4, 'foundations.errors.circle');
  const base = (x: number) => yc - Math.sqrt(Math.max(0, R * R - (x - xc) ** 2));
  const gap = (x: number) => ground(soil, x) - base(x);
  // Find where the arc leaves the ground on each side: scan, then refine with Brent.
  const lo = xc - R;
  const hi = xc + R;
  const samples = 800;
  let best: [number, number] | null = null;
  let start: number | null = null;
  for (let k = 0; k <= samples; k++) {
    const x = lo + ((hi - lo) * k) / samples;
    const inside = gap(x) > 1e-12 && k > 0 && k < samples;
    if (inside && start === null) start = k;
    if ((!inside || k === samples) && start !== null) {
      if (!best || k - start > best[1] - best[0]) best = [start, k];
      start = null;
    }
  }
  need(best !== null && best[1] - best[0] > 2, 'foundations.errors.miss');
  const at = (k: number) => lo + ((hi - lo) * k) / samples;
  const x1 = best[0] === 1 && gap(lo) >= 0 ? lo : brent(gap, at(best[0] - 1), at(best[0]), 1e-10);
  const x2 = best[1] === samples && gap(hi) >= 0 ? hi : brent(gap, at(best[1] - 1), at(best[1]), 1e-10);
  const b = (x2 - x1) / n;
  const tphi = tanD(soil.phi);
  const raw = Array.from({ length: n }, (_, k) => {
    const x = x1 + (k + 0.5) * b;
    const h = Math.max(0, ground(soil, x) - base(x));
    const sinA = (xc - x) / R;
    const alpha = Math.asin(Math.max(-1, Math.min(1, sinA)));
    const W = soil.gamma * h * b;
    const u = soil.ru * soil.gamma * h;
    return { x, b, h, W, alpha, u };
  });
  const driving = raw.reduce((s, sl) => s + sl.W * Math.sin(sl.alpha), 0);
  need(driving > 0, 'foundations.errors.uphill');
  const ordTerms = raw.map(
    (sl) =>
      (soil.c * sl.b) / Math.cos(sl.alpha) +
      Math.max(0, sl.W * Math.cos(sl.alpha) - (sl.u * sl.b) / Math.cos(sl.alpha)) * tphi,
  );
  const ordinary = ordTerms.reduce((s, v) => s + v, 0) / driving;
  const bishopTerms = (FS: number) =>
    raw.map((sl) => {
      const m = Math.cos(sl.alpha) + (Math.sin(sl.alpha) * tphi) / FS;
      need(m > 0.05, 'foundations.errors.malpha');
      return (soil.c * sl.b + Math.max(0, sl.W - sl.u * sl.b) * tphi) / m;
    });
  const iterations = [ordinary];
  let FS = ordinary;
  for (let k = 0; k < 200; k++) {
    const next = bishopTerms(FS).reduce((s, v) => s + v, 0) / driving;
    iterations.push(next);
    if (Math.abs(next - FS) < 1e-4 * Math.max(1, FS)) {
      FS = next;
      break;
    }
    FS = next;
    need(k < 199, 'errors.noConvergence');
  }
  // One more pass at the settled value, so the table and the answer agree.
  const finalTerms = bishopTerms(FS);
  FS = finalTerms.reduce((s, v) => s + v, 0) / driving;
  const slices = raw.map((sl, k) => ({
    ...sl,
    alpha: (sl.alpha * 180) / Math.PI,
    ordinary: ordTerms[k]!,
    bishop: finalTerms[k]!,
  }));
  return { xc, yc, R, slices, ordinary, bishop: FS, iterations };
}

export interface SearchResult {
  best: CircleResult;
  /** Every center tried with its Bishop factor of safety (NaN where the circle missed the slope). */
  grid: readonly { xc: number; yc: number; FS: number }[];
}

/** A grid of centers, each with the circle through the toe; the lowest Bishop factor of safety wins. */
export function searchCircles(
  soil: SlopeSoil,
  x: readonly [number, number],
  y: readonly [number, number],
  steps: number,
  n = 30,
): SearchResult {
  checkSoil(soil);
  need(steps >= 1 && steps <= 40, 'foundations.errors.steps');
  need(x[1] >= x[0] && y[1] >= y[0], 'foundations.errors.range');
  const toe = toeOf(soil);
  const grid: { xc: number; yc: number; FS: number }[] = [];
  let best: CircleResult | null = null;
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < steps; j++) {
      const xc = steps === 1 ? x[0] : x[0] + ((x[1] - x[0]) * i) / (steps - 1);
      const yc = steps === 1 ? y[0] : y[0] + ((y[1] - y[0]) * j) / (steps - 1);
      const R = Math.hypot(xc - toe, yc);
      let FS = NaN;
      try {
        const result = slipCircle(soil, xc, yc, R, n);
        FS = result.bishop;
        if (!best || FS < best.bishop) best = result;
      } catch {
        // A center whose circle misses the slope or turns uphill is skipped.
      }
      grid.push({ xc, yc, FS });
    }
  need(best !== null, 'foundations.errors.miss');
  return { best, grid };
}

// ---------------------------------------------------------------------------------------------------------------
// Piles

export interface PileLayer {
  h: number;
  /** Effective unit weight, kN/m³. */
  gammaEff: number;
  cu: number;
  alpha: number;
  beta: number;
}

export interface PileResult {
  perimeter: number;
  area: number;
  L: number;
  layers: readonly { top: number; bottom: number; svMid: number; f: number; Qs: number }[];
  Qs: number;
  svTip: number;
  Qb: number;
  Qult: number;
  Qall: number;
}

/**
 * A single pile: skin friction f = α cu + β σ′v in each layer (α for clay, β for sand), and end bearing from
 * 9 cu at the tip (clay) or σ′v Nq* (sand).
 */
export function pile(
  shape: 'round' | 'square',
  D: number,
  layers: readonly PileLayer[],
  tip: 'clay' | 'sand',
  NqStar: number,
  FS: number,
): PileResult {
  need(D > 0, 'errors.positive', { name: '~foundations.f.D' });
  need(layers.length > 0, 'errors.noRows');
  need(FS >= 1, 'foundations.errors.fs');
  const perimeter = shape === 'round' ? Math.PI * D : 4 * D;
  const area = shape === 'round' ? (Math.PI * D * D) / 4 : D * D;
  let top = 0;
  let sv = 0;
  const rows = layers.map((layer) => {
    need(layer.h > 0, 'errors.positive', { name: '~foundations.f.hCol' });
    need(layer.gammaEff >= 0 && layer.cu >= 0 && layer.alpha >= 0 && layer.beta >= 0, 'foundations.errors.pileLayer');
    need(layer.alpha <= 1.5, 'foundations.errors.alpha');
    const svMid = sv + (layer.gammaEff * layer.h) / 2;
    const f = layer.alpha * layer.cu + layer.beta * svMid;
    const out = { top, bottom: top + layer.h, svMid, f, Qs: f * perimeter * layer.h };
    sv += layer.gammaEff * layer.h;
    top += layer.h;
    return out;
  });
  const last = layers[layers.length - 1]!;
  if (tip === 'clay') need(last.cu > 0, 'foundations.errors.tipClay');
  else need(NqStar > 0, 'errors.positive', { name: '~foundations.f.Nq' });
  const Qs = rows.reduce((s, r) => s + r.Qs, 0);
  const Qb = tip === 'clay' ? 9 * last.cu * area : sv * NqStar * area;
  const Qult = Qs + Qb;
  return { perimeter, area, L: top, layers: rows, Qs, svTip: sv, Qb, Qult, Qall: Qult / FS };
}

/** The Converse-Labarre efficiency of an m × n group of piles of diameter D at spacing s. */
export function groupEfficiency(m: number, n: number, D: number, s: number): { theta: number; E: number } {
  need(Number.isInteger(m) && Number.isInteger(n) && m >= 1 && n >= 1, 'foundations.errors.count');
  need(D > 0 && s > D, 'foundations.errors.spacing');
  const theta = (Math.atan(D / s) * 180) / Math.PI;
  const E = 1 - (theta * ((n - 1) * m + (m - 1) * n)) / (90 * m * n);
  return { theta, E };
}
