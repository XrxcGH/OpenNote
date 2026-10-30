// Ideal-gas properties from NASA 7-coefficient polynomials, in the NASA Glenn format of McBride, Gordon, and Reno
// (NASA TM-4513, public domain). Each species has one fit below 1000 K and one above.
//
// - cp/R = a1 + a2 T + a3 T^2 + a4 T^3 + a5 T^4
// - h/(R T) = a1 + a2 T/2 + a3 T^2/3 + a4 T^3/4 + a5 T^4/5 + a6/T
// - s0/R = a1 ln T + a2 T + a3 T^2/2 + a4 T^3/3 + a5 T^4/4 + a7
//
// h includes the enthalpy of formation at 298.15 K, and s0 is at the standard pressure of 1 bar. The coefficients
// are the published fits of GRI-Mech 3.0 (Smith et al.) and Burcat's database, both openly published. Tests check
// them against CODATA key values at 298.15 K and for continuity at 1000 K.
import { ThermoError } from '../common/types';

export const NASA_SOURCE =
  'NASA 7-coefficient polynomials (NASA TM-4513 format), as published in GRI-Mech 3.0 and Burcat’s database';

/** Molar gas constant, J/(mol K) (exact since the 2019 SI). */
export const RU = 8.314462618;

export interface Species {
  formula: string;
  /** Molar mass, g/mol, from IUPAC standard atomic weights. */
  M: number;
  low: readonly number[];
  high: readonly number[];
  tMax: number;
}

const ATOMIC: Record<string, number> = { C: 12.011, H: 1.008, O: 15.999, N: 14.007, Ar: 39.948, He: 4.0026 };

/** The molar mass of a formula such as C3H8, from standard atomic weights. */
export function molarMass(formula: string): number {
  let total = 0;
  for (const [, element, count] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    const weight = ATOMIC[element];
    if (weight === undefined) throw new ThermoError('unknownElement', { element });
    total += weight * (count === '' ? 1 : Number(count));
  }
  return total;
}

const sp = (formula: string, low: number[], high: number[], tMax = 3500): Species => ({
  formula,
  M: molarMass(formula),
  low,
  high,
  tMax,
});

const MONATOMIC = (a7: number, a6 = -745.375): number[] => [2.5, 0, 0, 0, 0, a6, a7];

