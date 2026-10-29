// Numbers for people: five significant figures, a power of ten for very large and very small values, as text for the
// window and as LaTeX for equations.
const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (text: string) => text.replace(/-/g, '⁻').replace(/[0-9]/g, (c) => SUPER[Number(c)] ?? c);

function parts(value: number, digits: number): { mantissa: string; power: number } {
  if (value === 0 || !Number.isFinite(value)) return { mantissa: String(value === 0 ? 0 : value), power: 0 };
  const rounded = Number(value.toPrecision(digits));
  const size = Math.abs(rounded);
  const power = size >= 1e6 || size < 1e-3 ? Math.floor(Math.log10(size) + 1e-12) : 0;
  return { mantissa: String(Number((rounded / 10 ** power).toPrecision(digits))), power };
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

/** A unit as upright LaTeX text. */
export function unitLatex(unit: string): string {
  if (unit === '') return '';
  if (unit === '°') return '^{\\circ}';
  const body = unit
    .replace(/·/g, '{\\cdot}')
    .replace(/µ/g, '\\mu ')
    .replace(/Å/g, '\\mathrm{\\AA}')
    .replace(/([²³])/g, (c) => `^{${c === '²' ? 2 : 3}}`);
  return `\\,\\mathrm{${body}}`;
}

export const withUnit = (number: string, unit: string): string =>
  unit === '' ? number : unit === '°' || unit === '%' ? `${number}${unit}` : `${number} ${unit}`;

/** Escapes text for XML and HTML attributes. */
export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
