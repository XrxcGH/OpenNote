// Chemistry helpers on the element data: the molar mass of a formula, and balancing a chemical equation. A formula is
// element symbols with counts, groups in parentheses or brackets, and hydrates after a dot: Ca(OH)2, K4[Fe(CN)6],
// CuSO4·5H2O. Charges are not read. Balancing solves the atom counts as a linear system with exact fractions, so the
// answer is the smallest whole numbers, and it says so when there is no solution or more than one.
import { ELEMENTS } from './data';

const MASS = new Map(ELEMENTS.map((element) => [element.symbol, element.mass]));

/** Atoms by element symbol. */
export type Atoms = Map<string, number>;

export type FormulaFailure = 'empty' | 'syntax' | 'unknown-element';
export type ParseResult = { ok: true; atoms: Atoms } | { ok: false; reason: FormulaFailure; detail: string };

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

/** Reads subscript digits as plain ones, and the dot variants as a middle dot. */
function normalize(text: string): string {
  return [...text.trim()]
    .map((char) => {
      const sub = SUBSCRIPTS.indexOf(char);
      if (sub >= 0) return String(sub);
      return char === '•' || char === '∙' ? '·' : char;
    })
    .join('');
}

const OPEN: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
const MAX_COUNT = 100000;

class Reader {
  position = 0;
  constructor(readonly text: string) {}
  peek(): string {
    return this.text[this.position] ?? '';
  }
  number(): number | null {
    const start = this.position;
    while (/\d/.test(this.peek())) this.position += 1;
    if (this.position === start) return null;
    const value = Number(this.text.slice(start, this.position));
    if (value > MAX_COUNT) throw new FormulaError('syntax', this.text.slice(start, this.position));
    return value;
  }
}

class FormulaError extends Error {
  constructor(
    readonly reason: FormulaFailure,
    readonly detail: string,
  ) {
    super(reason);
  }
}

function add(into: Atoms, from: Atoms, times: number): void {
  for (const [symbol, count] of from) into.set(symbol, (into.get(symbol) ?? 0) + count * times);
}

function readGroup(reader: Reader, close: string | null, depth: number): Atoms {
  if (depth > 12) throw new FormulaError('syntax', reader.text);
  const atoms: Atoms = new Map();
  for (;;) {
    const char = reader.peek();
    if (char === '') {
      if (close !== null) throw new FormulaError('syntax', reader.text);
      return atoms;
    }
    if (char === close) return atoms;
    if (char in OPEN) {
      reader.position += 1;
      const inner = readGroup(reader, OPEN[char], depth + 1);
      reader.position += 1;
      add(atoms, inner, reader.number() ?? 1);
    } else if (/[A-Z]/.test(char)) {
      let symbol = char;
      reader.position += 1;
      if (/[a-z]/.test(reader.peek()) && MASS.has(symbol + reader.peek())) {
        symbol += reader.peek();
        reader.position += 1;
      }
      if (!MASS.has(symbol)) throw new FormulaError('unknown-element', symbol);
      atoms.set(symbol, (atoms.get(symbol) ?? 0) + (reader.number() ?? 1));
    } else {
      throw new FormulaError('syntax', char);
    }
  }
}

/** The atoms in a formula, such as H2O or CuSO4·5H2O. */
export function parseFormula(formula: string): ParseResult {
  const text = normalize(formula).replace(/\s+/g, '');
  if (text === '') return { ok: false, reason: 'empty', detail: '' };
  try {
    const atoms: Atoms = new Map();
    for (const part of text.split(/[·.*]/)) {
      const reader = new Reader(part);
      const times = reader.number() ?? 1;
      if (reader.peek() === '') throw new FormulaError('syntax', part);
      const inner = readGroup(reader, null, 0);
      add(atoms, inner, times);
    }
    return { ok: true, atoms };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, reason: error.reason, detail: error.detail };
    throw error;
  }
}

export interface MassPart {
  symbol: string;
  count: number;
  /** Grams per mole contributed by this element. */
  mass: number;
  /** Percent of the total mass. */
  percent: number;
}

export type MolarMass =
  { ok: true; mass: number; parts: MassPart[] } | { ok: false; reason: FormulaFailure; detail: string };

/** The molar mass of a formula in grams per mole, with what each element adds. */
export function molarMass(formula: string): MolarMass {
  const parsed = parseFormula(formula);
  if (!parsed.ok) return parsed;
  let total = 0;
  for (const [symbol, count] of parsed.atoms) total += (MASS.get(symbol) ?? 0) * count;
  const parts = [...parsed.atoms].map(([symbol, count]) => {
    const mass = (MASS.get(symbol) ?? 0) * count;
    return { symbol, count, mass, percent: (mass / total) * 100 };
  });
  return { ok: true, mass: total, parts };
}

/** A formula for display, with its counts as subscripts: H2O becomes H₂O, and the 5 in CuSO4·5H2O stays plain. */
export function prettyFormula(formula: string): string {
  const text = normalize(formula).replace(/\s+/g, '');
  return text
    .split('·')
    .map((part, index) => {
      const lead = index > 0 ? (/^\d+/.exec(part)?.[0] ?? '') : '';
      return (
        lead +
        part.slice(lead.length).replace(/\d+/g, (digits) => [...digits].map((d) => SUBSCRIPTS[Number(d)]).join(''))
      );
    })
    .join('·');
}

