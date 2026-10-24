// Units for the kit's fields and result rows. Each quantity has a base unit the engines work in (K, Pa, mol/L, s, m,
// g, L, J, J/mol, J/(mol K), A) and a list of units the student can pick, SI, and US customary. The SI / US switch
// chooses which unit a field starts in and which unit results are shown in.
import type { Dim } from './types';

export interface UnitDef {
  symbol: string;
  /** Multiply by this to reach the base unit. */
  factor: number;
  /** Add this after multiplying (degrees Celsius and Fahrenheit). */
  offset?: number;
}

export type System = 'SI' | 'US';

export interface DimDef {
  units: readonly UnitDef[];
  si: string;
  us: string;
}

const u = (symbol: string, factor: number, offset = 0): UnitDef => ({ symbol, factor, ...(offset ? { offset } : {}) });

export const DIMS: Record<Exclude<Dim, 'none'> | 'current', DimDef> = {
  temperature: {
    units: [u('K', 1), u('°C', 1, 273.15), u('°F', 5 / 9, 459.67 * (5 / 9))],
    si: 'K',
    us: '°F',
  },
  pressure: {
    units: [
      u('bar', 1e5),
      u('atm', 101325),
      u('kPa', 1e3),
      u('Pa', 1),
      u('mmHg', 133.322387415),
      u('psi', 6894.757293168),
    ],
    si: 'bar',
    us: 'psi',
  },
  concentration: {
    units: [u('mol/L', 1), u('mmol/L', 1e-3), u('µmol/L', 1e-6), u('mol/m³', 1e-3)],
    si: 'mol/L',
    us: 'mol/L',
  },
  time: {
    units: [u('s', 1), u('min', 60), u('h', 3600), u('d', 86400), u('yr', 365.25 * 86400)],
    si: 's',
    us: 's',
  },
  length: {
    units: [
      u('m', 1),
      u('cm', 1e-2),
      u('mm', 1e-3),
      u('µm', 1e-6),
      u('nm', 1e-9),
      u('pm', 1e-12),
      u('Å', 1e-10),
      u('in', 0.0254),
      u('ft', 0.3048),
    ],
    si: 'nm',
    us: 'in',
  },
  mass: {
    units: [u('g', 1), u('kg', 1e3), u('mg', 1e-3), u('lb', 453.59237), u('oz', 28.349523125)],
    si: 'g',
    us: 'lb',
  },
  volume: {
    units: [u('L', 1), u('mL', 1e-3), u('m³', 1e3), u('gal', 3.785411784), u('fl oz', 0.0295735295625)],
    si: 'mL',
    us: 'fl oz',
  },
  energy: {
    units: [u('J', 1), u('kJ', 1e3), u('eV', 1.602176634e-19), u('kcal', 4184), u('BTU', 1055.05585262)],
    si: 'J',
    us: 'BTU',
  },
  energyMol: { units: [u('kJ/mol', 1e3), u('J/mol', 1), u('kcal/mol', 4184)], si: 'kJ/mol', us: 'kcal/mol' },
  entropyMol: {
    units: [u('J/(mol K)', 1), u('kJ/(mol K)', 1e3), u('cal/(mol K)', 4.184)],
    si: 'J/(mol K)',
    us: 'cal/(mol K)',
  },
  current: { units: [u('A', 1), u('mA', 1e-3)], si: 'A', us: 'A' },
};

export type UnitDim = keyof typeof DIMS;

export function unitOf(dim: UnitDim, symbol: string): UnitDef {
  return DIMS[dim].units.find((x) => x.symbol === symbol) ?? DIMS[dim].units[0];
}

/** A value in a unit to the base unit. (Temperature scales add an offset: K = v * factor + offset.) */
export function convertToBase(value: number, dim: UnitDim, symbol: string): number {
  const unit = unitOf(dim, symbol);
  return value * unit.factor + (unit.offset ?? 0);
}

/** A value in the base unit to a unit. */
export function convertFromBase(value: number, dim: UnitDim, symbol: string): number {
  const unit = unitOf(dim, symbol);
  return (value - (unit.offset ?? 0)) / unit.factor;
}

export function defaultUnit(dim: UnitDim, system: System): string {
  return system === 'SI' ? DIMS[dim].si : DIMS[dim].us;
}

/** Significant figures: fixed notation for ordinary sizes, exponent notation for very large or small numbers. */
export function formatNumber(x: number, digits = 5): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : '—';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  let text: string;
  if (abs >= 1e6 || abs < 1e-3) {
    const [m, e] = x.toExponential(digits - 1).split('e');
    const mantissa = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    text = `${mantissa}e${Number(e)}`;
  } else {
    text = String(Number(x.toPrecision(digits)));
  }
  return text.replace('-', '−');
}
