// A state of R-134a from two properties, like steam/water.ts: (T, p), (p, h), (p, s), (T, x), or (p, x). Single
// phase finds the density by a root search on the correct side of the saturation line, and p with h or s finds T
// by Brent's method. Enthalpy and entropy use the IIR reference (h = 200 kJ/kg and s = 1 kJ/(kg K) for saturated
// liquid at 0 °C) or the ASHRAE one (both 0 for saturated liquid at −40 °C).
import { brent } from '../common/num';
import { ThermoError } from '../common/types';
import type { Phase } from '../steam/water';
import {
  P_HIGH,
  T_HIGH,
  T_LOW,
  T_SAT_MAX,
  densityAt,
  saturationP,
  saturationT,
  stateRhoT,
  type R134aRaw,
  type Saturated,
} from './eos';

export type Reference = 'iir' | 'ashrae';

/** The pressure where the equation's critical point sits, kPa. */
const P_CRIT_EOS = 4059.28;

export interface RefrigerantPoint {
  T: number;
  p: number;
  rho: number;
  v: number;
  u: number;
  h: number;
  s: number;
  x: number | null;
  phase: Phase;
  cp: number | null;
  cv: number | null;
  w: number | null;
  sat?: Saturated;
}

let ashraeOffset: { h: number; s: number } | null = null;

/** What to add to h and s for the reference state; the equation itself gives the IIR one. */
export function offsets(reference: Reference): { h: number; s: number } {
  if (reference === 'iir') return { h: 0, s: 0 };
  if (!ashraeOffset) {
    const liquid = saturationT(233.15).liquid;
    ashraeOffset = { h: -liquid.h, s: -liquid.s };
  }
  return ashraeOffset;
}

function single(raw: R134aRaw, phase: Phase, reference: Reference): RefrigerantPoint {
  const off = offsets(reference);
  return {
    T: raw.T,
    p: raw.p,
    rho: raw.rho,
    v: 1 / raw.rho,
    u: raw.u + off.h,
    h: raw.h + off.h,
    s: raw.s + off.s,
    x: null,
    phase,
    cp: raw.cp,
    cv: raw.cv,
    w: raw.w,
  };
}

function mix(sat: Saturated, x: number, reference: Reference): RefrigerantPoint {
  if (!(x >= 0 && x <= 1)) throw new ThermoError('qualityRange');
  const off = offsets(reference);
  const lever = (f: number, g: number) => f + x * (g - f);
  const v = lever(1 / sat.liquid.rho, 1 / sat.vapor.rho);
  return {
    T: sat.T,
    p: sat.p,
    rho: 1 / v,
    v,
    u: lever(sat.liquid.u, sat.vapor.u) + off.h,
    h: lever(sat.liquid.h, sat.vapor.h) + off.h,
    s: lever(sat.liquid.s, sat.vapor.s) + off.s,
    x,
    phase: x === 0 ? 'satLiquid' : x === 1 ? 'satVapor' : 'mixture',
    cp: null,
    cv: null,
    w: null,
    sat,
  };
}

function checkRange(T: number, p: number): void {
  if (!(p > 0)) throw new ThermoError('notPositive', { name: 'p' });
  if (!(T >= T_LOW && T <= T_HIGH && p <= P_HIGH)) throw new ThermoError('r134aRange');
}

/** The side of the saturation line a state at T and p is on. */
function sideOf(T: number, p: number): 'liquid' | 'vapor' {
  if (T <= T_SAT_MAX) return p > saturationT(T).p ? 'liquid' : 'vapor';
  return p >= P_CRIT_EOS ? 'liquid' : 'vapor';
}

function phaseAt(T: number, p: number, side: 'liquid' | 'vapor'): Phase {
  if (T >= 374.21 && p >= P_CRIT_EOS) return 'supercritical';
  return side === 'liquid' ? 'liquid' : 'vapor';
}

export function fromTP(T: number, p: number, reference: Reference = 'iir'): RefrigerantPoint {
  checkRange(T, p);
  const side = sideOf(T, p);
  return single(stateRhoT(densityAt(T, p, side), T), phaseAt(T, p, side), reference);
}

export function fromTX(T: number, x: number, reference: Reference = 'iir'): RefrigerantPoint {
  return mix(saturationT(T), x, reference);
}

export function fromPX(p: number, x: number, reference: Reference = 'iir'): RefrigerantPoint {
  if (!(p > 0)) throw new ThermoError('notPositive', { name: 'p' });
  return mix(saturationP(p), x, reference);
}

function fromP(p: number, value: number, key: 'h' | 's', reference: Reference): RefrigerantPoint {
  if (!(p > 0)) throw new ThermoError('notPositive', { name: 'p' });
  if (p > P_HIGH) throw new ThermoError('r134aRange');
  const off = offsets(reference)[key];
  const raw = value - off;
  const solve = (lo: number, hi: number, side: 'liquid' | 'vapor' | 'auto') => {
    const at = (T: number) => stateRhoT(densityAt(T, p, side === 'auto' ? sideOf(T, p) : side), T);
    const f = (T: number) => at(T)[key] - raw;
    if (f(lo) > 0 || f(hi) < 0) throw new ThermoError('r134aRange');
    const T = brent(f, lo, hi, 1e-12);
    const realSide = side === 'auto' ? sideOf(T, p) : side;
    return single(at(T), phaseAt(T, p, realSide), reference);
  };
  if (p > saturationT(T_SAT_MAX).p) return solve(T_LOW, T_HIGH, 'auto');
  const sat = saturationP(p);
  if (raw < sat.liquid[key]) return solve(T_LOW, sat.T, 'liquid');
  if (raw > sat.vapor[key]) return solve(sat.T, T_HIGH, 'vapor');
  return mix(sat, (raw - sat.liquid[key]) / (sat.vapor[key] - sat.liquid[key]), reference);
}

export const fromPH = (p: number, h: number, reference: Reference = 'iir'): RefrigerantPoint =>
  fromP(p, h, 'h', reference);
export const fromPS = (p: number, s: number, reference: Reference = 'iir'): RefrigerantPoint =>
  fromP(p, s, 's', reference);

let domeCache: Saturated[] | null = null;

/** Saturated states from the triple point to near the critical point, for the p-h diagram. */
export function refrigerantDome(): Saturated[] {
  domeCache ??= Array.from({ length: 32 }, (_, i) =>
    saturationT(T_LOW + 0.2 + (T_SAT_MAX - T_LOW - 0.2) * (1 - (1 - i / 31) ** 2)),
  );
  return domeCache;
}
