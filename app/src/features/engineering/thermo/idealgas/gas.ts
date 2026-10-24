// Ideal gases for the kit: single species, and air as N2 78.08 %, O2 20.95 %, and Ar 0.97 % by moles. Each has
// three models. Variable specific heats come from the NASA polynomials, and constant cp is taken at 300 K. The
// cold-air standard of textbooks uses cp = 1.005, cv = 0.718, and R = 0.287 kJ/(kg K), with k = 1.4.
// Properties are per kg.
import { brent } from '../common/num';
import { ThermoError } from '../common/types';
import { RU, SPECIES, molarCp, molarH, molarS, type SpeciesId } from '../data/nasa';

export type GasId = 'air' | 'N2' | 'O2' | 'H2O' | 'CO2' | 'CO' | 'H2' | 'Ar' | 'He' | 'CH4' | 'C3H8';
export type GasModel = 'variable' | 'constant' | 'cold';

export const GAS_IDS: readonly GasId[] = ['air', 'N2', 'O2', 'H2O', 'CO2', 'CO', 'H2', 'Ar', 'He', 'CH4', 'C3H8'];

const MIXES: Record<GasId, readonly (readonly [SpeciesId, number])[]> = {
  air: [
    ['N2', 0.7808],
    ['O2', 0.2095],
    ['Ar', 0.0097],
  ],
  N2: [['N2', 1]],
  O2: [['O2', 1]],
  H2O: [['H2O', 1]],
  CO2: [['CO2', 1]],
  CO: [['CO', 1]],
  H2: [['H2', 1]],
  Ar: [['Ar', 1]],
  He: [['He', 1]],
  CH4: [['CH4', 1]],
  C3H8: [['C3H8', 1]],
};

/** A gas with its model: everything per kg, in kJ, K, and kPa. */
export interface Gas {
  id: GasId;
  model: GasModel;
  /** Molar mass, g/mol. */
  M: number;
  /** Gas constant, kJ/(kg K). */
  R: number;
  /**
   * The gas constant in s = s°(T) − R ln(p/p₀). It is R, except in the cold-air standard, where cp (k − 1)/k
   * keeps isentropes at T₂/T₁ = (p₂/p₁)^((k−1)/k) with k = 1.4, as textbooks do.
   */
  Rs: number;
  cp(T: number): number;
  cv(T: number): number;
  k(T: number): number;
  /** Enthalpy, kJ/kg: cp T for the constant models, and with the enthalpy of formation for the variable one. */
  h(T: number): number;
  u(T: number): number;
  /** Entropy at 1 bar, kJ/(kg K). */
  s0(T: number): number;
  /** The temperature where s0 has a given value (variable model). */
  tOfS0(s0: number, lo?: number, hi?: number): number;
}

function mixMolar(id: GasId, f: (species: (typeof SPECIES)[SpeciesId], T: number) => number, T: number): number {
  return MIXES[id].reduce((sum, [name, y]) => sum + y * f(SPECIES[name], T), 0);
}

export function molarMassOf(id: GasId): number {
  return MIXES[id].reduce((sum, [name, y]) => sum + y * SPECIES[name].M, 0);
}

/** The highest temperature every species of the gas is fitted to. */
export const gasTMax = (id: GasId): number => Math.min(...MIXES[id].map(([name]) => SPECIES[name].tMax));

function variableGas(id: GasId): Gas {
  const M = molarMassOf(id);
  const R = RU / M;
  const mixing = -RU * MIXES[id].reduce((sum, [, y]) => sum + y * Math.log(y), 0);
  const cp = (T: number) => mixMolar(id, molarCp, T) / M;
  const h = (T: number) => mixMolar(id, molarH, T) / M;
  const s0 = (T: number) => (mixMolar(id, molarS, T) + mixing) / M;
  return {
    id,
    model: 'variable',
    M,
    R,
    Rs: R,
    cp,
    cv: (T) => cp(T) - R,
    k: (T) => cp(T) / (cp(T) - R),
    h,
    u: (T) => h(T) - R * T,
    s0,
    tOfS0: (target, lo = 200, hi = gasTMax(id)) => {
      if ((s0(lo) - target) * (s0(hi) - target) > 0)
        throw new ThermoError('gasRange', { formula: id, max: String(hi) });
      return brent((T) => s0(T) - target, lo, hi);
    },
  };
}

function constantGas(id: GasId, model: 'constant' | 'cold'): Gas {
  const M = molarMassOf(id);
  const cold = model === 'cold';
  const R = cold ? 0.287 : RU / M;
  const cp = cold ? 1.005 : mixMolar(id, molarCp, 300) / M;
  const cv = cold ? 0.718 : cp - R;
  const k = cold ? 1.4 : cp / cv;
  const T0 = 298.15;
  const s0ref = cold ? 0 : variableGas(id).s0(T0);
  return {
    id,
    model,
    M: cold ? RU / 0.287 : M,
    R,
    Rs: cold ? (cp * (k - 1)) / k : R,
    cp: () => cp,
    cv: () => cv,
    k: () => k,
    // Measured from 0 at 0 K, as with cold-air-standard textbook work, so h - u = R T holds.
    h: (T) => cp * T,
    u: (T) => cv * T,
    s0: (T) => s0ref + cp * Math.log(T / T0),
    tOfS0: (target) => T0 * Math.exp((target - s0ref) / cp),
  };
}

export function gasOf(id: GasId, model: GasModel): Gas {
  if (!GAS_IDS.includes(id)) throw new ThermoError('unknownGas', { gas: String(id) });
  return model === 'variable' ? variableGas(id) : constantGas(id, model);
}
