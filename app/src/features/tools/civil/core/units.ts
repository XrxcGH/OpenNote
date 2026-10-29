// The units a field can be typed in. Each quantity lists its units with the factor (and offset) that turns a value
// into the quantity's base unit, which is the first one listed and the one the calculations work in.

interface UnitDef {
  sym: string;
  factor: number;
  offset?: number;
}

const FT = 0.3048;
const IN = 0.0254;
const LBF = 4.4482216152605;
const DAY = 86400;
const GAL = 3.785411784e-3;

const u = (sym: string, factor = 1, offset = 0): UnitDef => ({ sym, factor, offset });

export const QUANTITIES = {
  length: [u('m'), u('cm', 0.01), u('mm', 0.001), u('ft', FT), u('in', IN)],
  grain: [u('mm'), u('µm', 0.001), u('in', 25.4)],
  dial: [u('mm'), u('in', 25.4), u('µm', 0.001)],
  area: [u('m²'), u('cm²', 1e-4), u('ft²', FT * FT), u('in²', IN * IN)],
  catchment: [u('km²'), u('ha', 0.01), u('acre', 4046.8564224e-6), u('mi²', 2.589988110336)],
  volume: [u('m³'), u('L', 0.001), u('cm³', 1e-6), u('ft³', FT ** 3), u('yd³', (3 * FT) ** 3)],
  force: [u('kN'), u('N', 0.001), u('kip', LBF), u('lbf', LBF / 1000)],
  forcePerLength: [u('kN/m'), u('N/m', 0.001), u('kip/ft', LBF / FT), u('lbf/ft', LBF / FT / 1000)],
  moment: [u('kN·m'), u('kip·ft', LBF * FT)],
  stiffness: [u('kN·m²'), u('kip·ft²', LBF * FT * FT)],
  pressure: [u('kPa'), u('MPa', 1000), u('bar', 100), u('psi', LBF / IN / IN / 1000), u('psf', LBF / FT / FT / 1000)],
  vapor: [u('bar'), u('kPa', 0.01), u('atm', 1.01325), u('psi', LBF / IN / IN / 1e5), u('mmHg', 1.01325 / 760)],
  unitWeight: [u('kN/m³'), u('lbf/ft³', LBF / FT ** 3 / 1000)],
  density: [u('kg/m³'), u('g/cm³', 1000), u('lb/ft³', 0.45359237 / FT ** 3)],
  conductivity: [u('m/s'), u('cm/s', 0.01), u('m/d', 1 / DAY), u('ft/d', FT / DAY)],
  transmissivity: [u('m²/s'), u('m²/d', 1 / DAY), u('ft²/d', (FT * FT) / DAY)],
  diffusion: [u('m²/d'), u('m²/s', DAY), u('cm²/s', 1e-4 * DAY), u('ft²/d', FT * FT)],
  consolidation: [u('m²/yr'), u('m²/d', 365.25), u('cm²/s', 1e-4 * 365.25 * DAY), u('ft²/d', FT * FT * 365.25)],
  flow: [u('m³/s'), u('m³/d', 1 / DAY), u('L/s', 0.001), u('ft³/s', FT ** 3), u('gal/min', GAL / 60)],
  flowPerWidth: [u('m²/s'), u('ft²/s', FT * FT)],
  speed: [u('km/h'), u('mph', 1.609344), u('m/s', 3.6)],
  slowSpeed: [u('m/d'), u('m/s', DAY), u('ft/d', FT)],
  accel: [u('m/s²'), u('ft/s²', FT)],
  seconds: [u('s'), u('min', 60), u('h', 3600), u('d', DAY)],
  minutes: [u('min'), u('s', 1 / 60), u('h', 60)],
  hours: [u('h'), u('min', 1 / 60), u('d', 24)],
  days: [u('d'), u('h', 1 / 24), u('min', 1 / 1440), u('yr', 365.25)],
  years: [u('yr'), u('d', 1 / 365.25), u('mo', 1 / 12)],
  temperature: [u('°C'), u('K', 1, -273.15), u('°F', 5 / 9, -160 / 9)],
  kelvin: [u('K'), u('°C', 1, 273.15), u('°F', 5 / 9, 255.3722222222222)],
  angle: [u('°')],
  mgL: [u('mg/L'), u('g/L', 1000), u('g/m³'), u('kg/m³', 1000)],
  gL: [u('g/L'), u('mg/L', 0.001), u('kg/m³')],
  molar: [u('mol/L'), u('mmol/L', 0.001), u('mol/m³', 0.001)],
  perDay: [u('1/d'), u('1/h', 24)],
  perHour: [u('1/h'), u('1/d', 1 / 24), u('1/min', 60)],
  perMinute: [u('1/min'), u('1/s', 60), u('1/h', 1 / 60)],
  intensity: [u('mm/h'), u('in/h', 25.4)],
  rain: [u('mm'), u('in', 25.4)],
  viscosity: [u('Pa·s'), u('mPa·s', 0.001)],
  liters: [u('L'), u('m³', 1000), u('gal', GAL * 1000)],
  molarEnergy: [u('kJ/mol'), u('J/mol', 0.001)],
  heatCapacity: [u('kJ/(L·K)'), u('kJ/(m³·K)', 0.001)],
  massFlow: [u('kg/h'), u('kg/s', 3600), u('t/h', 1000), u('lb/h', 0.45359237)],
  molarFlow: [u('mol/h'), u('kmol/h', 1000), u('mol/s', 3600)],
  vehicles: [u('veh/h')],
  density2: [u('veh/km'), u('veh/mi', 1 / 1.609344)],
  percent: [u('%')],
  partition: [u('L/kg'), u('mL/g'), u('m³/kg', 1000)],
  filterRate: [u('m/h'), u('m/s', 3600), u('m/d', 1 / 24), u('gal/(min·ft²)', 2.4448)],
  lpmh: [u('L/(m²·h)'), u('m/s', 3.6e6), u('gal/(ft²·d)', 1.6976)],
} as const satisfies Record<string, readonly UnitDef[]>;

export type Quantity = keyof typeof QUANTITIES;

/** The unit symbols of a quantity, base first. */
export const unitsOf = (q: Quantity): readonly string[] => QUANTITIES[q].map((one) => one.sym);

/** The base unit of a quantity. */
export const baseUnit = (q: Quantity): string => QUANTITIES[q][0].sym;

/** A value typed in `sym` as the quantity's base unit. An unknown unit leaves the value as it is. */
export function toBase(q: Quantity, value: number, sym: string): number {
  const def: UnitDef | undefined = QUANTITIES[q].find((one) => one.sym === sym);
  return def ? value * def.factor + (def.offset ?? 0) : value;
}

/** A base-unit value in `sym`. */
export function fromBase(q: Quantity, value: number, sym: string): number {
  const def: UnitDef | undefined = QUANTITIES[q].find((one) => one.sym === sym);
  return def ? (value - (def.offset ?? 0)) / def.factor : value;
}
