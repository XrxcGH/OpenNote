// The units a life-systems field can be typed in. Each group has a base unit: the unit the subject's equations are
// written in (mmHg for blood gases, mL/min for clearance, mg/L for drug levels). Every other unit converts to it by
// base = value × factor + offset. Factors are exact definitions or CODATA-derived values.

export interface UnitDef {
  id: string;
  factor: number;
  offset?: number;
}

const u = (id: string, factor: number, offset = 0): UnitDef => ({ id, factor, offset });

export const UNIT_GROUPS = {
  /** Base mmHg. 1 kPa = 7.500616827 mmHg; 1 cmH₂O = 98.0665 Pa. */
  pressure: [u('mmHg', 1), u('kPa', 7.500616827), u('cmH₂O', 0.73555912)],
  /** Base °C. */
  temperature: [u('°C', 1), u('K', 1, -273.15), u('°F', 5 / 9, -32 * (5 / 9))],
  /** Base kg. */
  bodyMass: [u('kg', 1), u('lb', 0.45359237), u('g', 0.001)],
  /** Base cm. */
  height: [u('cm', 1), u('in', 2.54), u('m', 100)],
  /** Base mL. */
  volume: [u('mL', 1), u('L', 1000), u('µL', 0.001)],
  /** Base L. */
  volumeL: [u('L', 1), u('mL', 0.001)],
  /** Base mL/min. */
  flow: [u('mL/min', 1), u('L/min', 1000), u('mL/s', 60)],
  /** Base mg/L (the same as µg/mL). */
  drugConc: [u('mg/L', 1), u('µg/mL', 1), u('ng/mL', 0.001), u('g/L', 1000)],
  /** Base mg. */
  dose: [u('mg', 1), u('g', 1000), u('µg', 0.001)],
  /** Base h. */
  hours: [u('h', 1), u('min', 1 / 60), u('d', 24)],
  /** Base ms. */
  ms: [u('ms', 1), u('s', 1000), u('µs', 0.001)],
  /** Base mol/L. */
  molar: [u('M', 1), u('mM', 1e-3), u('µM', 1e-6), u('nM', 1e-9)],
  /** Base mM. */
  mM: [u('mM', 1), u('M', 1000), u('µM', 1e-3)],
  /** Base g/mol. */
  molarMass: [u('g/mol', 1), u('kg/mol', 1000)],
  /** Base cm. */
  radius: [u('cm', 1), u('mm', 0.1), u('in', 2.54)],
  /** Base nm. */
  wavelength: [u('nm', 1), u('µm', 1000)],
  /** Base µm. */
  micron: [u('µm', 1), u('mm', 1000), u('nm', 0.001)],
  /** Base mm. */
  mm: [u('mm', 1), u('cm', 10), u('µm', 0.001)],
  /** Base Gy. */
  gray: [u('Gy', 1), u('cGy', 0.01)],
  /** Base kcal. */
  energy: [u('kcal', 1), u('kJ', 1 / 4.184)],
  /** Base L/h. */
  clearance: [u('L/h', 1), u('mL/min', 0.06)],
  /** Base cm². */
  area: [u('cm²', 1), u('mm²', 0.01)],
} as const satisfies Record<string, readonly UnitDef[]>;

export type UnitGroup = keyof typeof UNIT_GROUPS;

/** A value typed in unit `id` of a group, in the group's base unit. Unknown units are taken as the base. */
export function toBase(group: UnitGroup, id: string, value: number): number {
  const unit: UnitDef = UNIT_GROUPS[group].find((one) => one.id === id) ?? UNIT_GROUPS[group][0];
  return value * unit.factor + (unit.offset ?? 0);
}

/** A base-unit value in unit `id` of a group. */
export function fromBase(group: UnitGroup, id: string, value: number): number {
  const unit: UnitDef = UNIT_GROUPS[group].find((one) => one.id === id) ?? UNIT_GROUPS[group][0];
  return (value - (unit.offset ?? 0)) / unit.factor;
}
