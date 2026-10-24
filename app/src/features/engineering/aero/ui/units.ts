// The units the aerospace tools read and show. Engines work in SI; a field keeps the number as typed with its unit,
// and a result converts into the chosen system's first unit for its kind. Factors come from core/units where it
// knows the symbol, so the two agree, and the few it does not know (knots, nautical miles, per-rankine units) are
// defined here from their exact definitions.
import { parseUnit } from '../../../../core/units';

export type UnitSystem = 'si' | 'us';

export type QtyKind =
  | 'altitude'
  | 'length'
  | 'distance'
  | 'area'
  | 'temperature'
  | 'tempDiff'
  | 'pressure'
  | 'density'
  | 'speed'
  | 'viscosity'
  | 'kinematic'
  | 'force'
  | 'forcePerSpan'
  | 'mass'
  | 'massFlow'
  | 'power'
  | 'time'
  | 'angle'
  | 'specificThrust'
  | 'tsfc'
  | 'specificEnergy'
  | 'gasConstant'
  | 'molarMass'
  | 'rate'
  | 'accel';

export interface UnitDef {
  /** The symbol shown and stored, such as "kPa". */
  readonly sym: string;
  /** SI value = value × factor + offset. */
  readonly factor: number;
  readonly offset?: number;
}

/** A unit core/units can read; `text` is how it is spelled for the parser when that differs from the symbol. */
function core(sym: string, text = sym): UnitDef {
  const unit = parseUnit(text);
  if (!unit) throw new Error(`core/units cannot read ${text}`);
  return unit.offset === undefined ? { sym, factor: unit.factor } : { sym, factor: unit.factor, offset: unit.offset };
}

const KNOT = 1852 / 3600;
const RANKINE = 5 / 9;

const own = (sym: string, factor: number): UnitDef => ({ sym, factor });

/** For each kind: the SI units, then the US customary units; the first of each list is that system's default. */
export const UNITS: Readonly<Record<QtyKind, { readonly si: readonly UnitDef[]; readonly us: readonly UnitDef[] }>> = {
  altitude: { si: [core('m'), core('km')], us: [core('ft')] },
  length: { si: [core('m'), core('cm'), core('mm'), core('km')], us: [core('ft'), core('in')] },
  distance: { si: [core('km'), core('m')], us: [core('mi'), own('nmi', 1852)] },
  area: { si: [core('m²'), core('cm²'), core('mm²')], us: [core('ft²'), core('in²')] },
  temperature: { si: [core('K'), core('°C')], us: [core('°R'), core('°F')] },
  tempDiff: { si: [core('K')], us: [own('°R', RANKINE)] },
  pressure: {
    si: [core('Pa'), core('kPa'), core('MPa'), core('bar'), core('atm')],
    us: [core('lbf/ft²'), core('psi'), core('atm')],
  },
  density: { si: [core('kg/m³')], us: [core('slug/ft³'), core('lbm/ft³')] },
  speed: {
    si: [core('m/s'), core('km/h'), own('kn', KNOT)],
    us: [core('ft/s'), core('mi/h'), own('kn', KNOT)],
  },
  viscosity: { si: [core('Pa·s')], us: [core('slug/(ft·s)')] },
  kinematic: { si: [core('m²/s')], us: [core('ft²/s')] },
  force: { si: [core('N'), core('kN')], us: [core('lbf'), core('kip')] },
  forcePerSpan: { si: [core('N/m')], us: [core('lbf/ft')] },
  mass: { si: [core('kg')], us: [core('lbm'), core('slug')] },
  massFlow: { si: [core('kg/s')], us: [core('lbm/s'), core('slug/s')] },
  power: { si: [core('W'), core('kW')], us: [core('hp'), core('ft·lbf/s')] },
  time: { si: [core('s'), core('min'), core('h')], us: [core('s'), core('min'), core('h')] },
  angle: { si: [core('°', 'deg'), core('rad')], us: [core('°', 'deg'), core('rad')] },
  specificThrust: { si: [core('N·s/kg')], us: [core('lbf·s/lbm')] },
  tsfc: { si: [core('mg/(N·s)'), core('kg/(N·h)')], us: [core('lbm/(lbf·h)')] },
  specificEnergy: { si: [core('MJ/kg'), core('kJ/kg')], us: [core('Btu/lbm')] },
  gasConstant: {
    si: [core('J/(kg·K)'), core('kJ/(kg·K)')],
    us: [own('ft·lbf/(slug·°R)', core('ft·lbf/(slug·K)').factor / RANKINE), own('Btu/(lbm·°R)', 4186.8)],
  },
  molarMass: { si: [core('kg/kmol')], us: [own('lbm/lbmol', 1)] },
  rate: { si: [core('1/s', 's^-1'), core('1/h', 'h^-1')], us: [core('1/s', 's^-1'), core('1/h', 'h^-1')] },
  accel: { si: [core('m/s²')], us: [core('ft/s²')] },
};

/** Every unit a field of this kind offers, the chosen system's first, without repeats. */
export function unitsFor(kind: QtyKind, system: UnitSystem): readonly UnitDef[] {
  const lists = UNITS[kind];
  const ordered = system === 'si' ? [...lists.si, ...lists.us] : [...lists.us, ...lists.si];
  return ordered.filter((unit, i) => ordered.findIndex((other) => other.sym === unit.sym) === i);
}

export const defaultUnit = (kind: QtyKind, system: UnitSystem): UnitDef => UNITS[kind][system][0]!;

export function findUnit(kind: QtyKind, sym: string | undefined): UnitDef | undefined {
  if (sym === undefined) return undefined;
  const lists = UNITS[kind];
  return [...lists.si, ...lists.us].find((unit) => unit.sym === sym);
}

export const toSI = (value: number, unit: UnitDef): number => value * unit.factor + (unit.offset ?? 0);

export const fromSI = (value: number, unit: UnitDef): number => (value - (unit.offset ?? 0)) / unit.factor;
