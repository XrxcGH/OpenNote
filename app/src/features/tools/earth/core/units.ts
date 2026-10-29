// The units the earth kit's fields offer. Each quantity lists its units with the factor (and offset, for
// temperatures) that takes a value to SI; the engines work in SI only. US customary units are offered where
// people use them: feet, miles, knots, inches of mercury, and degrees Fahrenheit.

export interface UnitDef {
  id: string;
  /** SI value = value × factor + offset. */
  factor: number;
  offset?: number;
}

const u = (id: string, factor: number, offset = 0): UnitDef => (offset ? { id, factor, offset } : { id, factor });

const G0 = 9.80665;
const YEAR = 365.25 * 86400;

export const QUANTITIES = {
  length: [u('m', 1), u('km', 1000), u('cm', 0.01), u('ft', 0.3048), u('mi', 1609.344)],
  distance: [u('km', 1000), u('m', 1), u('mi', 1609.344), u('nmi', 1852)],
  depth: [u('m', 1), u('km', 1000), u('ft', 0.3048)],
  temperature: [u('°C', 1, 273.15), u('K', 1), u('°F', 5 / 9, 273.15 - (32 * 5) / 9)],
  difference: [u('K', 1), u('°C', 1), u('°F', 5 / 9)],
  pressure: [u('hPa', 100), u('kPa', 1000), u('Pa', 1), u('mbar', 100), u('inHg', 3386.389), u('atm', 101325)],
  seaPressure: [u('dbar', 1e4), u('bar', 1e5), u('MPa', 1e6), u('kPa', 1000)],
  speed: [u('m/s', 1), u('km/h', 1 / 3.6), u('kt', 1852 / 3600), u('mph', 0.44704)],
  rate: [u('mm/yr', 1e-3 / YEAR), u('cm/yr', 1e-2 / YEAR), u('m/s', 1)],
  density: [u('kg/m³', 1), u('g/cm³', 1000)],
  gravity: [u('mGal', 1e-5), u('m/s²', 1), u('Gal', 1e-2), u('µGal', 1e-8)],
  heatFlow: [u('mW/m²', 1e-3), u('W/m²', 1)],
  conductivity: [u('W/(m·K)', 1)],
  heatProduction: [u('µW/m³', 1e-6), u('W/m³', 1)],
  time: [u('s', 1), u('min', 60), u('h', 3600), u('day', 86400)],
  age: [u('Myr', 1e6 * YEAR), u('kyr', 1e3 * YEAR), u('yr', YEAR), u('Ga', 1e9 * YEAR)],
  emission: [u('g/s', 1e-3), u('kg/s', 1), u('kg/h', 1 / 3600), u('t/yr', 1000 / YEAR)],
  concentration: [u('µg/m³', 1e-9), u('mg/m³', 1e-6), u('g/m³', 1e-3)],
  stress: [u('N/m²', 1), u('dyn/cm²', 0.1)],
  field: [u('nT', 1e-9), u('µT', 1e-6), u('T', 1)],
  resistance: [u('Ω', 1)],
  voltage: [u('mV', 1e-3), u('V', 1)],
  current: [u('mA', 1e-3), u('A', 1)],
  resistivity: [u('Ω·m', 1)],
  diffusivity: [u('m²/s', 1), u('mm²/s', 1e-6)],
  moment: [u('N·m', 1), u('dyn·cm', 1e-7)],
  heatCapacity: [u('J/(m²·K)', 1)],
  power: [u('W/m²', 1)],
  frequency: [u('1/s', 1)],
  acceleration: [u('m/s²', 1), u('ft/s²', 0.3048)],
  gravityStandard: [u('m/s²', 1), u('g₀', G0)],
  velocity: [u('km/s', 1000), u('m/s', 1), u('ft/s', 0.3048)],
  modulus: [u('GPa', 1e9), u('MPa', 1e6), u('Pa', 1)],
  area: [u('km²', 1e6), u('m²', 1), u('mi²', 2589988.110336)],
  energy: [u('J', 1), u('kWh', 3.6e6), u('MJ', 1e6)],
  mixing: [u('g/kg', 1e-3), u('kg/kg', 1)],
  precipitation: [u('mm', 1e-3), u('in', 0.0254)],
} as const satisfies Record<string, readonly UnitDef[]>;

export type QuantityId = keyof typeof QUANTITIES;

export const unitIds = (quantity: QuantityId): readonly string[] => QUANTITIES[quantity].map((one) => one.id);

function find(quantity: QuantityId, unit: string): UnitDef {
  const list: readonly UnitDef[] = QUANTITIES[quantity];
  return list.find((one) => one.id === unit) ?? list[0];
}

/** A value in a unit of the quantity, in SI. An unknown unit is read as the quantity's first unit. */
export function toSI(value: number, quantity: QuantityId, unit: string): number {
  const def = find(quantity, unit);
  return value * def.factor + (def.offset ?? 0);
}

/** An SI value in a unit of the quantity. */
export function fromSI(value: number, quantity: QuantityId, unit: string): number {
  const def = find(quantity, unit);
  return (value - (def.offset ?? 0)) / def.factor;
}

export const SECONDS_PER_YEAR = YEAR;
