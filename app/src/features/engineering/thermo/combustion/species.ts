// The gases a flame can hold, their atoms, and their NASA-polynomial properties. The fits are published from 200 K
// to 3500 K (6000 K for N₂ and OH), and a flame may run a little past that. So the high-temperature fit carries on
// to 4000 K, where its heat capacities still agree with JANAF tables within a few percent. The results say when.
import { ThermoError } from '../common/types';
import { RU, SPECIES, type Species } from '../data/nasa';

/** The hottest temperature the kit will extrapolate the polynomials to, K. */
export const T_LIMIT = 4000;

export const ELEMENTS = ['C', 'H', 'O', 'N'] as const;
export type Element = (typeof ELEMENTS)[number];
export type Atoms = Readonly<Partial<Record<Element, number>>>;

/** The products the equilibrium solver may form: no solid carbon, no unburned fuel. */
export const PRODUCTS = ['N2', 'O2', 'H2O', 'CO2', 'CO', 'H2', 'OH', 'H', 'O', 'NO'] as const;
export type ProductId = (typeof PRODUCTS)[number];
export type Amounts = Partial<Record<ProductId, number>>;

/** Each product's atoms. */
export const PRODUCT_ATOMS: Record<ProductId, Atoms> = {
  N2: { N: 2 },
  O2: { O: 2 },
  H2O: { H: 2, O: 1 },
  CO2: { C: 1, O: 2 },
  CO: { C: 1, O: 1 },
  H2: { H: 2 },
  OH: { O: 1, H: 1 },
  H: { H: 1 },
  O: { O: 1 },
  NO: { N: 1, O: 1 },
};

/** The product's formula as LaTeX, such as CO_{2}. */
export const productTex = (id: string): string => id.replace(/(\d+)/g, '_{$1}');

/** The atoms of a formula such as C3H8; only C, H, O, and N are allowed in a fuel. */
export function atomsOf(formula: string): Atoms {
  const atoms: Partial<Record<Element, number>> = {};
  const clean = formula.replace(/\s+/g, '');
  if (!/^([A-Z][a-z]?\d*(\.\d+)?)+$/.test(clean)) throw new ThermoError('fuelFormula');
  for (const [, element, count] of clean.matchAll(/([A-Z][a-z]?)(\d*(?:\.\d+)?)/g)) {
    if (!(ELEMENTS as readonly string[]).includes(element)) throw new ThermoError('unknownElement', { element });
    const e = element as Element;
    atoms[e] = (atoms[e] ?? 0) + (count === '' ? 1 : Number(count));
  }
  return atoms;
}

/** Standard atomic weights, g/mol (as in data/nasa.ts). */
const WEIGHT: Record<Element, number> = { C: 12.011, H: 1.008, O: 15.999, N: 14.007 };

export const massOf = (atoms: Atoms): number => ELEMENTS.reduce((sum, e) => sum + (atoms[e] ?? 0) * WEIGHT[e], 0);

/** Whether T is past the published range of any of these species. */
export const extrapolated = (ids: readonly ProductId[], T: number): boolean => ids.some((id) => T > SPECIES[id].tMax);

function coefficients(species: Species, T: number): readonly number[] {
  if (!(T >= 200)) throw new ThermoError('flameLow');
  if (!(T <= Math.max(species.tMax, T_LIMIT))) throw new ThermoError('flameHigh', { max: String(T_LIMIT) });
  return T < 1000 ? species.low : species.high;
}

/** Molar enthalpy with formation, J/mol. */
export function hMol(species: Species, T: number): number {
  const a = coefficients(species, T);
  return (a[0] + T * (a[1] / 2 + T * (a[2] / 3 + T * (a[3] / 4 + (T * a[4]) / 5))) + a[5] / T) * RU * T;
}

/** Molar cp, J/(mol K). */
export function cpMol(species: Species, T: number): number {
  const a = coefficients(species, T);
  return (a[0] + T * (a[1] + T * (a[2] + T * (a[3] + T * a[4])))) * RU;
}

/** g°/(R T) at 1 bar: h/(RT) − s°/R. */
export function g0RT(species: Species, T: number): number {
  const a = coefficients(species, T);
  const hRT = a[0] + T * (a[1] / 2 + T * (a[2] / 3 + T * (a[3] / 4 + (T * a[4]) / 5))) + a[5] / T;
  const sR = a[0] * Math.log(T) + T * (a[1] + T * (a[2] / 2 + T * (a[3] / 3 + (T * a[4]) / 4))) + a[6];
  return hRT - sR;
}

/** The total enthalpy (J) and heat capacity (J/K) of a set of products at T. */
export function productH(n: Amounts, T: number): { H: number; Cp: number; moles: number } {
  let H = 0;
  let Cp = 0;
  let moles = 0;
  for (const id of PRODUCTS) {
    const amount = n[id] ?? 0;
    if (amount <= 0) continue;
    H += amount * hMol(SPECIES[id], T);
    Cp += amount * cpMol(SPECIES[id], T);
    moles += amount;
  }
  return { H, Cp, moles };
}

/** The atoms in a set of products. */
export function atomsIn(n: Amounts): Record<Element, number> {
  const out: Record<Element, number> = { C: 0, H: 0, O: 0, N: 0 };
  for (const id of PRODUCTS) for (const e of ELEMENTS) out[e] += (n[id] ?? 0) * (PRODUCT_ATOMS[id][e] ?? 0);
  return out;
}
