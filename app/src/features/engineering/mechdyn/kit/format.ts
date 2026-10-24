// Numbers for people: five significant figures, with a power of ten for very large and very small values, as text
// for the window and as LaTeX for equations. Values tagged with a kind are written in the chosen system's unit.
import { toShown, unitOf, type Kind, type System } from './units';

/** A value in base SI and the kind of quantity it is. */
export interface Q {
  readonly v: number;
  readonly k: Kind;
}

export const q = (v: number, k: Kind): Q => ({ v, k });

export type Cell = string | number | Q;

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (text: string) => text.replace(/-/g, '⁻').replace(/[0-9]/g, (c) => SUPER[Number(c)]);

function parts(value: number, digits: number): { mantissa: string; power: number } {
  if (value === 0 || !Number.isFinite(value)) return { mantissa: String(value === 0 ? 0 : value), power: 0 };
  const rounded = Number(value.toPrecision(digits));
  const size = Math.abs(rounded);
  const power = size >= 1e6 || size < 1e-3 ? Math.floor(Math.log10(size) + 1e-12) : 0;
  const mantissa = Number((rounded / 10 ** power).toPrecision(digits));
  return { mantissa: String(mantissa), power };
}

const tiny = (value: number) => (Math.abs(value) < 1e-12 ? 0 : value);

/** A number as text, such as 85, 0.0625, −45, or 5.3333×10⁶. */
export function numberText(value: number, digits = 5): string {
  if (Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const { mantissa, power } = parts(tiny(value), digits);
  const signed = mantissa.replace('-', '−');
  return power === 0 ? signed : `${signed}×10${superscript(String(power))}`;
}

/** A number as LaTeX, such as 5.3333 \times 10^{6}. */
export function numberLatex(value: number, digits = 5): string {
  if (Number.isNaN(value)) return '\\text{—}';
  if (!Number.isFinite(value)) return value > 0 ? '\\infty' : '-\\infty';
  const { mantissa, power } = parts(tiny(value), digits);
  return power === 0 ? mantissa : `${mantissa} \\times 10^{${power}}`;
}

/** A unit as LaTeX upright text, such as \,\mathrm{N{\cdot}m}. */
export function unitLatex(unit: string): string {
  if (unit === '') return '';
  if (unit === '°') return '^{\\circ}';
  if (unit === '%') return '\\%';
  const body = unit.replace(/·/g, '{\\cdot}').replace(/([²³⁴])/g, (c) => `^{${{ '²': 2, '³': 3, '⁴': 4 }[c]}}`);
  return `\\,\\mathrm{${body}}`;
}

/** A value with its unit as text, in the chosen system. */
export function cellText(value: Cell, system: System, digits = 5): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return numberText(value, digits);
  const unit = unitOf(value.k, system);
  const number = numberText(toShown(value.v, value.k, system), digits);
  if (unit === '') return number;
  return unit === '°' || unit === '%' ? `${number}${unit}` : `${number} ${unit}`;
}

/** A value with its unit as LaTeX, in the chosen system. */
export function cellLatex(value: Cell, system: System, digits = 5): string {
  if (typeof value === 'string') return `\\text{${value.replace(/[\\{}$&#^_%~]/g, '')}}`;
  if (typeof value === 'number') return numberLatex(value, digits);
  return `${numberLatex(toShown(value.v, value.k, system), digits)}${unitLatex(unitOf(value.k, system))}`;
}

/** A vector of quantities as text, such as (1.2, −3) m/s. */
export function vectorText(values: readonly number[], kind: Kind, system: System): string {
  const unit = unitOf(kind, system);
  const inner = values.map((v) => numberText(toShown(v, kind, system))).join(', ');
  return unit === '' ? `(${inner})` : `(${inner}) ${unit}`;
}
