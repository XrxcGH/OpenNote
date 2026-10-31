// Stable isotopes and mineral formulas: delta, alpha, epsilon, and Δ conversions; Rayleigh (open) and batch
// (closed) fractionation; concentration-weighted mixing of two or three end members; and cations per formula from
// oxide weight percents with Fe3+ by charge balance (Droop 1987).
import { check } from '../core/problem';

/** α between two phases from their δ values (per mil): α = (1000 + δA)/(1000 + δB). */
export function alphaOf(deltaA: number, deltaB: number): { alpha: number; epsilon: number; big: number; ln: number } {
  check(deltaA > -1000 && deltaB > -1000, 'delta');
  const alpha = (1000 + deltaA) / (1000 + deltaB);
  return { alpha, epsilon: (alpha - 1) * 1000, big: deltaA - deltaB, ln: 1000 * Math.log(alpha) };
}

/**
 * Fractionation as a reservoir is used up: f is the fraction left and α = R_product/R_reservoir. Open (Rayleigh):
 * δ = (δ0 + 1000) f^(α − 1) − 1000. Closed (batch, all product kept in contact): R/R0 = 1/(f + α(1 − f)).
 */
export function fractionation(
  delta0: number,
  alpha: number,
  f: number,
): { rayleigh: number; batch: number; product: number } {
  check(alpha > 0, 'alpha');
  check(f > 0 && f <= 1, 'fraction');
  check(delta0 > -1000, 'delta');
  const r0 = delta0 + 1000;
  const rayleigh = r0 * f ** (alpha - 1) - 1000;
  const batch = r0 / (f + alpha * (1 - f)) - 1000;
  // The accumulated product of the open system, by mass balance.
  const product = f < 1 ? (r0 - f * (rayleigh + 1000)) / (1 - f) - 1000 : alpha * r0 - 1000;
  return { rayleigh, batch, product };
}

export interface Member {
  fraction: number;
  concentration: number;
  delta: number;
}

/** δ_mix = Σ fᵢ Cᵢ δᵢ / Σ fᵢ Cᵢ. */
export function mix(members: readonly Member[]): { delta: number; concentration: number } {
  check(members.length >= 2, 'members');
  for (const m of members) check(m.fraction >= 0 && m.concentration >= 0, 'member');
  const total = members.reduce((s, m) => s + m.fraction, 0);
  check(Math.abs(total - 1) < 1e-6, 'fractions');
  const weight = members.reduce((s, m) => s + m.fraction * m.concentration, 0);
  check(weight > 0, 'member');
  return {
    delta: members.reduce((s, m) => s + m.fraction * m.concentration * m.delta, 0) / weight,
    concentration: weight,
  };
}

/** Standard atomic weights (IUPAC) of the elements the oxides use. */
const ATOMIC = {
  Si: 28.085,
  Ti: 47.867,
  Al: 26.9815385,
  Cr: 51.9961,
  Fe: 55.845,
  Mn: 54.938044,
  Mg: 24.305,
  Ca: 40.078,
  Na: 22.98976928,
  K: 39.0983,
  P: 30.973761998,
  Ni: 58.6934,
  O: 15.999,
} as const;

type Element = Exclude<keyof typeof ATOMIC, 'O'>;

/** Each oxide's cation, cations per formula unit, oxygens, and the cation's charge. */
export const OXIDES = {
  SiO2: { el: 'Si', cat: 1, ox: 2, charge: 4 },
  TiO2: { el: 'Ti', cat: 1, ox: 2, charge: 4 },
  Al2O3: { el: 'Al', cat: 2, ox: 3, charge: 3 },
  Cr2O3: { el: 'Cr', cat: 2, ox: 3, charge: 3 },
  FeO: { el: 'Fe', cat: 1, ox: 1, charge: 2 },
  MnO: { el: 'Mn', cat: 1, ox: 1, charge: 2 },
  MgO: { el: 'Mg', cat: 1, ox: 1, charge: 2 },
  NiO: { el: 'Ni', cat: 1, ox: 1, charge: 2 },
  CaO: { el: 'Ca', cat: 1, ox: 1, charge: 2 },
  Na2O: { el: 'Na', cat: 2, ox: 1, charge: 1 },
  K2O: { el: 'K', cat: 2, ox: 1, charge: 1 },
  P2O5: { el: 'P', cat: 2, ox: 5, charge: 5 },
} as const satisfies Record<string, { el: Element; cat: number; ox: number; charge: number }>;

export type Oxide = keyof typeof OXIDES;
export const OXIDE_NAMES = Object.keys(OXIDES) as Oxide[];

export const molarMass = (oxide: Oxide): number => {
  const o = OXIDES[oxide];
  return o.cat * ATOMIC[o.el] + o.ox * ATOMIC.O;
};

export interface Formula {
  cations: Partial<Record<Element | 'Fe3', number>>;
  total: number;
  /** Fe3+ per formula by Droop (1987), when an ideal cation total was given. */
  fe3: number;
  sum: number;
}

/** Cations per `oxygens` oxygens from oxide wt% (all iron as FeO), with Fe3+ by charge balance when `ideal` is set. */
export function formula(analysis: Partial<Record<Oxide, number>>, oxygens: number, ideal: number | null): Formula {
  check(oxygens > 0, 'oxygens');
  const entries = OXIDE_NAMES.filter((o) => (analysis[o] ?? 0) !== 0).map((o) => [o, analysis[o]!] as const);
  for (const [, wt] of entries) check(wt >= 0, 'oxide');
  check(entries.length > 0, 'noOxides');
  const sum = entries.reduce((s, [, wt]) => s + wt, 0);
  const moles = entries.map(([o, wt]) => [o, wt / molarMass(o)] as const);
  const oxygenTotal = moles.reduce((s, [o, m]) => s + m * OXIDES[o].ox, 0);
  const scale = oxygens / oxygenTotal;
  const cations: Formula['cations'] = {};
  for (const [o, m] of moles) {
    const el = OXIDES[o].el;
    cations[el] = (cations[el] ?? 0) + m * OXIDES[o].cat * scale;
  }
  const total = Object.values(cations).reduce((s, v) => s + (v ?? 0), 0);
  let fe3 = 0;
  if (ideal !== null) {
    check(ideal > 0, 'ideal');
    // Droop (1987): F = 2X(1 − T/S), capped by the iron present.
    const back = ideal / total;
    fe3 = Math.max(0, Math.min((cations.Fe ?? 0) * back, 2 * oxygens * (1 - back)));
    if (fe3 > 0) {
      // Droop's F is per formula once the cations are scaled to the ideal total.
      for (const key of Object.keys(cations) as (keyof Formula['cations'])[]) cations[key] = cations[key]! * back;
      cations.Fe3 = fe3;
      cations.Fe = (cations.Fe ?? 0) - fe3;
    }
  }
  return { cations, total: Object.entries(cations).reduce((s, [, v]) => s + (v ?? 0), 0), fe3, sum };
}
