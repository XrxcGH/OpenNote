// Units for the thermodynamics kit. Engines work in one set of SI units (K, kPa, m3/kg, kJ/kg, kJ/kg K, kW, kg/s);
// fields and results convert to and from the units a student picks in SI or US customary units. The factors are exact
// definitions (the international foot, pound, and Btu), and a test checks them against core/units.

/** The kinds of quantity the kit converts. The engine's unit for each is the first SI unit. */
export type Qty =
  | 'none'
  | 'T'
  | 'dT'
  | 'p'
  | 'v'
  | 'rho'
  | 'e'
  | 's'
  | 'speed'
  | 'power'
  | 'mdot'
  | 'sgen'
  | 'molarE'
  | 'molarS'
  | 'molarM'
  | 'length'
  | 'nano'
  | 'eV'
  | 'wavenumber'
  | 'k'
  | 'mu'
  | 'percent';

export type System = 'SI' | 'US';

export interface UnitDef {
  id: string;
  /** Multiply by this, then add offset, to get the engine unit. */
  factor: number;
  offset?: number;
}

const PSI = 6.894757293168361; // kPa
const FT = 0.3048;
const LBM = 0.45359237;
const BTU = 1.05505585262; // kJ (International Table)

const u = (id: string, factor: number, offset = 0): UnitDef => ({ id, factor, offset });

/** The SI and US unit lists for each kind; the first of each is the default. */
export const UNITS: Record<Qty, { SI: readonly UnitDef[]; US: readonly UnitDef[] }> = {
  none: { SI: [u('', 1)], US: [u('', 1)] },
  percent: { SI: [u('%', 1)], US: [u('%', 1)] },
  T: { SI: [u('K', 1), u('°C', 1, 273.15)], US: [u('°F', 5 / 9, 459.67 * (5 / 9)), u('R', 5 / 9)] },
  dT: { SI: [u('K', 1), u('°C', 1)], US: [u('°F', 5 / 9), u('R', 5 / 9)] },
  p: { SI: [u('kPa', 1), u('MPa', 1000), u('bar', 100), u('Pa', 0.001), u('atm', 101.325)], US: [u('psia', PSI)] },
  v: { SI: [u('m³/kg', 1)], US: [u('ft³/lbm', FT ** 3 / LBM)] },
  rho: { SI: [u('kg/m³', 1)], US: [u('lbm/ft³', LBM / FT ** 3)] },
  e: { SI: [u('kJ/kg', 1), u('MJ/kg', 1000)], US: [u('Btu/lbm', BTU / LBM)] },
  s: { SI: [u('kJ/(kg·K)', 1)], US: [u('Btu/(lbm·R)', BTU / LBM / (5 / 9))] },
  speed: { SI: [u('m/s', 1)], US: [u('ft/s', FT)] },
  power: { SI: [u('kW', 1), u('MW', 1000), u('W', 0.001)], US: [u('Btu/s', BTU), u('hp', 0.745699872)] },
  mdot: { SI: [u('kg/s', 1), u('kg/h', 1 / 3600)], US: [u('lbm/s', LBM), u('lbm/h', LBM / 3600)] },
  sgen: { SI: [u('kW/K', 1)], US: [u('Btu/(s·R)', BTU / (5 / 9))] },
  molarE: { SI: [u('kJ/mol', 1), u('kJ/kmol', 0.001)], US: [u('Btu/lbmol', BTU / LBM / 1000)] },
  molarS: { SI: [u('J/(mol·K)', 1)], US: [u('Btu/(lbmol·R)', (BTU / LBM / (5 / 9)) * 1)] },
  molarM: { SI: [u('g/mol', 1)], US: [u('lbm/lbmol', 1)] },
  length: { SI: [u('m', 1), u('mm', 0.001), u('µm', 1e-6)], US: [u('ft', FT), u('in', FT / 12)] },
  nano: { SI: [u('nm', 1), u('pm', 0.001)], US: [u('nm', 1)] },
  eV: { SI: [u('eV', 1)], US: [u('eV', 1)] },
  wavenumber: { SI: [u('cm⁻¹', 1)], US: [u('cm⁻¹', 1)] },
  k: { SI: [u('W/(m·K)', 1)], US: [u('Btu/(h·ft·R)', (BTU * 1000) / 3600 / FT / (5 / 9))] },
  mu: { SI: [u('Pa·s', 1), u('µPa·s', 1e-6)], US: [u('lbm/(ft·s)', LBM / FT)] },
};

/** Every unit of a kind, the chosen system's first. */
export function unitsFor(qty: Qty, system: System): readonly UnitDef[] {
  const other: System = system === 'SI' ? 'US' : 'SI';
  const seen = new Set<string>();
  return [...UNITS[qty][system], ...UNITS[qty][other]].filter((one) => !seen.has(one.id) && seen.add(one.id));
}

export const defaultUnit = (qty: Qty, system: System): string => UNITS[qty][system][0].id;

function find(qty: Qty, id: string): UnitDef {
  const all = [...UNITS[qty].SI, ...UNITS[qty].US];
  return all.find((one) => one.id === id) ?? all[0];
}

/** A value in the named unit, in the engine's unit. */
export function toEngine(value: number, qty: Qty, unit: string): number {
  const def = find(qty, unit);
  return value * def.factor + (def.offset ?? 0);
}

/** A value in the engine's unit, in the named unit. */
export function fromEngine(value: number, qty: Qty, unit: string): number {
  const def = find(qty, unit);
  return (value - (def.offset ?? 0)) / def.factor;
}
