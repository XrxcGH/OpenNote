// One-dimensional compressible flow of a calorically perfect gas: isentropic flow, normal shocks, oblique shocks,
// Prandtl-Meyer expansion, Fanno flow (adiabatic with friction), and Rayleigh flow (frictionless with heat
// transfer). Every relation is a closed form in the Mach number; the inverses are in engine.ts.
import { AeroError, brent, goldenMax, num, type Bracket } from '../common';

/** T0/T. */
export const stagnationT = (M: number, g: number) => 1 + ((g - 1) / 2) * M * M;
export const isentropicT = (M: number, g: number) => 1 / stagnationT(M, g);
export const isentropicP = (M: number, g: number) => Math.pow(stagnationT(M, g), -g / (g - 1));
export const isentropicRho = (M: number, g: number) => Math.pow(stagnationT(M, g), -1 / (g - 1));

/** A/A* for isentropic flow. */
export function areaRatio(M: number, g: number): number {
  return (1 / M) * Math.pow((2 / (g + 1)) * stagnationT(M, g), (g + 1) / (2 * (g - 1)));
}

/** Mach angle in radians (M >= 1). */
export const machAngle = (M: number) => Math.asin(1 / M);

/** Prandtl-Meyer function in radians (M >= 1). */
export function prandtlMeyer(M: number, g: number): number {
  const k = Math.sqrt((g + 1) / (g - 1));
  const m = Math.sqrt(M * M - 1);
  return k * Math.atan(m / k) - Math.atan(m);
}

export const nuMax = (g: number) => (Math.PI / 2) * (Math.sqrt((g + 1) / (g - 1)) - 1);

export interface NormalShock {
  readonly M2: number;
  readonly p2p1: number;
  readonly rho2rho1: number;
  readonly T2T1: number;
  readonly p02p01: number;
  /** Pitot pressure over upstream static pressure (Rayleigh pitot formula). */
  readonly p02p1: number;
}

export function normalShock(M1: number, g: number): NormalShock {
  const m2 = M1 * M1;
  const M2 = Math.sqrt((1 + ((g - 1) / 2) * m2) / (g * m2 - (g - 1) / 2));
  const p2p1 = 1 + ((2 * g) / (g + 1)) * (m2 - 1);
  const rho2rho1 = ((g + 1) * m2) / ((g - 1) * m2 + 2);
  const T2T1 = p2p1 / rho2rho1;
  const p02p01 = Math.pow(rho2rho1, g / (g - 1)) * Math.pow(p2p1, -1 / (g - 1));
  return { M2, p2p1, rho2rho1, T2T1, p02p01, p02p1: p2p1 / isentropicP(M2, g) };
}

/** Flow deflection theta (radians) for wave angle beta (radians) at upstream Mach M. */
export function thetaOf(beta: number, M: number, g: number): number {
  const s = Math.sin(beta);
  const num = 2 * (Math.cos(beta) / s) * (M * M * s * s - 1);
  const den = M * M * (g + Math.cos(2 * beta)) + 2;
  return Math.atan(num / den);
}

/** The largest deflection an attached oblique shock can turn, and the wave angle where it happens. */
export function thetaMax(M: number, g: number): { theta: number; beta: number } {
  const beta = goldenMax((b) => thetaOf(b, M, g), machAngle(M), Math.PI / 2);
  return { theta: thetaOf(beta, M, g), beta };
}

/** Wave angle for deflection theta: the weak or strong solution. Throws detached past theta max. */
export function betaOf(theta: number, M: number, g: number, strong: boolean): Bracket {
  const max = thetaMax(M, g);
  if (theta > max.theta + 1e-12) throw new AeroError('detached', { max: num((max.theta * 180) / Math.PI) });
  const f = (b: number) => thetaOf(b, M, g) - theta;
  if (Math.abs(theta - max.theta) < 1e-12) return { root: max.beta, iterations: 0, lo: max.beta, hi: max.beta };
  // Zero deflection: the weak solution is the Mach wave, the strong one a normal shock.
  if (theta <= 1e-15) {
    const root = strong ? Math.PI / 2 : machAngle(M);
    return { root, iterations: 0, lo: root, hi: root };
  }
  return strong ? brent(f, max.beta, Math.PI / 2) : brent(f, machAngle(M), max.beta);
}

export interface FannoRatios {
  readonly fLD: number;
  readonly TT: number;
  readonly pp: number;
  readonly rhorho: number;
  readonly p0p0: number;
}

export function fanno(M: number, g: number): FannoRatios {
  const m2 = M * M;
  const k = 2 + (g - 1) * m2;
  return {
    fLD: (1 - m2) / (g * m2) + ((g + 1) / (2 * g)) * Math.log(((g + 1) * m2) / k),
    TT: (g + 1) / k,
    pp: (1 / M) * Math.sqrt((g + 1) / k),
    rhorho: (1 / M) * Math.sqrt(k / (g + 1)),
    p0p0: (1 / M) * Math.pow(k / (g + 1), (g + 1) / (2 * (g - 1))),
  };
}

export interface RayleighRatios {
  readonly pp: number;
  readonly TT: number;
  readonly rhorho: number;
  readonly T0T0: number;
  readonly p0p0: number;
}

export function rayleigh(M: number, g: number): RayleighRatios {
  const m2 = M * M;
  const pp = (1 + g) / (1 + g * m2);
  return {
    pp,
    TT: m2 * pp * pp,
    rhorho: 1 / (m2 * pp),
    T0T0: (2 * (g + 1) * m2 * (1 + ((g - 1) / 2) * m2)) / Math.pow(1 + g * m2, 2),
    p0p0: pp * Math.pow((2 + (g - 1) * m2) / (g + 1), g / (g - 1)),
  };
}

export type Branch = 'subsonic' | 'supersonic';

/** Smallest and largest Mach numbers the inverses search. */
export const M_MIN = 1e-8;
export const M_MAX = 1e4;

/** The Mach number on the given branch where A/A* = ratio. */
export function machFromArea(ratio: number, g: number, branch: Branch): Bracket {
  if (!(ratio >= 1)) throw new AeroError('areaRatioBelowOne');
  if (ratio === 1) return { root: 1, iterations: 0, lo: 1, hi: 1 };
  const f = (M: number) => areaRatio(M, g) - ratio;
  return branch === 'subsonic' ? brent(f, M_MIN, 1) : brent(f, 1, M_MAX);
}
