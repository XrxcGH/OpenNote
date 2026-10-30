// R-134a (1,1,1,2-tetrafluoroethane) by the Helmholtz-energy equation of state of Tillner-Roth and Baehr,
// J. Phys. Chem. Ref. Data 23, 657 (1994), the international standard formulation. The reduced Helmholtz energy
// is an ideal part plus a residual sum of terms n δ^d τ^t exp(−δ^l). Saturation solves equal pressure and equal
// Gibbs energy (the Maxwell condition) by Newton's method on the pressure. Units: K, kPa, kg/m³, kJ/kg.
import { brent } from '../common/num';
import { ThermoError } from '../common/types';

export const R134A_SOURCE = 'Tillner-Roth and Baehr, J. Phys. Chem. Ref. Data 23, 657 (1994)';

export const T_C = 374.18;
export const RHO_C = 508;
/** Molar mass, g/mol. */
export const M = 102.032;
/** Specific gas constant, kJ/(kg K), from R = 8.314471 J/(mol K). */
export const R = 8.314471 / M;
export const T_LOW = 169.85;
/** Saturation is solved up to here, K; the loop of the equation closes at its critical point, 374.21 K. */
export const T_SAT_MAX = 374;
export const T_HIGH = 455;
/** Highest pressure of the formulation, kPa. */
export const P_HIGH = 70000;

const A0 = [-1.019535, 9.047135, -1.629789, -9.723916, -3.92717];

// n, t, d, l: the residual terms.
const TERMS: readonly (readonly [number, number, number, number])[] = [
  [0.5586817e-1, -0.5, 2, 0],
  [0.498223, 0, 1, 0],
  [0.2458698e-1, 0, 3, 0],
  [0.8570145e-3, 0, 6, 0],
  [0.4788584e-3, 1.5, 6, 0],
  [-0.1800808e1, 1.5, 1, 0],
  [0.2671641, 2, 1, 0],
  [-0.4781652e-1, 2, 2, 0],
  [0.1423987e-1, 1, 5, 1],
  [0.3324062, 3, 2, 1],
  [-0.7485907e-2, 5, 2, 1],
  [0.1017263e-3, 1, 4, 2],
  [-0.5184567, 5, 1, 2],
  [-0.8692288e-1, 5, 4, 2],
  [0.2057144, 6, 1, 2],
  [-0.5000457e-2, 10, 2, 2],
  [0.4603262e-3, 10, 4, 2],
  [-0.3497836e-2, 10, 1, 3],
  [0.6995038e-2, 18, 5, 3],
  [-0.1452184e-1, 22, 3, 3],
  [-0.1285458e-3, 50, 10, 4],
];

interface Helmholtz {
  f0: number;
  f0t: number;
  f0tt: number;
  fr: number;
  frd: number;
  frdd: number;
  frt: number;
  frtt: number;
  frdt: number;
}

function helmholtz(delta: number, tau: number): Helmholtz {
  const out: Helmholtz = {
    f0: A0[0] + A0[1] * tau + A0[2] * Math.log(tau) + Math.log(delta) + A0[3] * tau ** -0.5 + A0[4] * tau ** -0.75,
    f0t: A0[1] + A0[2] / tau - 0.5 * A0[3] * tau ** -1.5 - 0.75 * A0[4] * tau ** -1.75,
    f0tt: -A0[2] / (tau * tau) + 0.75 * A0[3] * tau ** -2.5 + 1.3125 * A0[4] * tau ** -2.75,
    fr: 0,
    frd: 0,
    frdd: 0,
    frt: 0,
    frtt: 0,
    frdt: 0,
  };
  for (const [n, t, d, l] of TERMS) {
    const dl = l === 0 ? 0 : delta ** l;
    const e = l === 0 ? 1 : Math.exp(-dl);
    const base = n * tau ** t * delta ** d * e;
    const a = d - l * dl;
    out.fr += base;
    out.frd += (base * a) / delta;
    out.frdd += (base * (a * (a - 1) - l * l * dl)) / (delta * delta);
    out.frt += (base * t) / tau;
    out.frtt += (base * t * (t - 1)) / (tau * tau);
    out.frdt += (base * t * a) / (tau * delta);
  }
  return out;
}

/** A single-phase state from density and temperature, before the reference-state offsets. */
export interface R134aRaw {
  T: number;
  rho: number;
  p: number;
  u: number;
  h: number;
  s: number;
  g: number;
  cv: number;
  cp: number;
  w: number;
  /** ∂p/∂ρ at constant T, kPa m³/kg. */
  dpdrho: number;
}