export type BalanceFailure = FormulaFailure | 'no-arrow' | 'cannot-balance' | 'many-ways' | 'one-side';
export type Balanced =
  | { ok: true; reactants: string[]; products: string[]; coefficients: number[]; text: string }
  | { ok: false; reason: BalanceFailure; detail: string };

// ---- exact fractions with BigInt, so a balance never suffers from rounding -------------------------------------------

type Fraction = readonly [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};
const fraction = (n: bigint, d: bigint = 1n): Fraction => {
  if (d < 0n) return fraction(-n, -d);
  const g = gcd(n, d) || 1n;
  return [n / g, d / g];
};
const sub = (a: Fraction, b: Fraction): Fraction => fraction(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a: Fraction, b: Fraction): Fraction => fraction(a[0] * b[0], a[1] * b[1]);
const div = (a: Fraction, b: Fraction): Fraction => fraction(a[0] * b[1], a[1] * b[0]);

/** The null space of a matrix of integers (rows are elements, columns are species), as vectors of fractions. */
function nullSpace(rows: readonly (readonly number[])[], columns: number): Fraction[][] {
  const matrix: Fraction[][] = rows.map((row) => row.map((value) => fraction(BigInt(value))));
  const pivots: number[] = [];
  let row = 0;
  for (let column = 0; column < columns && row < matrix.length; column += 1) {
    const found = matrix.findIndex((candidate, index) => index >= row && candidate[column][0] !== 0n);
    if (found < 0) continue;
    [matrix[row], matrix[found]] = [matrix[found], matrix[row]];
    const pivot = matrix[row][column];
    matrix[row] = matrix[row].map((value) => div(value, pivot));
    for (let other = 0; other < matrix.length; other += 1) {
      if (other === row || matrix[other][column][0] === 0n) continue;
      const factor = matrix[other][column];
      matrix[other] = matrix[other].map((value, index) => sub(value, mul(factor, matrix[row][index])));
    }
    pivots.push(column);
    row += 1;
  }
  const free = Array.from({ length: columns }, (_, index) => index).filter((index) => !pivots.includes(index));
  return free.map((freeColumn) => {
    const vector: Fraction[] = Array.from({ length: columns }, () => fraction(0n));
    vector[freeColumn] = fraction(1n);
    pivots.forEach((pivotColumn, index) => {
      vector[pivotColumn] = fraction(-matrix[index][freeColumn][0], matrix[index][freeColumn][1]);
    });
    return vector;
  });
}

const ARROW = /\s*(?:<?[-=]+>|→|⟶|⇌|⇒|=)\s*/;

/** Splits "2H2 + O2" into species, ignoring any coefficient typed in front of one. */
function species(side: string): string[] {
  return side
    .split(/\s+\+\s+|\+(?=\s*(?:\d*[A-Z([{]))/)
    .map((one) => one.trim().replace(/^\d+\s*/, ''))
    .filter((one) => one !== '');
}

/** Balances an equation such as "H2 + O2 -> H2O": the smallest whole-number coefficients that keep every atom. */
export function balanceEquation(equation: string): Balanced {
  const text = normalize(equation);
  if (text === '') return { ok: false, reason: 'empty', detail: '' };
  const sides = text.split(ARROW);
  if (sides.length < 2) return { ok: false, reason: 'no-arrow', detail: '' };
  if (sides.length > 2) return { ok: false, reason: 'syntax', detail: text };
  const reactants = species(sides[0]);
  const products = species(sides[1]);
  if (reactants.length === 0 || products.length === 0) return { ok: false, reason: 'one-side', detail: '' };
  const all = [...reactants, ...products];
  if (all.length > 24) return { ok: false, reason: 'syntax', detail: text };
  const parsed: Atoms[] = [];
  for (const one of all) {
    const result = parseFormula(one);
    if (!result.ok) return result;
    parsed.push(result.atoms);
  }
  const symbols = [...new Set(parsed.flatMap((atoms) => [...atoms.keys()]))];
  const rows = symbols.map((symbol) =>
    parsed.map((atoms, index) => (atoms.get(symbol) ?? 0) * (index < reactants.length ? 1 : -1)),
  );
  const basis = nullSpace(rows, all.length);
  if (basis.length === 0) return { ok: false, reason: 'cannot-balance', detail: '' };
  if (basis.length > 1) return { ok: false, reason: 'many-ways', detail: '' };
  const vector = basis[0];
  const lcm = vector.reduce((acc, value) => (acc * value[1]) / gcd(acc, value[1]), 1n);
  let whole = vector.map((value) => (value[0] * lcm) / value[1]);
  if (whole.every((value) => value <= 0n)) whole = whole.map((value) => -value);
  if (whole.some((value) => value <= 0n)) return { ok: false, reason: 'cannot-balance', detail: '' };
  const divisor = whole.reduce((acc, value) => gcd(acc, value), 0n);
  whole = whole.map((value) => value / divisor);
  const coefficients = whole.map(Number);
  const term = (name: string, index: number) =>
    `${coefficients[index] === 1 ? '' : coefficients[index]}${prettyFormula(name)}`;
  const left = reactants.map((name, index) => term(name, index)).join(' + ');
  const right = products.map((name, index) => term(name, reactants.length + index)).join(' + ');
  return { ok: true, reactants, products, coefficients, text: `${left} → ${right}` };
}

/** Rounds a molar mass for display: up to three decimals, no trailing zeros. */
export const formatMass = (mass: number): string => String(Math.round(mass * 1000) / 1000);
