// Engineering units for table columns: SI units with any prefix (kN, MPa, mm, µF, kΩ), US customary units (lbf, kip,
// psi, ksi, ft, in), and products, quotients, and powers of them (N·m, kN/m, m/s^2, W/(m·K)). A unit is a factor to
// SI base units and the powers of the seven base dimensions, so 250 N converts to 0.25 kN and N·m to J, while N and
// N·m do not mix. Only a lone °C or °F has an offset; inside a compound unit it is a temperature difference.
//
// Symbols follow the SI brochure: C is the coulomb and F the farad, so Celsius and Fahrenheit are °C and °F (or degC
// and degF). A symbol written exactly is tried before a prefixed one, so "min" is minutes and "Pa" is pascals.
import { formatNumber } from '../expr';
import { SI_PREFIXES, superscriptPower, withPrefix } from './prefix';

/** Powers of m, kg, s, K, A, mol, and cd. */
export type Dim = readonly [number, number, number, number, number, number, number];

export interface Unit {
  factor: number;
  dim: Dim;
  offset?: number;
}

const D = (m = 0, kg = 0, s = 0, K = 0, A = 0, mol = 0, cd = 0): Dim => [m, kg, s, K, A, mol, cd];

/** Units that take an SI prefix: symbol, factor to SI base units, dimension. */
const PREFIXABLE: readonly [string, number, Dim][] = [
  ['m', 1, D(1)],
  ['g', 1e-3, D(0, 1)],
  ['s', 1, D(0, 0, 1)],
  ['K', 1, D(0, 0, 0, 1)],
  ['A', 1, D(0, 0, 0, 0, 1)],
  ['mol', 1, D(0, 0, 0, 0, 0, 1)],
  ['cd', 1, D(0, 0, 0, 0, 0, 0, 1)],
  ['N', 1, D(1, 1, -2)],
  ['Pa', 1, D(-1, 1, -2)],
  ['J', 1, D(2, 1, -2)],
  ['W', 1, D(2, 1, -3)],
  ['C', 1, D(0, 0, 1, 0, 1)],
  ['V', 1, D(2, 1, -3, 0, -1)],
  ['F', 1, D(-2, -1, 4, 0, 2)],
  ['Ω', 1, D(2, 1, -3, 0, -2)],
  ['ohm', 1, D(2, 1, -3, 0, -2)],
  ['S', 1, D(-2, -1, 3, 0, 2)],
  ['Wb', 1, D(2, 1, -2, 0, -1)],
  ['T', 1, D(0, 1, -2, 0, -1)],
  ['H', 1, D(2, 1, -2, 0, -2)],
  ['Hz', 1, D(0, 0, -1)],
  ['L', 1e-3, D(3)],
  ['l', 1e-3, D(3)],
  ['eV', 1.602176634e-19, D(2, 1, -2)],
  ['Wh', 3600, D(2, 1, -2)],
  ['Ah', 3600, D(0, 0, 1, 0, 1)],
  ['bar', 1e5, D(-1, 1, -2)],
  ['cal', 4.184, D(2, 1, -2)],
  ['t', 1000, D(0, 1)],
];

const LBF = 4.4482216152605;
const IN = 0.0254;

/** Units that take no prefix. */
const PLAIN: readonly [string, number, Dim][] = [
  ['min', 60, D(0, 0, 1)],
  ['h', 3600, D(0, 0, 1)],
  ['hr', 3600, D(0, 0, 1)],
  ['day', 86400, D(0, 0, 1)],
  ['in', IN, D(1)],
  ['ft', 0.3048, D(1)],
  ['yd', 0.9144, D(1)],
  ['mi', 1609.344, D(1)],
  ['lb', 0.45359237, D(0, 1)],
  ['lbm', 0.45359237, D(0, 1)],
  ['slug', LBF / 0.3048, D(0, 1)],
  ['oz', 0.028349523125, D(0, 1)],
  ['lbf', LBF, D(1, 1, -2)],
  ['kip', 1000 * LBF, D(1, 1, -2)],
  ['psi', LBF / IN ** 2, D(-1, 1, -2)],
  ['ksi', (1000 * LBF) / IN ** 2, D(-1, 1, -2)],
  ['psf', LBF / 0.3048 ** 2, D(-1, 1, -2)],
  ['atm', 101325, D(-1, 1, -2)],
  ['mmHg', 133.322387415, D(-1, 1, -2)],
  ['hp', 745.69987158227, D(2, 1, -3)],
  ['Btu', 1055.05585262, D(2, 1, -2)],
  ['gal', 0.003785411784, D(3)],
  ['rpm', 1 / 60, D(0, 0, -1)],
  ['rad', 1, D()],
  ['deg', Math.PI / 180, D()],
  ['°', Math.PI / 180, D()],
  ['%', 0.01, D()],
];

