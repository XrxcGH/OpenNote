// Fuels, the oxygen they need, the balanced reaction for complete combustion, air-fuel ratios, heating values, and
// the dew point of the products. Per mole of fuel throughout; enthalpies in J/mol with formation included.
import { ThermoError } from '../common/types';
import { SPECIES, type SpeciesId } from '../data/nasa';
import { tsat } from '../steam/if97';
import { atomsOf, hMol, massOf, type Amounts, type Atoms } from './species';

export type FuelId = 'CH4' | 'C3H8' | 'C8H18' | 'H2' | 'C12H23' | 'custom';
export type Oxidizer = 'air' | 'O2';

export interface Fuel {
  formula: string;
  atoms: Atoms;
  /** g/mol. */
  M: number;
  /** Enthalpy of formation at 298.15 K, J/mol, in the phase the fuel enters. */
  hf: number;
  /** The NASA species when the fuel is a gas with polynomials, so it can enter hot. */
  nasa?: SpeciesId;
  liquid: boolean;
}

/** Liquid n-octane and the Jet-A surrogate: formation enthalpies from the NIST WebBook and NASA CEA's thermo data. */
const LIQUIDS: Record<'C8H18' | 'C12H23', number> = { C8H18: -250.1e3, C12H23: -303.403e3 };

export const FUEL_SOURCE =
  'NASA 7-coefficient polynomials (GRI-Mech 3.0, Burcat); liquid n-octane from the NIST Chemistry WebBook and ' +
  'Jet-A (C₁₂H₂₃) from NASA CEA; water’s enthalpy of vaporization from CODATA key values';

/** A fuel from the list, or one typed as a formula with its enthalpy of formation in kJ/mol. */
export function fuelOf(id: FuelId, custom?: { formula: string; hf: number; liquid: boolean }): Fuel {
  if (id === 'custom') {
    if (!custom) throw new ThermoError('fuelFormula');
    const atoms = atomsOf(custom.formula);
    return { formula: custom.formula, atoms, M: massOf(atoms), hf: custom.hf * 1000, liquid: custom.liquid };
  }
  const atoms = atomsOf(id);
  if (id === 'C8H18' || id === 'C12H23') return { formula: id, atoms, M: massOf(atoms), hf: LIQUIDS[id], liquid: true };
  return { formula: id, atoms, M: massOf(atoms), hf: hMol(SPECIES[id], 298.15), nasa: id, liquid: false };
}

/** Moles of O₂ per mole of fuel for complete combustion: x + y/4 − z/2. */
export function stoichO2(atoms: Atoms): number {
  if (!((atoms.C ?? 0) > 0 || (atoms.H ?? 0) > 0)) throw new ThermoError('fuelFormula');
  const need = (atoms.C ?? 0) + (atoms.H ?? 0) / 4 - (atoms.O ?? 0) / 2;
  if (!(need > 0)) throw new ThermoError('fuelNeedsNoOxygen');
  return need;
}

/** N₂ per O₂ in air (21 % O₂, the argon counted as nitrogen), and air's molar mass for the air-fuel ratio. */
export const N2_PER_O2 = 3.76;
export const M_AIR = 28.97;

export interface Mixture {
  fuel: Fuel;
  oxidizer: Oxidizer;
  /** Moles of O₂ supplied per mole of fuel. */
  a: number;
  aStoich: number;
  phi: number;
}

export function mixtureOf(fuel: Fuel, oxidizer: Oxidizer, phi: number): Mixture {
  if (!(phi > 0) || !Number.isFinite(phi)) throw new ThermoError('phiRange');
  const aStoich = stoichO2(fuel.atoms);
  return { fuel, oxidizer, a: aStoich / phi, aStoich, phi };
}

/** The reactants' enthalpy (J per mol of fuel) and gas moles at T; a fuel without polynomials enters at 298.15 K. */
export function reactants(mix: Mixture, T: number): { H: number; gasMoles: number } {
  const air = mix.oxidizer === 'air';
  const hFuel = mix.fuel.nasa ? hMol(SPECIES[mix.fuel.nasa], T) : mix.fuel.hf;
  const H = hFuel + mix.a * hMol(SPECIES.O2, T) + (air ? mix.a * N2_PER_O2 * hMol(SPECIES.N2, T) : 0);
  return { H, gasMoles: (mix.fuel.liquid ? 0 : 1) + mix.a * (air ? 1 + N2_PER_O2 : 1) };
}

/**
 * Complete combustion. Lean or stoichiometric: CO₂, H₂O, the spare O₂, and N₂. Rich: hydrogen burns to water
 * first, then carbon to CO, and what oxygen is left turns CO to CO₂; too little for that and soot would form.
 */
export function completeProducts(mix: Mixture): Amounts {
  const { C = 0, H = 0, O = 0, N = 0 } = mix.fuel.atoms;
  const oxygen = O + 2 * mix.a;
  const nitrogen = (N + (mix.oxidizer === 'air' ? 2 * N2_PER_O2 * mix.a : 0)) / 2;
  const n: Amounts = { N2: nitrogen };
  if (mix.phi <= 1 + 1e-12) {
    return { CO2: C, H2O: H / 2, O2: Math.max(0, mix.a - mix.aStoich), ...n };
  }
  const water = Math.min(H / 2, oxygen);
  const left = oxygen - water;
  if (C > 0 && left < C - 1e-12) throw new ThermoError('tooRich');
  return { CO2: C > 0 ? left - C : 0, CO: C > 0 ? 2 * C - left : 0, H2O: water, H2: H / 2 - water, ...n };
}

/** The atoms of the reactants per mole of fuel. */
export function mixtureAtoms(mix: Mixture): Record<'C' | 'H' | 'O' | 'N', number> {
  const { C = 0, H = 0, O = 0, N = 0 } = mix.fuel.atoms;
  return { C, H, O: O + 2 * mix.a, N: N + (mix.oxidizer === 'air' ? 2 * N2_PER_O2 * mix.a : 0) };
}

/** Air-fuel ratio by mass and by moles (oxidizer-fuel for pure oxygen). */
export function airFuel(mix: Mixture): { mass: number; mole: number } {
  const air = mix.oxidizer === 'air';
  const mole = mix.a * (air ? 1 + N2_PER_O2 : 1);
  return { mole, mass: (air ? mole * M_AIR : mix.a * SPECIES.O2.M) / mix.fuel.M };
}

/** Water's enthalpy of vaporization at 298.15 K, J/mol: CODATA ΔfH°, liquid −285.830 and gas −241.826 kJ/mol. */
export const HFG_WATER = 44.004e3;

/** Lower and upper heating values, J per mole of fuel at 298.15 K, with the fuel's nitrogen leaving as N₂. */
export function heatingValues(fuel: Fuel): { lhv: number; hhv: number } {
  const { C = 0, H = 0 } = fuel.atoms;
  const products = C * hMol(SPECIES.CO2, 298.15) + (H / 2) * hMol(SPECIES.H2O, 298.15);
  const lhv = fuel.hf - products;
  return { lhv, hhv: lhv + (H / 2) * HFG_WATER };
}

/** The products' dew point, K, from the water's partial pressure (kPa); null below the triple point or above critical. */
export function dewPoint(pv: number): number | null {
  if (!(pv >= 0.611213) || pv > 22064) return null;
  return tsat(pv);
}
