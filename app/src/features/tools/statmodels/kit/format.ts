// Numbers for people: five significant figures, with a power of ten for very large and very small values, as text
// for the window and as LaTeX for equations. Text values, such as a term's name, pass through as they are.
import type { KitStep, StepValue } from './types';

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

/** A number as text, such as 85, 0.0625, −45, or 6.768×10⁻⁴. */
export function numberText(value: number, digits = 5): string {
  if (Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const { mantissa, power } = parts(value, digits);
  const signed = mantissa.replace('-', '−');
  return power === 0 ? signed : `${signed}×10${superscript(String(power))}`;
}

/** A number as LaTeX, such as 6.768 \times 10^{-4}. */
export function numberLatex(value: number, digits = 5): string {
  if (Number.isNaN(value)) return '\\text{—}';
  if (!Number.isFinite(value)) return value > 0 ? '\\infty' : '-\\infty';
  const { mantissa, power } = parts(value, digits);
  return power === 0 ? mantissa : `${mantissa} \\times 10^{${power}}`;
}

export const valueText = (value: StepValue, digits = 5): string =>
  typeof value === 'string' ? value : numberText(value, digits);

/** Text made safe inside \text{...}. */
export const latexText = (text: string): string => text.replace(/[\\{}$&#^_%~]/g, (c) => LATEX_ESCAPES[c] ?? `\\${c}`);

const LATEX_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};

export const valueLatex = (value: StepValue, digits = 5): string =>
  typeof value === 'string' ? `\\text{${latexText(value)}}` : numberLatex(value, digits);

/** Puts the values into a step's equation in place of each [[name]]. */
export function fillMath(math: string, vars: KitStep['vars']): string {
  return math.replace(/\[\[(\w+)\]\]/g, (whole, name: string) => {
    const value = vars?.[name];
    return value === undefined ? whole : valueLatex(value);
  });
}

/** A step's values as text, for the words of the step. */
export function wordValues(vars: KitStep['vars']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars ?? {})) out[name] = valueText(value);
  return out;
}

/** A p-value as people report it: four decimals, or "< 0.0001". */
export const pText = (p: number): string => (p < 0.0001 ? '< 0.0001' : p.toFixed(4));

/** A fitted linear predictor in LaTeX, such as -2.4466 + 0.5437\,\text{hours}. The intercept has no name. */
export function linearLatex(coef: readonly number[], names: readonly string[], intercept = '(Intercept)'): string {
  return coef
    .map((b, i) => {
      const size = numberLatex(Math.abs(b));
      const term = names[i] === intercept ? size : `${size}\\,\\text{${latexText(names[i])}}`;
      if (i === 0) return b < 0 ? `-${term}` : term;
      return `${b < 0 ? '-' : '+'} ${term}`;
    })
    .join(' ');
}

/** A confidence level as a percent for words, such as 95. */
export const percent = (level: number): number => Number((level * 100).toPrecision(6));
