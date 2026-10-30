// One face for the kit's working fluids, so devices and cycles fix states the same way whatever the fluid: water
// and steam by IF97, R-134a by its Helmholtz equation, and ideal gases with the model chosen in the ideal-gas tool.
// Every state carries T (K), p (kPa), h (kJ/kg), s (kJ/(kg K)), v (m³/kg), and a quality when two-phase.
import { brent } from '../common/num';
import { ThermoError } from '../common/types';
import { gasOf, gasTMax, type GasId, type GasModel } from '../idealgas/gas';
import { R134A_SOURCE } from '../r134a/eos';
import * as r134a from '../r134a/refrigerant';
import { IF97_SOURCE } from '../steam/if97';
import * as water from '../steam/water';
import { NASA_SOURCE } from '../data/nasa';

export interface FluidState {
  T: number;
  p: number;
  h: number;
  s: number;
  v: number;
  x: number | null;
}

export type FluidKind = 'water' | 'r134a' | 'gas';

export interface Fluid {
  kind: FluidKind;
  source?: string;
  fromTP(T: number, p: number): FluidState;
  fromPH(p: number, h: number): FluidState;
  fromPS(p: number, s: number): FluidState;
  /** Saturated states; ideal gases have none. */
  fromPX(p: number, x: number): FluidState;
  fromTX(T: number, x: number): FluidState;
}

const pick = (state: FluidState): FluidState => ({
  T: state.T,
  p: state.p,
  h: state.h,
  s: state.s,
  v: state.v,
  x: state.x,
});

const WATER: Fluid = {
  kind: 'water',
  source: IF97_SOURCE,
  fromTP: (T, p) => pick(water.fromTP(T, p)),
  fromPH: (p, h) => pick(water.fromPH(p, h)),
  fromPS: (p, s) => pick(water.fromPS(p, s)),
  fromPX: (p, x) => pick(water.fromPX(p, x)),
  fromTX: (T, x) => pick(water.fromTX(T, x)),
};

const R134A: Fluid = {
  kind: 'r134a',
  source: R134A_SOURCE,
  fromTP: (T, p) => pick(r134a.fromTP(T, p)),
  fromPH: (p, h) => pick(r134a.fromPH(p, h)),
  fromPS: (p, s) => pick(r134a.fromPS(p, s)),
  fromPX: (p, x) => pick(r134a.fromPX(p, x)),
  fromTX: (T, x) => pick(r134a.fromTX(T, x)),
};

/** An ideal gas: s = s°(T) − R ln(p/100 kPa), and T from h or s by Brent's method. */
export function gasFluid(id: GasId, model: GasModel): Fluid {
  const gas = gasOf(id, model);
  const state = (T: number, p: number): FluidState => {
    if (!(T > 0)) throw new ThermoError('notPositive', { name: 'T' });
    if (!(p > 0)) throw new ThermoError('notPositive', { name: 'p' });
    return { T, p, h: gas.h(T), s: gas.s0(T) - gas.Rs * Math.log(p / 100), v: (gas.R * T) / p, x: null };
  };
  const tOfH = (h: number): number => {
    if (model !== 'variable') return h / gas.cp(300);
    const hi = gasTMax(id);
    if ((gas.h(200) - h) * (gas.h(hi) - h) > 0) throw new ThermoError('gasRange', { formula: id, max: String(hi) });
    return brent((T) => gas.h(T) - h, 200, hi);
  };
  const noSaturation = (): FluidState => {
    throw new ThermoError('gasNoSaturation');
  };
  return {
    kind: 'gas',
    source: model === 'cold' ? undefined : NASA_SOURCE,
    fromTP: state,
    fromPH: (p, h) => state(tOfH(h), p),
    fromPS: (p, s) => state(gas.tOfS0(s + gas.Rs * Math.log(p / 100)), p),
    fromPX: noSaturation,
    fromTX: noSaturation,
  };
}

export type FluidId = 'water' | 'r134a' | 'gas';

export function fluidOf(id: FluidId, gas: GasId = 'air', model: GasModel = 'variable'): Fluid {
  if (id === 'water') return WATER;
  if (id === 'r134a') return R134A;
  return gasFluid(gas, model);
}
