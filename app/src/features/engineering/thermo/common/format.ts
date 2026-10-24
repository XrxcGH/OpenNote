// Numbers for worked steps and LaTeX: a set number of significant figures, scientific notation for very large or
// small values, and no trailing zeros. Pure, so engines and tests share it.

/** A number with sig significant figures: plain where it reads well, otherwise as 1.23e-5. */
export function fmt(value: number, sig = 5): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const size = Math.abs(value);
  if (size >= 1e-3 && size < 1e7) {
    const text = value.toPrecision(sig);
    return text.includes('e') ? String(Number(text)) : trimZeros(text);
  }
  const [mantissa, exponent] = value.toExponential(sig - 1).split('e');
  return `${trimZeros(mantissa)}e${Number(exponent)}`;
}

/** The same number for LaTeX: 1.23 \times 10^{-5} instead of 1.23e-5. */
export function tex(value: number, sig = 5): string {
  const text = fmt(value, sig);
  const at = text.indexOf('e');
  if (at < 0) return text;
  return `${text.slice(0, at)} \\times 10^{${text.slice(at + 1)}}`;
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
