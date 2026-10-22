// Lookups in the property tables: saturated steam by temperature or pressure with linear interpolation between
// rows (the way a textbook table is read), and ideal-gas specific heats by temperature.
import { GAS_ROWS, GAS_TEMPS } from './gasData';
import type { GasRow } from './gasData';
import { STEAM_BY_P, STEAM_BY_T, STEAM_SOURCE } from './steamData';
import type { SteamRow } from './steamData';

export interface Steam {
  /** Saturation temperature, degrees C. */
  T: number;
  /** Saturation pressure, kPa. */
  P: number;
  vf: number;
  vg: number;
  uf: number;
  ufg: number;
  ug: number;
  hf: number;
  hfg: number;
  hg: number;
  sf: number;
  sfg: number;
  sg: number;
  /** The citation for this row. */
  source: string;
  /** True when the values were interpolated between two table rows. */
  interpolated: boolean;
}

export const STEAM_COLUMNS = ['T', 'P', 'vf', 'vg', 'uf', 'ufg', 'ug', 'hf', 'hfg', 'hg', 'sf', 'sfg', 'sg'] as const;
export type SteamColumn = (typeof STEAM_COLUMNS)[number];

const asSteam = (row: readonly number[], interpolated: boolean): Steam => {
  const [T, P, vf, vg, uf, ufg, ug, hf, hfg, hg, sf, sfg, sg] = row;
  return { T, P, vf, vg, uf, ufg, ug, hf, hfg, hg, sf, sfg, sg, source: STEAM_SOURCE, interpolated };
};

export const steamRows = (by: 'T' | 'P'): Steam[] =>
  (by === 'T' ? STEAM_BY_T : STEAM_BY_P).map((r) => asSteam(r, false));

/** Saturated water at a temperature (degrees C) or a pressure (kPa), or null outside the table. */
export function steamAt(by: 'T' | 'P', value: number): Steam | null {
  const rows: readonly SteamRow[] = by === 'T' ? STEAM_BY_T : STEAM_BY_P;
  const index = by === 'T' ? 0 : 1;
  if (!Number.isFinite(value) || value < rows[0][index] || value > rows[rows.length - 1][index]) return null;
  const upper = rows.findIndex((r) => r[index] >= value);
  if (rows[upper][index] === value) return asSteam(rows[upper], false);
  const lo = rows[upper - 1];
  const hi = rows[upper];
  const f = (value - lo[index]) / (hi[index] - lo[index]);
  return asSteam(
    lo.map((x, i) => x + f * (hi[i] - x)),
    true,
  );
}

export interface Gas {
  name: string;
  formula: string;
  /** g/mol */
  molarMass: number;
  /** kJ/(kg·K) */
  R: number;
  source: string;
}

export const GAS_SOURCE_NAME = 'CoolProp 8.0.0 (MIT) ideal-gas cp; R from CODATA 2018';

export const gases = (): Gas[] =>
  GAS_ROWS.map((r: GasRow) => ({ name: r[0], formula: r[1], molarMass: r[2], R: r[3], source: GAS_SOURCE_NAME }));

export { GAS_TEMPS };

/** cp of an ideal gas in kJ/(kg·K) at T (kelvins), interpolated; null outside 250 to 1000 K or for an unknown gas. */
export function gasCp(name: string, T: number): number | null {
  const row = GAS_ROWS.find((r) => r[0] === name);
  if (!row || !(T >= GAS_TEMPS[0] && T <= GAS_TEMPS[GAS_TEMPS.length - 1])) return null;
  const k = GAS_TEMPS.findIndex((t) => t >= T);
  if (GAS_TEMPS[k] === T) return row[4][k];
  const f = (T - GAS_TEMPS[k - 1]) / (GAS_TEMPS[k] - GAS_TEMPS[k - 1]);
  return row[4][k - 1] + f * (row[4][k] - row[4][k - 1]);
}

/** cv = cp − R and k = cp/cv for an ideal gas at T. */
export function gasProperties(name: string, T: number): { cp: number; cv: number; k: number; R: number } | null {
  const cp = gasCp(name, T);
  const row = GAS_ROWS.find((r) => r[0] === name);
  if (cp === null || !row) return null;
  const R = row[3];
  return { cp, cv: cp - R, k: cp / (cp - R), R };
}