export const SPECIES = {
  N2: sp(
    'N2',
    [3.53100528, -1.23660988e-4, -5.02999433e-7, 2.43530612e-9, -1.40881235e-12, -1046.97628, 2.96747038],
    [2.95257637, 1.3969004e-3, -4.92631603e-7, 7.86010195e-11, -4.60755204e-15, -923.948688, 5.87188762],
    6000,
  ),
  O2: sp(
    'O2',
    [3.78245636, -2.99673416e-3, 9.84730201e-6, -9.68129509e-9, 3.24372837e-12, -1063.94356, 3.65767573],
    [3.28253784, 1.48308754e-3, -7.57966669e-7, 2.09470555e-10, -2.16717794e-14, -1088.45772, 5.45323129],
  ),
  Ar: sp('Ar', MONATOMIC(4.37967491), MONATOMIC(4.37967491), 6000),
  He: sp('He', MONATOMIC(0.928723974), MONATOMIC(0.928723974), 6000),
  H2O: sp(
    'H2O',
    [4.19864056, -2.0364341e-3, 6.52040211e-6, -5.48797062e-9, 1.77197817e-12, -30293.7267, -0.849032208],
    [3.03399249, 2.17691804e-3, -1.64072518e-7, -9.7041987e-11, 1.68200992e-14, -30004.2971, 4.9667701],
  ),
  CO2: sp(
    'CO2',
    [2.35677352, 8.98459677e-3, -7.12356269e-6, 2.45919022e-9, -1.43699548e-13, -48371.9697, 9.90105222],
    [3.85746029, 4.41437026e-3, -2.21481404e-6, 5.23490188e-10, -4.72084164e-14, -48759.166, 2.27163806],
  ),
  CO: sp(
    'CO',
    [3.57953347, -6.1035368e-4, 1.01681433e-6, 9.07005884e-10, -9.04424499e-13, -14344.086, 3.50840928],
    [2.71518561, 2.06252743e-3, -9.98825771e-7, 2.30053008e-10, -2.03647716e-14, -14151.8724, 7.81868772],
  ),
  H2: sp(
    'H2',
    [2.34433112, 7.98052075e-3, -1.9478151e-5, 2.01572094e-8, -7.37611761e-12, -917.935173, 0.683010238],
    [3.3372792, -4.94024731e-5, 4.99456778e-7, -1.79566394e-10, 2.00255376e-14, -950.158922, -3.20502331],
  ),
  OH: sp(
    'OH',
    [3.99198424, -2.40106655e-3, 4.61664033e-6, -3.87916306e-9, 1.36319502e-12, 3368.89836, -0.103998477],
    [2.83853033, 1.10741289e-3, -2.94000209e-7, 4.20698729e-11, -2.4228989e-15, 3697.80808, 5.84494652],
    6000,
  ),
  H: sp(
    'H',
    [2.5, 7.05332819e-13, -1.99591964e-15, 2.30081632e-18, -9.27732332e-22, 25473.6599, -0.446682853],
    [2.50000001, -2.30842973e-11, 1.61561948e-14, -4.73515235e-18, 4.98197357e-22, 25473.6599, -0.446682914],
  ),
  O: sp(
    'O',
    [3.1682671, -3.27931884e-3, 6.64306396e-6, -6.12806624e-9, 2.11265971e-12, 29122.2592, 2.05193346],
    [2.56942078, -8.59741137e-5, 4.19484589e-8, -1.00177799e-11, 1.22833691e-15, 29217.5791, 4.78433864],
  ),
  NO: sp(
    'NO',
    [4.2184763, -4.638976e-3, 1.1041022e-5, -9.3361354e-9, 2.803577e-12, 9844.623, 2.2808464],
    [3.2606056, 1.1911043e-3, -4.2917048e-7, 6.9457669e-11, -4.0336099e-15, 9920.9746, 6.3693027],
  ),
  CH4: sp(
    'CH4',
    [5.14987613, -1.36709788e-2, 4.91800599e-5, -4.84743026e-8, 1.66693956e-11, -10246.6476, -4.64130376],
    [7.4851495e-2, 1.33909467e-2, -5.73285809e-6, 1.22292535e-9, -1.0181523e-13, -9468.34459, 18.437318],
  ),
  C3H8: sp(
    'C3H8',
    [0.93355381, 2.6424579e-2, 6.1059727e-6, -2.1977499e-8, 9.5149253e-12, -13958.52, 19.201691],
    [7.5341368, 1.8872239e-2, -6.2718491e-6, 9.1475649e-10, -4.7838069e-14, -16467.516, -17.892349],
  ),
} as const satisfies Record<string, Species>;

export type SpeciesId = keyof typeof SPECIES;

function coefficients(species: Species, T: number): readonly number[] {
  if (!(T >= 200 && T <= species.tMax))
    throw new ThermoError('gasRange', { formula: species.formula, max: String(species.tMax) });
  return T < 1000 ? species.low : species.high;
}

/** cp / R at T (K). */
export function cpR(species: Species, T: number): number {
  const a = coefficients(species, T);
  return a[0] + T * (a[1] + T * (a[2] + T * (a[3] + T * a[4])));
}

/** h / (R T) at T (K), with the enthalpy of formation included. */
export function hRT(species: Species, T: number): number {
  const a = coefficients(species, T);
  return a[0] + T * (a[1] / 2 + T * (a[2] / 3 + T * (a[3] / 4 + (T * a[4]) / 5))) + a[5] / T;
}

/** s0 / R at T (K) and 1 bar. */
export function sR(species: Species, T: number): number {
  const a = coefficients(species, T);
  return a[0] * Math.log(T) + T * (a[1] + T * (a[2] / 2 + T * (a[3] / 3 + (T * a[4]) / 4))) + a[6];
}

/** Molar enthalpy (J/mol) including formation, molar cp and s0 (J/(mol K)). */
export const molarH = (species: Species, T: number): number => hRT(species, T) * RU * T;
export const molarCp = (species: Species, T: number): number => cpR(species, T) * RU;
export const molarS = (species: Species, T: number): number => sR(species, T) * RU;
