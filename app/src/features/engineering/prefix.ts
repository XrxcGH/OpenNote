// SI prefixes: "4.7 kΩ" and "2 mA" in place of 4700 Ω and 0.002 A, both ways. A value is shown with the prefix that
// leaves between 1 and 1000 of it, so 0.000047 F reads 47 µF. Typed text takes a prefix with or without the unit:
// "4.7k", "4.7 kΩ", "4k7" is not read, and "u" stands in for µ.
import { formatNumber } from '../../core/expr';

export const SI_PREFIXES: readonly { symbol: string; power: number }[] = [
  { symbol: 'Q', power: 30 },
  { symbol: 'R', power: 27 },
  { symbol: 'Y', power: 24 },
  { symbol: 'Z', power: 21 },
  { symbol: 'E', power: 18 },
  { symbol: 'P', power: 15 },
  { symbol: 'T', power: 12 },
  { symbol: 'G', power: 9 },
  { symbol: 'M', power: 6 },
  { symbol: 'k', power: 3 },
  { symbol: '', power: 0 },
  { symbol: 'm', power: -3 },
  { symbol: 'µ', power: -6 },
  { symbol: 'n', power: -9 },
  { symbol: 'p', power: -12 },
  { symbol: 'f', power: -15 },
  { symbol: 'a', power: -18 },
];

/** The prefix whose power of ten leaves between 1 and 1000 of the value, kept within the table. */
export function prefixFor(value: number): { symbol: string; power: number } {
  if (value === 0 || !Number.isFinite(value)) return { symbol: '', power: 0 };
  const power = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  const clamped = Math.max(-18, Math.min(30, power));
  return SI_PREFIXES.find((p) => p.power === clamped) ?? { symbol: '', power: 0 };
}

/** "4.7 kΩ": a value in base units with the prefix that suits it, to `digits` significant digits. */
export function withPrefix(value: number, unit: string, digits = 4): string {
  const { symbol, power } = prefixFor(value);
  let scaled = value / 10 ** power;
  // Rounding can carry 999.96 up to 1000; show that as 1 of the next prefix up.
  if (Math.abs(Number(scaled.toPrecision(digits))) >= 1000 && power < 30) {
    return withPrefix(Math.sign(value) * 10 ** (power + 3), unit, digits);
  }
  scaled = Number(scaled.toPrecision(digits));
  const text = formatNumber(Math.abs(scaled) < 1e-12 ? 0 : scaled, { digits }).replace(/^-/, '−');
  return `${text} ${symbol}${unit}`.trim();
}

/** Reads "4.7k", "4.7 kΩ", "-2 mA", or "1e-3" (with `unit` optional at the end). Null when it isn't a number. */
export function parsePrefixed(text: string, unit = ''): number | null {
  let rest = text.trim().replace('−', '-').replace(',', '.');
  if (unit !== '' && rest.endsWith(unit)) rest = rest.slice(0, -unit.length).trim();
  if (unit === 'Ω' && /ohms?$/i.test(rest)) rest = rest.replace(/ohms?$/i, '').trim();
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-zµμ]?)$/.exec(rest);
  if (!match) return null;
  const symbol = match[2] === 'u' || match[2] === 'μ' ? 'µ' : match[2];
  const prefix = SI_PREFIXES.find((p) => p.symbol === symbol && (symbol !== '' || match[2] === ''));
  if (!prefix) return null;
  return Number(match[1]) * 10 ** prefix.power;
}