const TEMPERATURES: Readonly<Record<string, Unit>> = {
  '°C': { factor: 1, offset: 273.15, dim: D(0, 0, 0, 1) },
  degC: { factor: 1, offset: 273.15, dim: D(0, 0, 0, 1) },
  '°F': { factor: 5 / 9, offset: 255.3722222222222, dim: D(0, 0, 0, 1) },
  degF: { factor: 5 / 9, offset: 255.3722222222222, dim: D(0, 0, 0, 1) },
  '°R': { factor: 5 / 9, dim: D(0, 0, 0, 1) },
};

const EXACT = new Map<string, Unit>();
for (const [symbol, factor, dim] of [...PREFIXABLE, ...PLAIN]) EXACT.set(symbol, { factor, dim });
EXACT.set('kg', { factor: 1, dim: D(0, 1) });
// In a compound unit, such as W/(m·°C), a degree is a temperature difference.
for (const [symbol, factor] of [
  ['°C', 1],
  ['degC', 1],
  ['°F', 5 / 9],
  ['degF', 5 / 9],
] as const) {
  EXACT.set(symbol, { factor, dim: D(0, 0, 0, 1) });
}
const BASE = new Map<string, Unit>(PREFIXABLE.map(([symbol, factor, dim]) => [symbol, { factor, dim }]));

/** The prefixes that are not a power of a thousand, read but never written: hPa, cm, dm, daN. */
const SMALL_PREFIXES = [
  { symbol: 'da', power: 1 },
  { symbol: 'h', power: 2 },
  { symbol: 'd', power: -1 },
  { symbol: 'c', power: -2 },
];

/** One symbol, such as "kN", "MPa", "µm", or "ft". */
function symbolUnit(symbol: string): Unit | null {
  const exact = EXACT.get(symbol);
  if (exact) return exact;
  const normalized = symbol.replace(/^u/, 'µ').replace(/^μ/, 'µ');
  for (const prefix of [...SMALL_PREFIXES, ...SI_PREFIXES]) {
    if (prefix.symbol === '' || !normalized.startsWith(prefix.symbol)) continue;
    const base = BASE.get(normalized.slice(prefix.symbol.length));
    if (base) return { factor: base.factor * 10 ** prefix.power, dim: base.dim };
  }
  return null;
}

const SUPERSCRIPTS: Record<string, string> = { '⁻': '-', '¹': '1', '²': '2', '³': '3', '⁴': '4' };

class Reader {
  private at = 0;
  constructor(private readonly text: string) {}
  done(): boolean {
    return this.at >= this.text.length;
  }
  peek(): string {
    return this.text[this.at] ?? '';
  }
  next(): string {
    return this.text[this.at++] ?? '';
  }
  /** A product of factors: separators multiply, a slash divides the next factor. */
  product(): Unit | null {
    let unit: Unit = { factor: 1, dim: D() };
    let first = true;
    while (!this.done() && this.peek() !== ')') {
      let sign = 1;
      const c = this.peek();
      if (c === '/') {
        this.next();
        sign = -1;
      } else if (!first && /[·*.⋅\s]/.test(c)) {
        this.next();
        // A separator needs a factor after it.
        if (this.done() || this.peek() === ')') return null;
        continue;
      }
      const factor = this.factor();
      if (!factor) return null;
      unit = multiply(unit, factor, sign);
      first = false;
    }
    return unit;
  }
  private factor(): Unit | null {
    let unit: Unit | null;
    if (this.peek() === '(') {
      this.next();
      unit = this.product();
      if (this.next() !== ')') return null;
    } else {
      let symbol = '';
      while (!this.done() && /[A-Za-zµμΩ°%]/.test(this.peek())) symbol += this.next();
      unit = symbol === '' ? null : symbolUnit(symbol);
    }
    if (!unit) return null;
    const power = this.power();
    return power === null ? null : power === 1 ? unit : raise(unit, power);
  }
  private power(): number | null {
    let text = '';
    if (this.peek() === '^') {
      this.next();
      while (/[-+\d]/.test(this.peek())) text += this.next();
    } else {
      while (this.peek() in SUPERSCRIPTS) text += SUPERSCRIPTS[this.next()];
    }
    if (text === '') return 1;
    const power = Number(text);
    return Number.isInteger(power) && power !== 0 ? power : null;
  }
}

