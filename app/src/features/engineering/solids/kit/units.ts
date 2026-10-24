// The kinds of quantity the solid mechanics tools read and show, each with the unit it shows in SI and in US
// customary units. The engines work in base SI (m, N, Pa, kg, s, rad, K); these units are only for people. The SI
// set is N, mm, and MPa, and the US set is kip, in, and ksi, so the numbers in a worked step agree with each other.
import { evaluate } from '../../../../core/expr';
import { parseUnit, sameDim, type Dim } from '../../../../core/units';
import { SolidsError } from './types';

export type System = 'si' | 'us';

interface Shown {
  /** The unit as people read it. */
  readonly label: string;
  /** SI base units in one of this unit. */
  readonly factor: number;
  /** How the unit is typed, when its label cannot be read back. */
  readonly typed?: string;
}

interface KindDef {
  readonly dim: Dim;
  readonly si: Shown;
  readonly us: Shown;
}

const D = (m = 0, kg = 0, s = 0, K = 0): Dim => [m, kg, s, K, 0, 0, 0];
const IN = 0.0254;
const KIP = 4448.2216152605;
const LBF = 4.4482216152605;
const KSI = KIP / IN ** 2;
const shown = (label: string, factor: number, typed?: string): Shown => ({
  label,
  factor,
  ...(typed ? { typed } : {}),
});

export const KINDS = {
  length: { dim: D(1), si: shown('mm', 1e-3), us: shown('in', IN) },
  span: { dim: D(1), si: shown('m', 1), us: shown('ft', 0.3048) },
  area: { dim: D(2), si: shown('mm²', 1e-6), us: shown('in²', IN ** 2) },
  volume: { dim: D(3), si: shown('mm³', 1e-9), us: shown('in³', IN ** 3) },
  inertia: { dim: D(4), si: shown('mm⁴', 1e-12), us: shown('in⁴', IN ** 4) },
  force: { dim: D(1, 1, -2), si: shown('N', 1), us: shown('kip', KIP) },
  bigForce: { dim: D(1, 1, -2), si: shown('kN', 1e3), us: shown('kip', KIP) },
  smallForce: { dim: D(1, 1, -2), si: shown('N', 1), us: shown('lbf', LBF) },
  moment: { dim: D(2, 1, -2), si: shown('N·mm', 1e-3), us: shown('kip·in', KIP * IN) },
  bigMoment: { dim: D(2, 1, -2), si: shown('kN·m', 1e3), us: shown('kip·ft', KIP * 0.3048) },
  smallMoment: { dim: D(2, 1, -2), si: shown('N·m', 1), us: shown('lbf·in', LBF * IN) },
  stress: { dim: D(-1, 1, -2), si: shown('MPa', 1e6), us: shown('ksi', KSI) },
  modulus: { dim: D(-1, 1, -2), si: shown('GPa', 1e9), us: shown('ksi', KSI) },
  lineLoad: { dim: D(0, 1, -2), si: shown('N/mm', 1e3), us: shown('kip/in', KIP / IN) },
  spanLoad: { dim: D(0, 1, -2), si: shown('kN/m', 1e3), us: shown('kip/ft', KIP / 0.3048) },
  stiffness: { dim: D(0, 1, -2), si: shown('N/mm', 1e3), us: shown('lbf/in', LBF / IN) },
  deflection: { dim: D(1), si: shown('mm', 1e-3), us: shown('in', IN) },
  curvature: { dim: D(-1), si: shown('1/mm', 1e3, 'mm^-1'), us: shown('1/in', 1 / IN, 'in^-1') },
  twistRate: { dim: D(-1), si: shown('rad/m', 1), us: shown('rad/in', 1 / IN) },
  stressPerLength: { dim: D(-2, 1, -2), si: shown('N/mm³', 1e9), us: shown('kip/in³', KIP / IN ** 3) },
  density: { dim: D(-3, 1), si: shown('kg/m³', 1), us: shown('lb/ft³', 0.45359237 / 0.3048 ** 3) },
  power: { dim: D(2, 1, -3), si: shown('kW', 1e3), us: shown('hp', 745.69987158227) },
  speed: { dim: D(0, 0, -1), si: shown('rpm', 1 / 60), us: shown('rpm', 1 / 60) },
  angularSpeed: { dim: D(0, 0, -1), si: shown('rad/s', 1), us: shown('rad/s', 1) },
  frequency: { dim: D(0, 0, -1), si: shown('Hz', 1), us: shown('Hz', 1) },
  time: { dim: D(0, 0, 1), si: shown('s', 1), us: shown('s', 1) },
  viscosity: { dim: D(-1, 1, -1), si: shown('MPa·s', 1e6), us: shown('ksi·s', KSI) },
  expansion: { dim: D(0, 0, 0, -1), si: shown('1/K', 1, 'K^-1'), us: shown('1/°F', 9 / 5, 'degF^-1') },
  tempChange: { dim: D(0, 0, 0, 1), si: shown('K', 1), us: shown('°F', 5 / 9) },
  angle: { dim: D(), si: shown('°', Math.PI / 180), us: shown('°', Math.PI / 180) },
  radians: { dim: D(), si: shown('rad', 1), us: shown('rad', 1) },
  strain: { dim: D(), si: shown('µε', 1e-6), us: shown('µε', 1e-6) },
  percent: { dim: D(), si: shown('%', 0.01), us: shown('%', 0.01) },
  count: { dim: D(), si: shown('', 1), us: shown('', 1) },
  ratio: { dim: D(), si: shown('', 1), us: shown('', 1) },
} as const satisfies Record<string, KindDef>;

