// Balancing a chemical equation. The elements (and charge, for ions) give a linear system; the coefficients are its
// smallest whole-number solution, found by exact fraction elimination.
import { parseFormula, splitCharge } from './formula';

export interface Balanced {
  reactants: { text: string; coefficient: number }[];
  products: { text: string; coefficient: number }[];
  text: string;
}

export type BalanceResult =
  { ok: true; balanced: Balanced } | { ok: false; reason: 'format' | 'formula' | 'element' | 'cannot' | 'many' };

interface Species {
  text: string;
  counts: Map<string, number>;
}

type Fraction = [bigint, bigint];

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));

function species(text: string): Species | null {
  const bare = text.trim().replace(/^\d+\s*/, '');
  if (bare === 'e-') return { text: bare, counts: new Map([['charge', -1]]) };
  const counts = parseFormula(bare);
  if (!counts) return null;
  const charge = splitCharge(bare).charge;
  if (charge !== 0) counts.set('charge', charge);
  return { text: bare, counts };
}

/** Splits "A + B -> C + D" into the species of each side. */
export function splitEquation(equation: string): { left: string[]; right: string[] } | null {
  const sides = equation.split(/\s*(?:->|→|=>|⟶|=)\s*/);
  if (sides.length !== 2) return null;
  const list = (side: string) =>
    side
      .split(/\s+\+\s+|\s*\+\s*(?=[A-Z(\d])/)
      .map((s) => s.trim())
      .filter(Boolean);
  const left = list(sides[0]);
  const right = list(sides[1]);
  return left.length > 0 && right.length > 0 ? { left, right } : null;
}

const norm = (a: bigint, b: bigint): Fraction => {
  if (b < 0n) [a, b] = [-a, -b];
  const g = gcd(a, b) || 1n;
  return [a / g, b / g];
};
const sub = (a: Fraction, b: Fraction): Fraction => norm(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a: Fraction, b: Fraction): Fraction => norm(a[0] * b[0], a[1] * b[1]);
const div = (a: Fraction, b: Fraction): Fraction => norm(a[0] * b[1], a[1] * b[0]);

export function balance(equation: string): BalanceResult {
  const sides = splitEquation(equation);
  if (!sides) return { ok: false, reason: 'format' };
  const parsed = [...sides.left, ...sides.right].map(species);
  if (parsed.some((s) => s === null)) return { ok: false, reason: 'formula' };
  const list = parsed as Species[];
  const leftCount = sides.left.length;
  const keys = (from: number, to: number) => new Set(list.slice(from, to).flatMap((s) => [...s.counts.keys()]));
  const leftKeys = keys(0, leftCount);
  const rightKeys = keys(leftCount, list.length);
  const elements = [...new Set([...leftKeys, ...rightKeys])];
  for (const e of elements)
    if (e !== 'charge' && !(leftKeys.has(e) && rightKeys.has(e))) return { ok: false, reason: 'element' };

  const n = list.length;
  const matrix: Fraction[][] = elements.map((e) =>
    list.map((s, j) => norm(BigInt((s.counts.get(e) ?? 0) * (j < leftCount ? 1 : -1)), 1n)),
  );
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < n && row < matrix.length; col += 1) {
    const found = matrix.findIndex((r, i) => i >= row && r[col][0] !== 0n);
    if (found < 0) continue;
    [matrix[row], matrix[found]] = [matrix[found], matrix[row]];
    const lead = matrix[row][col];
    matrix[row] = matrix[row].map((v) => div(v, lead));
    for (let i = 0; i < matrix.length; i += 1) {
      if (i !== row && matrix[i][col][0] !== 0n) {
        const factor = matrix[i][col];
        const pivotRow = matrix[row];
        matrix[i] = matrix[i].map((v, j) => sub(v, mul(factor, pivotRow[j])));
      }
    }
    pivots.push(col);
    row += 1;
  }
  const free = Array.from({ length: n }, (_, i) => i).filter((i) => !pivots.includes(i));
  if (free.length > 1) return { ok: false, reason: 'many' };
  if (free.length !== 1) return { ok: false, reason: 'cannot' };
  const f = free[0];
  const solution: Fraction[] = Array.from({ length: n }, () => [0n, 1n] as Fraction);
  solution[f] = [1n, 1n];
  pivots.forEach((col, r) => {
    solution[col] = norm(-matrix[r][f][0], matrix[r][f][1]);
  });
  let lcm = 1n;
  for (const s of solution) lcm = (lcm * s[1]) / gcd(lcm, s[1]);
  const ints = solution.map((s) => (s[0] * lcm) / s[1]);
  if (ints.some((v) => v <= 0n)) return { ok: false, reason: 'cannot' };
  const divisor = ints.reduce((a, b) => gcd(a, b));
  const coefficients = ints.map((v) => Number(v / divisor));
  const make = (count: number, offset: number) =>
    Array.from({ length: count }, (_, i) => ({ text: list[offset + i].text, coefficient: coefficients[offset + i] }));
  const reactants = make(leftCount, 0);
  const products = make(list.length - leftCount, leftCount);
  const side = (items: typeof reactants) =>
    items.map((s) => `${s.coefficient === 1 ? '' : s.coefficient}${s.text}`).join(' + ');
  return { ok: true, balanced: { reactants, products, text: `${side(reactants)} → ${side(products)}` } };
}
