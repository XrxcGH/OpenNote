// Numbers as people read them: six significant figures, trailing zeros dropped, and powers of ten for very large or
// very small values. fmt is for sentences; tex is for the LaTeX of a step.

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

function parts(x: number, sig: number): { mantissa: string; exponent: number | null } {
  const a = Math.abs(x);
  if (x === 0 || (a >= 1e-3 && a < 1e7)) return { mantissa: String(Number(x.toPrecision(sig))), exponent: null };
  const [m, e] = x.toExponential(sig - 1).split('e');
  return { mantissa: String(Number(m)), exponent: Number(e) };
}

/** A number for a sentence or a table, such as 3.21328 or 3.333 × 10⁻⁶. */
export function fmt(x: number, sig = 6): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '-∞' : '?';
  const { mantissa, exponent } = parts(x, sig);
  if (exponent === null) return mantissa;
  const power = [...String(exponent)].map((c) => SUPERSCRIPT[c] ?? c).join('');
  return `${mantissa} × 10${power}`;
}

/** A number for LaTeX, such as 3.333 \times 10^{-6}. */
export function tex(x: number, sig = 6): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty';
  const { mantissa, exponent } = parts(x, sig);
  return exponent === null ? mantissa : `${mantissa} \\times 10^{${exponent}}`;
}

/** Degrees to radians. */
export const rad = (deg: number): number => (deg * Math.PI) / 180;
/** Radians to degrees. */
export const deg = (r: number): number => (r * 180) / Math.PI;
