// Numbers as digits, for significant figures. A float cannot say that 1.20 has three significant figures, so a number
// is read from its text into its digits and a power of ten, and rounded, counted, and written from those. Nothing
// here uses a float except to read a result that was computed elsewhere.

/** A number as `d1.d2d3… × 10^exp`. `digits` has no leading zeros, and its length is the count of significant figures. */
export interface Dec {
  neg: boolean;
  digits: string;
  exp: number;
  /** True when the text had trailing zeros that are not significant, such as the zeros of 1200. */
  ambiguous: boolean;
  /** True when the text ended in a decimal point or had one, so all of its digits count. */
  point: boolean;
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
  '⁺': '+',
};
const SUPER_OUT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** An exponent written with superscript digits and a true minus sign. */
export function superscript(n: number): string {
  return `${n < 0 ? '⁻' : ''}${[...String(Math.abs(n))].map((d) => SUPER_OUT[Number(d)]).join('')}`;
}

const MANTISSA = /^([+\-−])?(\d*)(?:\.(\d*))?$/;
const TIMES_TEN = /^(.*?)\s*[x×*·]\s*10\s*(?:\^\s*\(?\s*([+\-−]?\d+)\s*\)?|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))$/;
const E_NOTATION = /^(.*?)[eE]([+\-−]?\d+)$/;

/** Reads number text such as `0.00120`, `1,200.`, `1.20e3`, or `1.2×10³`. Null when it is not a number. */
export function parseDec(text: string): Dec | null {
  let body = text.trim();
  let powerText = '0';
  const times = TIMES_TEN.exec(body);
  const sci = times === null ? E_NOTATION.exec(body) : null;
  if (times !== null) {
    body = times[1];
    powerText = times[2] ?? [...(times[3] ?? '')].map((ch) => SUPERSCRIPT[ch] ?? ch).join('');
  } else if (sci !== null) {
    body = sci[1];
    powerText = sci[2];
  }
  body = body.replace(/(?<=\d),(?=\d{3}(\D|$))/g, '').replace(/(?<=\d)[\s\u00a0\u202f](?=\d{3}(\D|$))/g, '');
  const m = MANTISSA.exec(body);
  if (m === null) return null;
  const whole = m[2] ?? '';
  const fraction = m[3];
  if (whole === '' && (fraction === undefined || fraction === '')) return null;
  const power = Number(powerText.replace('−', '-'));
  if (!Number.isSafeInteger(power) || Math.abs(power) > 100_000) return null;
  const neg = m[1] === '-' || m[1] === '−';
  const all = whole + (fraction ?? '');
  const lead = all.length - all.replace(/^0+/, '').length;
  const point = fraction !== undefined;
  if (lead === all.length) return { neg, digits: '0', exp: 0, ambiguous: false, point };
  let digits = all.slice(lead);
  const exp = whole.length - lead - 1 + power;
  let ambiguous = false;
  if (!point) {
    const trimmed = digits.replace(/0+$/, '');
    ambiguous = trimmed.length < digits.length;
    digits = trimmed;
  }
  return { neg, digits, exp, ambiguous, point };
}

/** The same digits and power for a finite number, using the shortest text that reads back to it. */
export function decOf(value: number): Dec {
  return parseDec(String(value)) ?? { neg: false, digits: '0', exp: 0, ambiguous: false, point: false };
}

export const isZero = (d: Dec): boolean => d.digits === '0';

/** How many significant figures. Zero counts as one. */
export const sigFigsOf = (d: Dec): number => d.digits.length;

/** The exponent of the last significant digit: 10^place is its place value. */
export const placeOf = (d: Dec): number => d.exp - (d.digits.length - 1);

/**
 * Rounds to the place whose value is 10^place, half away from zero. The result keeps every digit down to that place, so
 * rounding 1.5 to the hundredths gives 1.50. Rounding up through all nines carries (9.96 to tenths is 10.0).
 */
