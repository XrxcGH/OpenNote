// A state of water from any two independent properties: (T, p), (p, h), (p, s), (T, x), (p, x), or (h, s).
// Single-phase states come from the IF97 basic equations. A state given by p with h or s finds T by Brent's method
// on the right side of the saturation line, and (h, s) finds p around (p, h) the same way. Two-phase states mix
// saturated liquid and vapor by the lever rule. Devices and cycles call these functions state by state.
import { brent } from '../common/num';
import { ThermoError } from '../common/types';
import {
  P_CRIT,
  P_MAX,
  P_TRIPLE,
  P_MAX_5,
  RHO_CRIT,
  T_CRIT,
  T_MAX,
  T_MIN,
  pB23,
  psat,
  region1,
  region2,
  region3,
  region3TP,
  region5,
  regionOf,
  saturation,
  stateTP,
  tsat,
  type RegionTest,
  type WaterState,
} from './if97';

export type Phase = 'liquid' | 'mixture' | 'satLiquid' | 'satVapor' | 'vapor' | 'supercritical';

/** A state of water: every property, the region and phase, and the quality when it is a mixture. */
export interface WaterPoint {
  T: number;
  p: number;
  v: number;
  u: number;
  h: number;
  s: number;
  /** Quality, or null for a single-phase state. */
  x: number | null;
  phase: Phase;
  region: 1 | 2 | 3 | 4 | 5;
  test: RegionTest;
  /** Specific heats and speed of sound, for single-phase states only. */
  cp: number | null;
  cv: number | null;
  w: number | null;
  /** The saturated states the lever rule mixed, for two-phase states. */
  sat?: { liquid: WaterState; vapor: WaterState };
}

function phaseOf(state: WaterState): Phase {
  if (state.T >= T_CRIT && state.p >= P_CRIT) return 'supercritical';
  if (state.T < T_CRIT && state.p > psat(state.T)) return 'liquid';
  if (state.T >= T_CRIT) return 'vapor';
  return state.p < psat(state.T) ? 'vapor' : 'liquid';
}

const single = (state: WaterState, test: RegionTest): WaterPoint => ({
  ...state,
  x: null,
  phase: phaseOf(state),
  test,
});

function mix(T: number, p: number, liquid: WaterState, vapor: WaterState, x: number): WaterPoint {
  if (!(x >= 0 && x <= 1)) throw new ThermoError('qualityRange');
  const lever = (f: number, g: number) => f + x * (g - f);
  return {
    T,
    p,
    v: lever(liquid.v, vapor.v),
    u: lever(liquid.u, vapor.u),
    h: lever(liquid.h, vapor.h),
    s: lever(liquid.s, vapor.s),
    x,
    phase: x === 0 ? 'satLiquid' : x === 1 ? 'satVapor' : 'mixture',
    region: 4,
    test: 'saturated',
    cp: null,
    cv: null,
    w: null,
    sat: { liquid, vapor },
  };
}

/** Saturated liquid and vapor at a pressure below the critical one. */
export function saturationAtP(p: number): { T: number; liquid: WaterState; vapor: WaterState } {
  if (!(p > 0)) throw new ThermoError('notPositive', { name: 'p' });
  if (p > P_CRIT) throw new ThermoError('steamAboveCritical');
  const T = tsat(p);
  if (T <= 623.15) return { T, liquid: region1(T, p), vapor: region2(T, p) };
  return { T, liquid: region3TP(T, p, 'liquid'), vapor: region3TP(T, p, 'vapor') };
}

export function fromTP(T: number, p: number): WaterPoint {
  const { test } = regionOf(T, p);
  return single(stateTP(T, p), test);
}

export function fromTX(T: number, x: number): WaterPoint {
  if (!(T >= T_MIN && T <= T_CRIT)) throw new ThermoError('steamSatRange');
  const { p, liquid, vapor } = saturation(T);
  return mix(T, p, liquid, vapor, x);
}

export function fromPX(p: number, x: number): WaterPoint {
  const { T, liquid, vapor } = saturationAtP(p);
  return mix(T, p, liquid, vapor, x);
}

const tMaxAt = (p: number): number => (p <= P_MAX_5 ? T_MAX : 1073.15);

