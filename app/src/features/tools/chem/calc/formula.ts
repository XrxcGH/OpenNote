// Chemical formulas: parsing, molar mass, and the Hill formula. Handles parentheses, hydrates (CuSO4.5H2O), and
// ignores a trailing charge. Masses come from the reference tables' element list.
import { ELEMENTS } from '../../reference/data';

const MASS = new Map(ELEMENTS.map((element) => [element.symbol, element.mass]));

export type Composition = Map<string, number>;

/** Element counts of a formula, or null when it cannot be read (unknown symbol, unbalanced bracket). */
export function parseFormula(text: string): Composition | null {
  const source = text
    .replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/[·•*]/g, '.')
    .replace(/\s+/g, '')
    .replace(/\^\d*[+-]$|[+-]$/, '');
  if (source === '') return null;
  let pos = 0;
  const number = (): number => {
    const start = pos;
    while (pos < source.length && /\d/.test(source[pos])) pos += 1;
    return start === pos ? 1 : Number(source.slice(start, pos));
  };
  const group = (close: string | null): Composition | null => {
    const total: Composition = new Map();
    const add = (part: Composition, times: number) => {
      for (const [symbol, count] of part) total.set(symbol, (total.get(symbol) ?? 0) + count * times);
    };
    while (pos < source.length) {
      const c = source[pos];
      if (c === close) return total;
      if (c === '(' || c === '[') {
        pos += 1;
        const inner = group(c === '(' ? ')' : ']');
        if (!inner || pos >= source.length) return null;
        pos += 1;
        add(inner, number());
      } else if (c === ')' || c === ']') {
        return null;
      } else if (c === '.') {
        pos += 1;
        const lead = number();
        const rest = group(close);
        if (!rest) return null;
        add(rest, lead);
        return total;
      } else if (/[A-Z]/.test(c)) {
        let symbol = c;
        pos += 1;
        if (pos < source.length && /[a-z]/.test(source[pos])) {
          symbol += source[pos];
          pos += 1;
        }
        if (!MASS.has(symbol)) return null;
        total.set(symbol, (total.get(symbol) ?? 0) + number());
      } else {
        return null;
      }
    }
    return close === null ? total : null;
  };
  const result = group(null);
  return result && result.size > 0 ? result : null;
}

/** The molar mass in g/mol, or null for an unreadable formula. */
export function molarMass(text: string): number | null {
  const parts = parseFormula(text);
  if (!parts) return null;
  let sum = 0;
  for (const [symbol, count] of parts) sum += (MASS.get(symbol) ?? 0) * count;
  return sum;
}

/** The Hill-order formula: C first, H second, then the rest alphabetically (all alphabetical without carbon). */
export function hillFormula(parts: Composition): string {
  const symbols = [...parts.keys()];
  const hasC = parts.has('C');
  const rest = symbols.filter((s) => !(hasC && (s === 'C' || s === 'H'))).sort();
  const order = hasC ? ['C', ...(parts.has('H') ? ['H'] : []), ...rest] : rest;
  return order.map((s) => `${s}${parts.get(s) === 1 ? '' : parts.get(s)}`).join('');
}

/** Percent by mass of each element. */
export function percentComposition(text: string): { symbol: string; percent: number }[] | null {
  const parts = parseFormula(text);
  const mass = molarMass(text);
  if (!parts || !mass) return null;
  return [...parts].map(([symbol, count]) => ({ symbol, percent: (100 * (MASS.get(symbol) ?? 0) * count) / mass }));
}
