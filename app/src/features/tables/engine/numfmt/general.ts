// The General format: a number in at most 11 characters, as a spreadsheet shows it in a standard-width column.
// The decimal form wins unless the scientific form keeps more significant digits, so 123456789012 is 1.23457E+11,
// 0.0000123456789 is 1.23457E-05, and 0.1+0.2 is 0.3 (values are read to 15 significant digits first).

import { fixedDigits, toDigits } from './digits';

const WIDTH = 11;

function significant(int: string, frac: string): number {
  return (int + frac).replace(/^0+/, '').replace(/0+$/, '').length;
}

function scientific(value: number, width: number, decimal: string): { text: string; sig: number } {
  const digits = toDigits(value);
  let e = digits.p - 1;
  const exponent = (n: number) => `${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  const avail = Math.max(0, width - 3 - exponent(e).length);
  let { int, frac } = fixedDigits({ d: digits.d, p: 1 }, avail);
  if (int.length > 1) {
    e++;
    int = '1';
    frac = '';
  }
  const f = frac.replace(/0+$/, '');
  return { text: `${int}${f ? decimal + f : ''}E${exponent(e)}`, sig: significant(int, f) };
}

/** The General text of a finite number, with the region's decimal mark. */
export function generalText(value: number, decimal = '.'): string {
  if (value === 0) return '0';
  const sign = value < 0 ? '-' : '';
  const width = WIDTH - sign.length;
  const digits = toDigits(value);
  const sci = scientific(value, width, decimal);
  if (digits.p <= width) {
    const intLen = Math.max(1, digits.p);
    const avail = Math.max(0, width - intLen - 1);
    const { int, frac } = fixedDigits(digits, avail);
    const f = frac.replace(/0+$/, '');
    const text = `${int || '0'}${f ? decimal + f : ''}`;
    const sig = significant(int, f);
    if (text.length <= width && sig > 0 && sig >= sci.sig) return sign + text;
  }
  return sign + sci.text;
}
