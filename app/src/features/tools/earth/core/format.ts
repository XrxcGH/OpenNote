// Numbers as the earth kit shows them: a few significant figures, a true minus sign, and powers of ten written
// out, so a result reads the same in the window, in a step, and on the page. LaTeX gets its own spelling.

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/** Drops the zeros after a decimal point, and the point itself when nothing is left after it. */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function parts(value: number, digits: number): { mantissa: string; exponent: number } | null {
  const size = Math.abs(value);
  if (size === 0 || (size >= 1e-3 && size < 1e6)) return null;
  const [mantissa, exponent] = value.toExponential(digits - 1).split('e');
  return { mantissa: trimZeros(mantissa), exponent: Number(exponent) };
}

/** A number for people: `digits` significant figures, a power of ten outside 0.001 to 1 000 000, and a minus sign. */
export function fmt(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '—' : value > 0 ? '∞' : '−∞';
  const split = parts(value, digits);
  const text = split
    ? `${split.mantissa} × 10${[...String(split.exponent)].map((c) => SUPERSCRIPT[c] ?? c).join('')}`
    : trimZeros(Number(value.toPrecision(digits)).toString());
  return text.replace(/^-/, '−').replace('× 10⁰', '').trim();
}

/** A number for a fixed count of decimal places, with a minus sign. */
export function fixed(value: number, places: number): string {
  return value.toFixed(places).replace(/^-/, '−');
}

/** The same number in LaTeX: 1.03 \times 10^{-4}. */
export function tex(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return value > 0 ? '\\infty' : value < 0 ? '-\\infty' : '\\text{NaN}';
  const split = parts(value, digits);
  return split
    ? `${split.mantissa} \\times 10^{${split.exponent}}`
    : trimZeros(Number(value.toPrecision(digits)).toString());
}

/** An angle in whole degrees with three digits, as azimuths are written: 007, 120, 300. */
export function azimuth(degrees: number, places = 0): string {
  const turned = ((degrees % 360) + 360) % 360;
  const rounded = Number(turned.toFixed(places)) % 360;
  const [whole, fraction] = rounded.toFixed(places).split('.');
  return fraction ? `${whole.padStart(3, '0')}.${fraction}` : whole.padStart(3, '0');
}

/** Reads a typed number: commas between thousands, a Unicode minus, and 1.2e3 or 1.2×10^3 forms. */
export function readNumber(text: string): number | null {
  const raw = text
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(/\s*[×x]\s*10\^?/i, 'e')
    .replace(/\s+/g, '');
  if (raw === '') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw) ? Number(raw) : Number.NaN;
}