/** The single-phase state at T on one side of the saturation line, for the root search. */
function sided(T: number, p: number, side: 'liquid' | 'vapor' | 'auto'): WaterState {
  if (side === 'liquid') return T <= 623.15 ? region1(T, p) : region3TP(T, p, 'liquid');
  if (side === 'vapor') {
    if (T > 1073.15) return region5(T, p);
    if (T <= 623.15 || p <= pB23(T)) return region2(T, p);
    return region3TP(T, p, 'vapor');
  }
  return stateTP(T, p);
}

function solveT(p: number, target: number, key: 'h' | 's', lo: number, hi: number, side: 'liquid' | 'vapor' | 'auto') {
  const f = (T: number) => sided(T, p, side)[key] - target;
  if (f(lo) > 0 || f(hi) < 0) throw new ThermoError('steamRange');
  const T = brent(f, lo, hi, 1e-13);
  const state = sided(T, p, side);
  return single(state, regionOf(T, p).test);
}

/** A state from p and h (key 'h') or p and s (key 's'). */
function fromP(p: number, value: number, key: 'h' | 's'): WaterPoint {
  if (!(p > 0)) throw new ThermoError('notPositive', { name: 'p' });
  if (p > P_MAX) throw new ThermoError('steamRange');
  if (p >= P_CRIT) return solveT(p, value, key, T_MIN, tMaxAt(p), 'auto');
  const { T: Ts, liquid, vapor } = saturationAtP(p);
  if (value < liquid[key]) return solveT(p, value, key, T_MIN, Ts, 'liquid');
  if (value > vapor[key]) return solveT(p, value, key, Ts, tMaxAt(p), 'vapor');
  return mix(Ts, p, liquid, vapor, (value - liquid[key]) / (vapor[key] - liquid[key]));
}

export const fromPH = (p: number, h: number): WaterPoint => fromP(p, h, 'h');
export const fromPS = (p: number, s: number): WaterPoint => fromP(p, s, 's');

/**
 * A state from h and s. At fixed h, s falls as p rises ((∂s/∂p)_h = −v/T), so one pressure has the entropy s: a scan
 * on ln p brackets it between the triple-point and the top pressure, and Brent's method finds it.
 */
export function fromHS(h: number, s: number): WaterPoint {
  if (!Number.isFinite(h) || !Number.isFinite(s)) throw new ThermoError('steamRange');
  const f = (lnp: number): number => {
    try {
      return fromPH(Math.exp(lnp), h).s - s;
    } catch {
      return Number.NaN;
    }
  };
  const lo = Math.log(P_TRIPLE * 1.0001);
  const hi = Math.log(P_MAX);
  const n = 60;
  let a = lo;
  let fa = f(a);
  for (let i = 1; i <= n; i++) {
    const b = lo + ((hi - lo) * i) / n;
    const fb = f(b);
    if (fa === 0) return fromPH(Math.exp(a), h);
    if (fa * fb < 0) return fromPH(Math.exp(brent(f, a, b, 1e-14)), h);
    a = b;
    fa = fb;
  }
  if (fa === 0) return fromPH(Math.exp(a), h);
  throw new ThermoError('steamRange');
}

/** The critical point by the region 3 equation. */
export const criticalState = (): WaterState => region3(RHO_CRIT, T_CRIT);

let domeCache: { liquid: WaterState[]; vapor: WaterState[] } | null = null;

/** The saturation dome, worked out once. */
export function dome(): { liquid: WaterState[]; vapor: WaterState[] } {
  domeCache ??= computeDome();
  return domeCache;
}

function computeDome(): { liquid: WaterState[]; vapor: WaterState[] } {
  const liquid: WaterState[] = [];
  const vapor: WaterState[] = [];
  // Denser near the critical point, where the lines turn.
  for (let i = 0; i <= 40; i++) {
    const T = T_MIN + 0.01 + (T_CRIT - 0.05 - T_MIN) * (1 - (1 - i / 40) ** 2);
    const sat = saturation(T);
    liquid.push(sat.liquid);
    vapor.push(sat.vapor);
  }
  const critical = criticalState();
  liquid.push(critical);
  vapor.push(critical);
  return { liquid, vapor };
}
