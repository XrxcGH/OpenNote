// Numbers for people: five significant figures, with a power of ten for very large and very small values, as text
// for the window and as LaTeX for equations. Values tagged with a kind are written in the chosen system's unit.
import type { KitStep, StepValue } from './types';
import { toShown, unitOf, type System } from './units';

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (text: string) => text.replace(/-/g, '⁻').replace(/[0-9]/g, (c) => SUPER[Number(c)]);

/** The mantissa and power of ten a number is written with; the power is 0 for everyday sizes. */
function parts(value: number, digits: number): { mantissa: string; power: number } {
  if (value === 0 || !Number.isFinite(value)) return { mantissa: String(value === 0 ? 0 : value), power: 0 };
  const rounded = Number(value.toPrecision(digits));
  const size = Math.abs(rounded);
  const power = size >= 1e6 || size < 1e-3 ? Math.floor(Math.log10(size) + 1e-12) : 0;
  const mantissa = Number((rounded / 10 ** power).toPrecision(digits));
  return { mantissa: String(mantissa), power };
}

/** A number as text, such as 85, 0.0625, −45, or 5.3333×10⁶. */
export function numberText(value: number, digits = 5): string {
  if (Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const { mantissa, power } = parts(value, digits);
  const signed = mantissa.replace('-', '−');
  return power === 0 ? signed : `${signed}×10${superscript(String(power))}`;
}

/** A number as LaTeX, such as 5.3333 \times 10^{6}. */
export function numberLatex(value: number, digits = 5): string {
  if (Number.isNaN(value)) return '\\text{—}';
  if (!Number.isFinite(value)) return value > 0 ? '\\infty' : '-\\infty';
  const { mantissa, power } = parts(value, digits);
  return power === 0 ? mantissa : `${mantissa} \\times 10^{${power}}`;
}

/** A unit as LaTeX upright text, such as \mathrm{N{\cdot}mm}. */
export function unitLatex(unit: string): string {
  if (unit === '') return '';
  const body = unit
    .replace(/·/g, '{\\cdot}')
    .replace(/µε/g, '\\mu\\varepsilon')
    .replace(/µ/g, '\\mu ')
    .replace(/°/g, '^{\\circ}')
    .replace(/([²³⁴])/g, (c) => `^{${{ '²': 2, '³': 3, '⁴': 4 }[c]}}`);
  return unit === '°' ? '^{\\circ}' : `\\,\\mathrm{${body}}`;
}

/** A value with its unit as text, in the chosen system. */
export function valueText(value: StepValue, system: System, digits = 5): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return numberText(value, digits);
  const unit = unitOf(value.k, system);
  const number = numberText(toShown(value.v, value.k, system), digits);
  if (unit === '') return number;
  return unit === '°' || unit === '%' ? `${number}${unit}` : `${number} ${unit}`;
}

/** A value with its unit as LaTeX, in the chosen system. */
export function valueLatex(value: StepValue, system: System, digits = 5): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return numberLatex(value, digits);
  const unit = unitOf(value.k, system);
  const number = numberLatex(toShown(value.v, value.k, system), digits);
  if (unit === '%') return `${number}\\%`;
  return `${number}${unitLatex(unit)}`;
}

/** Puts the values into a step's equation in place of each [[name]]. */
export function fillMath(math: string, vars: KitStep['vars'], system: System): string {
  return math.replace(/\[\[(\w+)\]\]/g, (whole, name: string) => {
    const value = vars?.[name];
    return value === undefined ? whole : valueLatex(value, system);
  });
}

/** A step's values as text, for the words of the step. */
export function wordValues(vars: KitStep['vars'], system: System): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars ?? {})) out[name] = valueText(value, system);
  return out;
}