export function stateRhoT(rho: number, T: number): R134aRaw {
  const delta = rho / RHO_C;
  const tau = T_C / T;
  const f = helmholtz(delta, tau);
  const RT = R * T;
  const z = 1 + delta * f.frd;
  const stiff = 1 + 2 * delta * f.frd + delta * delta * f.frdd;
  const cross = 1 + delta * f.frd - delta * tau * f.frdt;
  const cv = -R * tau * tau * (f.f0tt + f.frtt);
  const u = RT * tau * (f.f0t + f.frt);
  const s = R * (tau * (f.f0t + f.frt) - f.f0 - f.fr);
  return {
    T,
    rho,
    p: rho * RT * z,
    u,
    h: u + RT * z,
    s,
    g: u + RT * z - T * s,
    cv,
    cp: cv + (R * cross * cross) / stiff,
    w: Math.sqrt(1000 * RT * (stiff - (cross * cross) / (tau * tau * (f.f0tt + f.frtt)))),
    dpdrho: RT * stiff,
  };
}

/** Every density where p(ρ, T) equals p, from a logarithmic scan of 1e-4 to 2000 kg/m³. */
function densities(T: number, p: number): number[] {
  const f = (rho: number) => stateRhoT(rho, T).p - p;
  const roots: number[] = [];
  const n = 600;
  let a = 1e-4;
  let fa = f(a);
  for (let i = 1; i <= n; i++) {
    const b = 1e-4 * (2000 / 1e-4) ** (i / n);
    const fb = f(b);
    if (fa * fb < 0) roots.push(brent(f, a, b, 1e-14));
    a = b;
    fa = fb;
  }
  return roots;
}

/** The density of the liquid or vapor at T and p; 'auto' picks by the saturation pressure. */
export function densityAt(T: number, p: number, side: 'liquid' | 'vapor'): number {
  const roots = densities(T, p);
  if (!roots.length) throw new ThermoError('r134aRange');
  return side === 'liquid' ? roots[roots.length - 1] : roots[0];
}

/** Newton's method on ρ at fixed T for a target pressure, from a starting density. */
function polish(T: number, p: number, rho: number): number {
  let r = rho;
  for (let i = 0; i < 50; i++) {
    const state = stateRhoT(r, T);
    if (!(state.dpdrho > 0)) break;
    const step = (state.p - p) / state.dpdrho;
    const next = Math.max(r * 0.5, Math.min(r * 1.5, r - step));
    if (Math.abs(next - r) < 1e-12 * r) return next;
    r = next;
  }
  return r;
}

/** Ancillary vapor pressure for a start: ln p linear in 1/T through the boiling and critical points. */
function startPressure(T: number): number {
  const b = Math.log(4056.3 / 101.325) / (1 / 247.08 - 1 / T_C);
  return 4056.3 * Math.exp(-b * (1 / T - 1 / T_C));
}

export interface Saturated {
  T: number;
  p: number;
  liquid: R134aRaw;
  vapor: R134aRaw;
  /** The pressure iterations, for the worked steps. */
  iterations: { p: number; dg: number }[];
}

const satCache = new Map<number, Saturated>();

/** Saturation at T by equal Gibbs energy: Newton on p with d(g_l − g_v)/dp = v_l − v_v. */
export function saturationT(T: number): Saturated {
  if (!(T >= T_LOW && T <= T_SAT_MAX)) throw new ThermoError('r134aSatRange');
  const cached = satCache.get(T);
  if (cached) return cached;
  let p = startPressure(T);
  let rl = densityAt(T, p, 'liquid');
  let rv = densityAt(T, p, 'vapor');
  const iterations: { p: number; dg: number }[] = [];
  for (let i = 0; i < 60; i++) {
    rl = polish(T, p, rl);
    rv = polish(T, p, rv);
    const l = stateRhoT(rl, T);
    const v = stateRhoT(rv, T);
    const dg = l.g - v.g;
    iterations.push({ p, dg });
    const next = p - dg / (1 / rl - 1 / rv);
    if (Math.abs(next - p) < 1e-11 * p) {
      p = next;
      break;
    }
    p = Math.max(0.5 * p, Math.min(1.5 * p, next));
  }
  rl = polish(T, p, rl);
  rv = polish(T, p, rv);
  if (Math.abs(rl - rv) < 1e-6 * RHO_C) throw new ThermoError('r134aSatRange');
  const result = { T, p, liquid: stateRhoT(rl, T), vapor: stateRhoT(rv, T), iterations };
  if (satCache.size > 500) satCache.clear();
  satCache.set(T, result);
  return result;
}

/** Saturation temperature at p (kPa), by Brent's method on the saturation pressure. */
export function saturationP(p: number): Saturated {
  const pLow = saturationT(T_LOW).p;
  const pHigh = saturationT(T_SAT_MAX).p;
  if (!(p >= pLow && p <= pHigh)) throw new ThermoError('r134aSatRange');
  const T = brent((t) => saturationT(t).p - p, T_LOW, T_SAT_MAX, 1e-12);
  return saturationT(T);
}