function multiply(a: Unit, b: Unit, sign: 1 | -1 | number): Unit {
  return {
    factor: a.factor * b.factor ** sign,
    dim: a.dim.map((d, i) => d + sign * b.dim[i]) as unknown as Dim,
  };
}

const raise = (u: Unit, power: number): Unit => ({
  factor: u.factor ** power,
  dim: u.dim.map((d) => d * power) as unknown as Dim,
});

const cache = new Map<string, Unit | null>();

/** Reads a unit such as "kN·m", "N/mm^2", or "m/s²". Null when any part is unknown. */
export function parseUnit(text: string): Unit | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > 40) return null;
  const known = cache.get(trimmed);
  if (known !== undefined) return known;
  let unit: Unit | null = TEMPERATURES[trimmed] ?? null;
  if (!unit) {
    const reader = new Reader(trimmed);
    unit = reader.product();
    if (!reader.done()) unit = null;
  }
  if (cache.size > 500) cache.clear();
  cache.set(trimmed, unit);
  return unit;
}

export const sameDim = (a: Unit, b: Unit) => a.dim.every((d, i) => Math.abs(d - b.dim[i]) < 1e-12);

/** Converts a value between units of the same kind. Null when either is unknown or they measure different things. */
export function convertUnit(value: number, from: string, to: string): number | null {
  const a = parseUnit(from);
  const b = parseUnit(to);
  if (!a || !b || !sameDim(a, b)) return null;
  const si = value * a.factor + (a.offset ?? 0);
  return clean((si - (b.offset ?? 0)) / b.factor);
}

const clean = (value: number) => (Math.abs(value) < 1e-300 ? 0 : Number(value.toPrecision(15)));

/** Splits "250 N" or "1.2e3 kN·m" into the number's text and the unit's text. */
export function splitQuantity(text: string): { number: string; unit: string } {
  const match = /^\s*([-+−]?[\d\s.,'’]*\d(?:[eE][-+]?\d+)?%?)\s*(.*?)\s*$/.exec(text);
  if (!match) return { number: text.trim(), unit: '' };
  return { number: match[1], unit: match[2] };
}

export type Notation = 'engineering' | 'si';

/** A number in engineering notation, with a power of ten that is a multiple of 3: 12.5×10³. */
export function engineeringText(value: number, digits = 4): string {
  return superscriptPower(formatNumber(value, { notation: 'engineering', digits })).replace(/^-/, '−');
}

/**
 * A column's value with SI prefixes: 12500 in a column of N reads "12.5 kN", and 0.0042 in a column of m reads
 * "4.2 mm". Null when the column's unit is not one prefixable symbol (N·m, ft, °C), which then shows as written.
 */
export function prefixedText(value: number, unit: string, digits = 4): string | null {
  const symbol = unit.trim().replace(/^[uμ]/, 'µ');
  if (PLAIN.some(([plain]) => plain === symbol)) return null;
  for (const [base] of PREFIXABLE) {
    if (!symbol.endsWith(base)) continue;
    const head = symbol.slice(0, symbol.length - base.length);
    const prefix = head === '' ? { power: 0 } : SI_PREFIXES.find((p) => p.symbol !== '' && p.symbol === head);
    if (!prefix) continue;
    return withPrefix(value * 10 ** prefix.power, base === 'ohm' ? 'Ω' : base, digits);
  }
  return null;
}
