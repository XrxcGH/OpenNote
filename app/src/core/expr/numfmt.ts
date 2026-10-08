// Turns a number into text. The screen adds thousands separators and the locale decimal mark.

export type Notation = 'auto' | 'scientific' | 'engineering' | 'fixed';

export interface FormatOptions {
  notation?: Notation;
  /** Significant digits, 1 to 15. The default is 12. */
  digits?: number;
  /** Decimal places for fixed notation, 0 to 15. The default is 2. */
  decimals?: number;
}

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, Math.round(n)));

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

function split(abs: number, digits: number): { mantissa: string; exponent: number } {
  const [mantissa, exponent] = abs.toExponential(digits - 1).split('e');
  return { mantissa, exponent: Number(exponent) };
}

/** Moves the decimal point of "1.2345" right by some places: 2 gives "123.45". */
function shiftPoint(mantissa: string, places: number): string {
  const digits = mantissa.replace('.', '').padEnd(places + 1, '0');
  const rest = digits.slice(places + 1);
  return rest === '' ? digits : `${digits.slice(0, places + 1)}.${rest}`;
}

function engineering(abs: number, digits: number): string {
  const { mantissa, exponent } = split(abs, digits);
  const shift = ((exponent % 3) + 3) % 3;
  return `${trimZeros(shiftPoint(mantissa, shift))}e${exponent - shift}`;
}

function scientific(abs: number, digits: number): string {
  const { mantissa, exponent } = split(abs, digits);
  return `${trimZeros(mantissa)}e${exponent}`;
}

function automatic(abs: number, digits: number): string {
  const { exponent } = split(abs, digits);
  if (exponent >= digits || exponent < -6) return scientific(abs, digits);
  return String(Number(abs.toPrecision(digits)));
}

/** Formats a number. Uses "e" for powers of ten, such as 1.5e-7, and "-" for a minus sign. */
export function formatNumber(value: number, options: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return String(value);
  const digits = clamp(options.digits ?? 12, 1, 15);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs === 0) return '0';
  switch (options.notation ?? 'auto') {
    case 'scientific':
      return sign + scientific(abs, digits);
    case 'engineering':
      return sign + engineering(abs, digits);
    case 'fixed': {
      const fixed = abs.toFixed(clamp(options.decimals ?? 2, 0, 15));
      return abs >= 1e21 ? sign + scientific(abs, digits) : (Number(fixed) === 0 ? '' : sign) + fixed;
    }
    default:
      return sign + automatic(abs, digits);
  }
}
