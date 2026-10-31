// Numbers for steps and answers: a set number of significant figures, with powers of ten written as ×10ⁿ in text
// and \times 10^{n} in LaTeX. Small and ordinary numbers stay in plain decimals so they read naturally.

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number): string =>
  `${n < 0 ? '⁻' : ''}${[...String(Math.abs(n))].map((d) => SUPER[Number(d)]).join('')}`;

function parts(x: number, sig: number): { mantissa: string; exponent: number } {
  if (x === 0) return { mantissa: '0', exponent: 0 };
  const [m, e] = x.toExponential(Math.max(0, sig - 1)).split('e');
  return { mantissa: trim(m!), exponent: Number(e) };
}

/** Drops trailing zeros after a decimal point: 2.500 to 2.5, 3.000 to 3. */
function trim(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** True when a number reads better in plain decimals than with a power of ten. */
const plain = (x: number): boolean => x === 0 || (Math.abs(x) >= 1e-3 && Math.abs(x) < 1e6);

function decimal(x: number, sig: number): string {
  return trim(Number(x.toPrecision(sig)).toString());
}

/** A number as text, such as 6.6759×10⁹ or 0.77384. */
export function fmt(x: number, sig = 5): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? '∞' : '−∞';
  if (plain(x)) return decimal(x, sig).replace('-', '−');
  const { mantissa, exponent } = parts(x, sig);
  return `${mantissa.replace('-', '−')}×10${sup(exponent)}`;
}

/** A number as LaTeX, such as 6.6759 \times 10^{9}. */
export function tex(x: number, sig = 5): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '\\mathrm{NaN}' : x > 0 ? '\\infty' : '-\\infty';
  if (plain(x)) return decimal(x, sig);
  const { mantissa, exponent } = parts(x, sig);
  return `${mantissa} \\times 10^{${exponent}}`;
}

/** A value with its unit in text: "23.508 µm". */
export const withUnit = (x: number, unit: string, sig = 5): string => (unit ? `${fmt(x, sig)} ${unit}` : fmt(x, sig));

/** A value with its unit in LaTeX: 23.508\,\mathrm{\mu m}. */
export const texUnit = (x: number, unit: string, sig = 5): string =>
  unit ? `${tex(x, sig)}\\,\\mathrm{${unit}}` : tex(x, sig);

const PREFIXES: readonly [number, string, string][] = [
  [-15, 'f', 'f'],
  [-12, 'p', 'p'],
  [-9, 'n', 'n'],
  [-6, 'µ', '\\mu '],
  [-3, 'm', 'm'],
  [0, '', ''],
  [3, 'k', 'k'],
  [6, 'M', 'M'],
  [9, 'G', 'G'],
  [12, 'T', 'T'],
];

/** The SI prefix that puts a value between 1 and 1000, within the prefixes a unit takes. */
function prefixFor(value: number, top: number): [number, string, string] {
  if (value === 0 || !Number.isFinite(value)) return [0, '', ''];
  const power = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  // Beyond the SI prefixes (above tera, below femto) plain scientific notation in the base unit reads better
  // than 3.828×10¹⁴ TW.
  if (power > 12 || power < -15) return [0, '', ''];
  const clamped = Math.min(power, top);
  return PREFIXES.find(([p]) => p === clamped) ?? [0, '', ''];
}

/** A value in an SI unit with a prefix, such as 23.508 µm or 8.9787 GHz. Lengths stop at km. */
export function prefixed(value: number, unit: string, sig = 5): string {
  const [power, symbol] = prefixFor(value, unit === 'm' ? 3 : 12);
  return `${fmt(value / 10 ** power, sig)} ${symbol}${unit}`;
}

/** The LaTeX of `prefixed`. */
export function prefixedTex(value: number, unit: string, sig = 5): string {
  const [power, , symbol] = prefixFor(value, unit === 'm' ? 3 : 12);
  return `${tex(value / 10 ** power, sig)}\\,\\mathrm{${symbol}${unit}}`;
}