export type Kind = keyof typeof KINDS;

/** The unit a kind shows in. */
export const unitOf = (kind: Kind, system: System): string => KINDS[kind][system].label;

/** The unit as it is typed after a number, so a bare number can keep its meaning when the system changes. */
export const typedUnit = (kind: Kind, system: System): string => {
  const one: Shown = KINDS[kind][system];
  return one.typed ?? one.label;
};

/** A value in base SI, in the units a kind shows in. */
export const toShown = (value: number, kind: Kind, system: System): number => value / KINDS[kind][system].factor;

/** A value in the units a kind shows in, in base SI. */
export const fromShown = (value: number, kind: Kind, system: System): number => value * KINDS[kind][system].factor;

const STRAIN = /^(µε|με|ue)$/;

/** What a person typed, as a number and the unit after it ('' when none). */
function splitTyped(text: string): { number: number; unit: string } | null {
  const whole = evaluate(text);
  if (whole.ok) return { number: whole.value, unit: '' };
  for (let i = 1; i < text.length; i += 1) {
    if (!/[A-Za-zµμΩ°%]/.test(text[i]) || !/[\s\d).]/.test(text[i - 1])) continue;
    const unit = text.slice(i).trim();
    if (!parseUnit(unit) && !STRAIN.test(unit)) continue;
    const number = evaluate(text.slice(0, i).trim());
    if (number.ok) return { number: number.value, unit };
  }
  return null;
}

/**
 * Reads a typed quantity, such as "25", "25 mm", "1 kN·m", or "2*pi rad/s", into base SI. A bare number is in the
 * unit the kind shows in for the chosen system. A unit that measures something else is an error that names both.
 */
export function readQuantity(text: string, kind: Kind, system: System): number {
  const trimmed = text.trim();
  if (trimmed === '') throw new SolidsError('empty');
  const typed = splitTyped(trimmed);
  if (!typed || !Number.isFinite(typed.number)) throw new SolidsError('unreadable', trimmed);
  if (typed.unit === '') return fromShown(typed.number, kind, system);
  if (kind === 'tempChange' && /^(°F|degF)$/.test(typed.unit)) return (typed.number * 5) / 9;
  if (kind === 'strain' && STRAIN.test(typed.unit)) return typed.number * 1e-6;
  const unit = parseUnit(typed.unit);
  if (!unit) throw new SolidsError('unreadable', trimmed);
  const def: KindDef = KINDS[kind];
  if (!sameDim(unit, { factor: 1, dim: def.dim })) {
    throw new SolidsError('unitMismatch', `${typed.unit}|${def[system].label || '1'}`);
  }
  return typed.number * unit.factor;
}
