// The units the physics tools take and show, by what they measure. Each unit is its symbol and its factor to the SI
// unit (and an offset for temperatures), so a value in SI is value * factor + offset. Factors are exact definitions
// (NIST SP 811, the 2019 SI) or CODATA 2022 values where a unit rests on a measured constant (u, eV-based masses).
import { C, E_CHARGE, U_KG } from './constants';

export type UnitDef = readonly [symbol: string, factor: number, offset?: number];

interface DimDef {
  si: string;
  /** The US customary unit, when one is in common use. */
  us?: string;
  units: readonly UnitDef[];
}

const FT = 0.3048;
const IN = 0.0254;
const LB = 0.45359237;
const LBF = 4.4482216152605;
const SLUG = LBF / FT;
const DAY = 86_400;
const MEV = 1e6 * E_CHARGE;

export const DIMS = {
  length: {
    si: 'm',
    us: 'ft',
    units: [
      ['m', 1],
      ['km', 1e3],
      ['cm', 1e-2],
      ['mm', 1e-3],
      ['µm', 1e-6],
      ['nm', 1e-9],
      ['pm', 1e-12],
      ['fm', 1e-15],
      ['ft', FT],
      ['in', IN],
      ['mi', 1609.344],
      ['nmi', 1852],
      ['AU', 1.495978707e11],
      ['light-s', C],
    ],
  },
  area: {
    si: 'm²',
    us: 'ft²',
    units: [
      ['m²', 1],
      ['cm²', 1e-4],
      ['mm²', 1e-6],
      ['km²', 1e6],
      ['ft²', FT * FT],
      ['in²', IN * IN],
    ],
  },
  speed: {
    si: 'm/s',
    us: 'ft/s',
    units: [
      ['m/s', 1],
      ['km/s', 1e3],
      ['km/h', 1 / 3.6],
      ['cm/s', 1e-2],
      ['ft/s', FT],
      ['mph', 0.44704],
    ],
  },
  frequency: {
    si: 'Hz',
    units: [
      ['Hz', 1],
      ['kHz', 1e3],
      ['MHz', 1e6],
      ['GHz', 1e9],
      ['THz', 1e12],
    ],
  },
  force: {
    si: 'N',
    us: 'lbf',
    units: [
      ['N', 1],
      ['kN', 1e3],
      ['mN', 1e-3],
      ['µN', 1e-6],
      ['lbf', LBF],
    ],
  },
  linearDensity: {
    si: 'kg/m',
    us: 'lb/ft',
    units: [
      ['kg/m', 1],
      ['g/m', 1e-3],
      ['g/cm', 0.1],
      ['lb/ft', LB / FT],
      ['lb/in', LB / IN],
    ],
  },
  mass: {
    si: 'kg',
    us: 'lb',
    units: [
      ['kg', 1],
      ['g', 1e-3],
      ['mg', 1e-6],
      ['t', 1e3],
      ['lb', LB],
      ['slug', SLUG],
      ['u', U_KG],
      ['MeV/c²', MEV / (C * C)],
    ],
  },
  time: {
    si: 's',
    units: [
      ['s', 1],
      ['ms', 1e-3],
      ['µs', 1e-6],
      ['ns', 1e-9],
      ['min', 60],
      ['h', 3600],
      ['d', DAY],
      ['y', 365.25 * DAY],
    ],
  },
  charge: {
    si: 'C',
    units: [
      ['C', 1],
      ['mC', 1e-3],
      ['µC', 1e-6],
      ['nC', 1e-9],
      ['pC', 1e-12],
      ['e', E_CHARGE],
    ],
  },
  current: {
    si: 'A',
    units: [
      ['A', 1],
      ['mA', 1e-3],
      ['µA', 1e-6],
      ['kA', 1e3],
    ],
  },
  voltage: {
    si: 'V',
    units: [
      ['V', 1],
      ['mV', 1e-3],
      ['kV', 1e3],
      ['MV', 1e6],
    ],
  },
  efield: {
    si: 'N/C',
    units: [
      ['N/C', 1],
      ['V/m', 1],
      ['kV/m', 1e3],
      ['V/cm', 100],
      ['MV/m', 1e6],
    ],
  },
  bfield: {
    si: 'T',
    units: [
      ['T', 1],
      ['mT', 1e-3],
      ['µT', 1e-6],
      ['nT', 1e-9],
      ['G', 1e-4],
    ],
  },
  capacitance: {
    si: 'F',
    units: [
      ['F', 1],
      ['mF', 1e-3],
      ['µF', 1e-6],
      ['nF', 1e-9],
      ['pF', 1e-12],
    ],
  },
  inductance: {
    si: 'H',
    units: [
      ['H', 1],
      ['mH', 1e-3],
      ['µH', 1e-6],
      ['nH', 1e-9],
    ],
  },
  flux: {
    si: 'Wb',
    units: [
      ['Wb', 1],
      ['mWb', 1e-3],
      ['µWb', 1e-6],
      ['T·m²', 1],
    ],
  },
  resistance: {
    si: 'Ω',
    units: [
      ['Ω', 1],
      ['mΩ', 1e-3],
      ['kΩ', 1e3],
      ['MΩ', 1e6],
    ],
  },
  energy: {
    si: 'J',
    us: 'Btu',
    units: [
      ['J', 1],
      ['kJ', 1e3],
      ['MJ', 1e6],
      ['eV', E_CHARGE],
      ['keV', 1e3 * E_CHARGE],
      ['MeV', MEV],
      ['GeV', 1e3 * MEV],
      ['W·h', 3600],
      ['kWh', 3.6e6],
      ['Btu', 1055.05585262],
      ['ft·lbf', FT * LBF],
    ],
  },
  power: {
    si: 'W',
    units: [
      ['W', 1],
      ['mW', 1e-3],
      ['kW', 1e3],
      ['MW', 1e6],
      ['hp', 745.6998715822702],
    ],
  },
  angle: {
    si: 'deg',
    units: [
      ['deg', Math.PI / 180],
      ['rad', 1],
      ['mrad', 1e-3],
      ['µrad', 1e-6],
      ['arcmin', Math.PI / 10_800],
      ['arcsec', Math.PI / 648_000],
    ],
  },
  temperature: {
    si: 'K',
    us: '°F',
    units: [
      ['K', 1],
      ['°C', 1, 273.15],
      ['°F', 5 / 9, 273.15 - (32 * 5) / 9],
      ['°R', 5 / 9],
    ],
  },
  intensity: {
    si: 'W/m²',
    units: [
      ['W/m²', 1],
      ['mW/m²', 1e-3],
      ['µW/m²', 1e-6],
      ['W/cm²', 1e4],
      ['mW/cm²', 10],
    ],
  },
  momentum: {
    si: 'kg·m/s',
    units: [
      ['kg·m/s', 1],
      ['MeV/c', MEV / C],
      ['GeV/c', (1e3 * MEV) / C],
    ],
  },
  activity: {
    si: 'Bq',
    units: [
      ['Bq', 1],
      ['kBq', 1e3],
      ['MBq', 1e6],
      ['GBq', 1e9],
      ['TBq', 1e12],
      ['Ci', 3.7e10],
      ['mCi', 3.7e7],
      ['µCi', 3.7e4],
    ],
  },
  crossSection: {
    si: 'm²',
    units: [
      ['b', 1e-28],
      ['mb', 1e-31],
      ['cm²', 1e-4],
      ['m²', 1],
    ],
  },
  perLength: {
    si: '1/m',
    us: '1/ft',
    units: [
      ['1/m', 1],
      ['1/cm', 100],
      ['1/mm', 1000],
      ['1/ft', 1 / FT],
      ['1/in', 1 / IN],
    ],
  },
  massAttenuation: {
    si: 'm²/kg',
    units: [
      ['cm²/g', 0.1],
      ['m²/kg', 1],
    ],
  },
  density: {
    si: 'kg/m³',
    us: 'lb/ft³',
    units: [
      ['kg/m³', 1],
      ['g/cm³', 1000],
      ['lb/ft³', LB / FT ** 3],
      ['lb/in³', LB / IN ** 3],
    ],
  },
  gravParam: {
    si: 'm³/s²',
    units: [
      ['km³/s²', 1e9],
      ['m³/s²', 1],
    ],
  },
  torque: {
    si: 'N·m',
    us: 'lbf·ft',
    units: [
      ['N·m', 1],
      ['mN·m', 1e-3],
      ['µN·m', 1e-6],
      ['lbf·ft', LBF * FT],
      ['lbf·in', LBF * IN],
    ],
  },
  angularMomentum: {
    si: 'N·m·s',
    us: 'lbf·ft·s',
    units: [
      ['N·m·s', 1],
      ['mN·m·s', 1e-3],
      ['lbf·ft·s', LBF * FT],
    ],
  },
  inertia: {
    si: 'kg·m²',
    us: 'slug·ft²',
    units: [
      ['kg·m²', 1],
      ['slug·ft²', SLUG * FT * FT],
      ['lb·ft²', LB * FT * FT],
    ],
  },
  dipole: { si: 'A·m²', units: [['A·m²', 1]] },
  chargeLine: {
    si: 'C/m',
    units: [
      ['C/m', 1],
      ['µC/m', 1e-6],
      ['nC/m', 1e-9],
    ],
  },
  chargeSurface: {
    si: 'C/m²',
    units: [
      ['C/m²', 1],
      ['µC/m²', 1e-6],
      ['nC/m²', 1e-9],
    ],
  },
  chargeVolume: {
    si: 'C/m³',
    units: [
      ['C/m³', 1],
      ['µC/m³', 1e-6],
      ['nC/m³', 1e-9],
    ],
  },
  doseRate: {
    si: 'Sv/h',
    units: [
      ['Sv/h', 1 / 3600],
      ['mSv/h', 1e-3 / 3600],
      ['µSv/h', 1e-6 / 3600],
      ['rem/h', 1e-2 / 3600],
      ['mrem/h', 1e-5 / 3600],
    ],
  },
  angularRate: {
    si: 'rad/s',
    units: [
      ['rad/s', 1],
      ['deg/s', Math.PI / 180],
      ['deg/day', Math.PI / 180 / DAY],
      ['rev/day', (2 * Math.PI) / DAY],
    ],
  },
  dataRate: {
    si: 'bit/s',
    units: [
      ['bit/s', 1],
      ['kbit/s', 1e3],
      ['Mbit/s', 1e6],
      ['Gbit/s', 1e9],
    ],
  },
} as const satisfies Record<string, DimDef>;

export type DimId = keyof typeof DIMS;

/** The unit with this symbol in the dimension, or undefined. */
export function unitOf(dim: DimId, symbol: string): UnitDef | undefined {
  return (DIMS[dim].units as readonly UnitDef[]).find((unit) => unit[0] === symbol);
}

/** A value in the unit, in SI. */
export function toSI(value: number, dim: DimId, symbol: string): number {
  const unit = unitOf(dim, symbol);
  if (!unit) throw new Error(`No unit ${symbol} for ${dim}`);
  return value * unit[1] + (unit[2] ?? 0);
}

/** A value in SI, in the unit. */
export function fromSI(value: number, dim: DimId, symbol: string): number {
  const unit = unitOf(dim, symbol);
  if (!unit) throw new Error(`No unit ${symbol} for ${dim}`);
  return (value - (unit[2] ?? 0)) / unit[1];
}

/** The unit a field or result starts in, for the unit system. */
export function defaultUnit(dim: DimId, system: 'SI' | 'US', si?: string, us?: string): string {
  const def: DimDef = DIMS[dim];
  if (system === 'US') return us ?? def.us ?? si ?? def.si;
  return si ?? def.si;
}
