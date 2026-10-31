// How the kit writes numbers: 6 significant figures, trailing zeros dropped, and powers of 10 for very large and
// very small values. Text uses a plain hyphen-minus and e-notation, so a copied value pastes into a calculator;
// LaTeX uses \times 10^{n}. An undefined value is an empty string, which the window shows as a word.
import type { StepValue, Vars } from './types';

const trim = (text: string) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);

/** A number as text with up to `digits` significant figures. */
export function numText(value: number, digits = 6): string {
  if (Number.isNaN(value)) return '';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  if (value === 0) return '0';
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const size = Math.abs(value);
  if (size >= 1e6 || size < 1e-4) {
    const [mantissa, power] = value.toExponential(digits - 1).split('e');
    return `${trim(mantissa)}e${Number(power)}`;
  }
  const text = trim(value.toPrecision(digits));
  return text === '-0' ? '0' : text;
}

/** A number in LaTeX. */
export function numLatex(value: number, digits = 6): string {
  const text = numText(value, digits);
  if (text === '') return '\\text{--}';
  if (text === '∞') return '\\infty';
  if (text === '-∞') return '-\\infty';
  const [mantissa, power] = text.split('e');
  return power === undefined ? mantissa : `${mantissa} \\times 10^{${power}}`;
}

/** A value as text: numbers formatted, words as they are. */
export const valueText = (value: StepValue): string => (typeof value === 'number' ? numText(value) : value);

/** Escapes text for LaTeX \text{}. */
export const latexText = (text: string): string => text.replace(/[\\{}$&#^_%~]/g, (c) => `\\${c}`);

/** A value in LaTeX. */
export const valueLatex = (value: StepValue): string =>
  typeof value === 'number' ? numLatex(value) : `\\text{${latexText(value)}}`;

/** The step's equation with each [[name]] filled in from its values. */
export function fillMath(math: string, vars: Vars | undefined): string {
  return math.replace(/\[\[(\w+)\]\]/g, (whole, name: string) => {
    const value = vars?.[name];
    return value === undefined ? whole : valueLatex(value);
  });
}

/** The step's values as text, for its sentence. */
export const wordVars = (vars: Vars | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(vars ?? {}).map(([name, value]) => [name, valueText(value)]));

/** A proportion as a percentage with up to 4 significant figures. */
export const percentText = (p: number): string => (Number.isNaN(p) ? '' : `${numText(p * 100, 4)}%`);
