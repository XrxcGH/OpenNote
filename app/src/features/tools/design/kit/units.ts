// The units the design kit's fields and results use. Each engine works in one unit for a quantity (millimeters,
// newtons, megapascals), and a field offers the units a student meets for that quantity. A typed number is
// multiplied by its unit's factor to give the engine's value, and a result is divided by it to be shown.

export type System = 'si' | 'us';

export interface Unit {
  readonly label: string;
  /** The engine's unit in one of these: engine value = shown value x factor. */
  readonly factor: number;
}

export interface Dim {
  /** The unit a field starts with in each system. */
  readonly si: string;
  readonly us: string;
  readonly units: readonly Unit[];
}

const u = (label: string, factor: number): Unit => ({ label, factor });

const IN = 25.4;
const LBF = 4.4482216152605;
const PSI = 0.006894757293168;

/** Keyed by the engine's unit. */
export const DIMS = {
  mm: {
    si: 'mm',
    us: 'in',
    units: [u('mm', 1), u('cm', 10), u('m', 1000), u('µm', 0.001), u('in', IN), u('ft', 304.8)],
  },
  nm: { si: 'nm', us: 'nm', units: [u('nm', 1), u('µm', 1000), u('mm', 1e6), u('Å', 0.1)] },
  m: {
    si: 'm',
    us: 'in',
    units: [u('m', 1), u('mm', 1e-3), u('µm', 1e-6), u('nm', 1e-9), u('in', 0.0254), u('µin', 2.54e-8)],
  },
  mm2: { si: 'mm²', us: 'in²', units: [u('mm²', 1), u('cm²', 100), u('m²', 1e6), u('in²', IN * IN)] },
  cm2: { si: 'cm²', us: 'in²', units: [u('cm²', 1), u('mm²', 0.01), u('m²', 1e4), u('in²', 6.4516)] },
  cm3: { si: 'cm³', us: 'in³', units: [u('cm³', 1), u('mm³', 0.001), u('L', 1000), u('m³', 1e6), u('in³', 16.387064)] },
  'm/min': { si: 'm/min', us: 'ft/min', units: [u('m/min', 1), u('m/s', 60), u('ft/min', 0.3048)] },
  'mm/rev': { si: 'mm/rev', us: 'in/rev', units: [u('mm/rev', 1), u('in/rev', IN)] },
  'mm/tooth': { si: 'mm/tooth', us: 'in/tooth', units: [u('mm/tooth', 1), u('in/tooth', IN)] },
  'mm/s': { si: 'mm/s', us: 'in/min', units: [u('mm/s', 1), u('mm/min', 1 / 60), u('cm/s', 10), u('in/min', IN / 60)] },
  'rev/s': { si: 'rev/s', us: 'rev/s', units: [u('rev/s', 1), u('rpm', 1 / 60)] },
  N: { si: 'N', us: 'lbf', units: [u('N', 1), u('kN', 1000), u('lbf', LBF), u('kip', LBF * 1000)] },
  W: { si: 'W', us: 'hp', units: [u('W', 1), u('kW', 1000), u('hp', 745.69987158227)] },
  min: { si: 'min', us: 'min', units: [u('s', 1 / 60), u('min', 1), u('h', 60)] },
  s: { si: 's', us: 's', units: [u('ms', 0.001), u('s', 1), u('min', 60), u('h', 3600)] },
  MPa: {
    si: 'MPa',
    us: 'ksi',
    units: [u('MPa', 1), u('GPa', 1000), u('kPa', 0.001), u('psi', PSI), u('ksi', PSI * 1000)],
  },
  Pa: {
    si: 'GPa',
    us: 'Mpsi',
    units: [
      u('Pa', 1),
      u('kPa', 1e3),
      u('MPa', 1e6),
      u('GPa', 1e9),
      u('psi', 6894.757293168),
      u('Mpsi', 6.894757293168e9),
    ],
  },
  'J/mm': { si: 'kJ/mm', us: 'kJ/in', units: [u('J/mm', 1), u('kJ/mm', 1000), u('kJ/in', 1000 / IN)] },
  'min/cm2': {
    si: 'min/cm²',
    us: 'min/in²',
    units: [u('min/cm²', 1), u('s/cm²', 1 / 60), u('min/in²', 1 / 6.4516)],
  },
  'nm/min': {
    si: 'nm/min',
    us: 'nm/min',
    units: [u('nm/min', 1), u('µm/min', 1000), u('Å/min', 0.1), u('nm/s', 60)],
  },
  '1/cm2': { si: '1/cm²', us: '1/in²', units: [u('1/cm²', 1), u('1/mm²', 100), u('1/in²', 1 / 6.4516)] },
  kg: { si: 'kg', us: 'lb', units: [u('kg', 1), u('g', 1e-3), u('lb', 0.45359237)] },
  'kg/m3': {
    si: 'kg/m³',
    us: 'lb/ft³',
    units: [u('kg/m³', 1), u('g/cm³', 1000), u('lb/ft³', 16.01846337)],
  },
  deg: { si: '°', us: '°', units: [u('°', 1), u('rad', 180 / Math.PI)] },
  V: { si: 'V', us: 'V', units: [u('V', 1), u('kV', 1000)] },
  A: { si: 'A', us: 'A', units: [u('A', 1), u('mA', 0.001)] },
  M: { si: 'mM', us: 'mM', units: [u('M', 1), u('mM', 1e-3), u('µM', 1e-6), u('nM', 1e-9), u('pM', 1e-12)] },
  kon: { si: '1/(M·s)', us: '1/(M·s)', units: [u('1/(M·s)', 1), u('1/(mM·s)', 1e3), u('1/(µM·s)', 1e6)] },
  '1/s': { si: '1/s', us: '1/s', units: [u('1/s', 1), u('1/min', 1 / 60)] },
} as const satisfies Record<string, Dim>;

export type DimId = keyof typeof DIMS;

export const unitsOf = (dim: DimId): readonly Unit[] => DIMS[dim].units;

/** The unit a field starts with, and a result is shown in, for a system. */
export const defaultUnit = (dim: DimId, system: System): string => DIMS[dim][system];

function factorOf(dim: DimId, label: string): number {
  const unit = DIMS[dim].units.find((one) => one.label === label);
  return unit ? unit.factor : 1;
}

/** A number typed in `label` as the engine's value. */
export const toEngine = (dim: DimId, label: string, shown: number): number => shown * factorOf(dim, label);

/** The engine's value as a number in `label`. */
export const fromEngine = (dim: DimId, label: string, value: number): number => value / factorOf(dim, label);

/** True when `label` is a unit this quantity can take. */
export const hasUnit = (dim: DimId, label: string): boolean => DIMS[dim].units.some((one) => one.label === label);