export function roundToPlace(d: Dec, place: number): Dec {
  if (isZero(d)) return { ...d, digits: '0', exp: place > 0 ? place : 0 };
  const keep = d.exp - place + 1;
  if (keep >= d.digits.length) {
    return { ...d, digits: d.digits + '0'.repeat(keep - d.digits.length), ambiguous: false, point: place < 0 };
  }
  if (keep < 0) return { ...d, digits: '0', exp: place, ambiguous: false, point: false };
  const up = d.digits.charCodeAt(keep) >= 53;
  if (keep === 0) {
    return up
      ? { ...d, digits: '1', exp: place, ambiguous: false, point: place < 0 }
      : { ...d, digits: '0', exp: place, ambiguous: false, point: false };
  }
  let kept = d.digits.slice(0, keep);
  let exp = d.exp;
  if (up) {
    const bumped = (BigInt(kept) + 1n).toString();
    if (bumped.length > kept.length) {
      exp += 1;
      kept = bumped.slice(0, keep + 1);
    } else {
      kept = bumped;
    }
  }
  const length = exp - place + 1;
  return { ...d, digits: kept.padEnd(length, '0'), exp, ambiguous: false, point: place < 0 };
}

/** Rounds to `figures` significant figures (at least one). */
export function roundToFigures(d: Dec, figures: number): Dec {
  const n = Math.max(1, Math.floor(figures));
  const done = roundToPlace(d, d.exp - n + 1);
  // Carrying through nines (9.96 to two figures) leaves one digit too many: it is 10, not 10.0.
  return done.digits.length > n ? { ...done, digits: done.digits.slice(0, n), point: false } : done;
}

/** Plain digits: 0.00120, 1200, 1200. (with its point when every digit counts), or -3.50. */
export function toPlain(d: Dec): string {
  const sign = d.neg && !isZero(d) ? '-' : '';
  if (isZero(d)) return d.exp < 0 ? `0.${'0'.repeat(-d.exp)}` : '0';
  const { digits, exp } = d;
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  if (exp >= digits.length - 1) {
    const whole = digits + '0'.repeat(exp - (digits.length - 1));
    return `${sign}${whole}${d.point && exp === digits.length - 1 && exp > 0 ? '.' : ''}`;
  }
  return `${sign}${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
}

/** Scientific notation with one digit before the point: 1.20×10³. */
export function toScientific(d: Dec): string {
  const sign = d.neg && !isZero(d) ? '-' : '';
  if (isZero(d)) return '0';
  const mantissa = d.digits.length > 1 ? `${d.digits[0]}.${d.digits.slice(1)}` : d.digits;
  return d.exp === 0 ? `${sign}${mantissa}` : `${sign}${mantissa}×10${superscript(d.exp)}`;
}

/** Engineering notation: the power of ten is a multiple of three, and the part before the point has one to three digits. */
export function toEngineering(d: Dec): string {
  const sign = d.neg && !isZero(d) ? '-' : '';
  if (isZero(d)) return '0';
  const power = Math.floor(d.exp / 3) * 3;
  const shift = d.exp - power;
  const digits = d.digits.padEnd(shift + 1, '0');
  const mantissa = digits.length > shift + 1 ? `${digits.slice(0, shift + 1)}.${digits.slice(shift + 1)}` : digits;
  return power === 0 ? `${sign}${mantissa}` : `${sign}${mantissa}×10${superscript(power)}`;
}

export type Notation = 'plain' | 'scientific' | 'engineering';

export function write(d: Dec, notation: Notation): string {
  return notation === 'scientific' ? toScientific(d) : notation === 'engineering' ? toEngineering(d) : toPlain(d);
}

/** The value of a Dec as a float, for arithmetic. */
export function valueOf(d: Dec): number {
  return isZero(d) ? 0 : Number(`${d.neg ? '-' : ''}${d.digits[0]}.${d.digits.slice(1) || '0'}e${d.exp}`);
}
