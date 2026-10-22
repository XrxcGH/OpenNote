// The unit consistency checker: give each letter in an equation a unit, and it finds the dimension of each side in
// SI base units and flags every place the equation cannot be right, such as adding meters to seconds, a sine of a
// length, or a power with units. Units come from the calculator's unit engine, with the electrical units, force,
// frequency, and amount of substance added here; in this checker C is the coulomb and F the farad.
import { mathConstant, type Node } from '../../../core/expr';
import { calculatorUnits } from '../../tools/calculator/unitSystem';
import { SolverError, compile, isConstant, read } from './expr';
import { step, type Step } from './steps';

/** Powers of meter, kilogram, second, kelvin, ampere, mole, candela, and byte. */
export type Dims = readonly number[];
const BASE = ['m', 'kg', 's', 'K', 'A', 'mol', 'cd', 'B'] as const;
const NONE: Dims = [0, 0, 0, 0, 0, 0, 0, 0];

const d = (m = 0, kg = 0, s = 0, K = 0, A = 0, mol = 0): Dims => [m, kg, s, K, A, mol, 0, 0];

/** Units the converter does not have, by symbol. Prefixes are spelled out where people use them. */
const EXTRA: Readonly<Record<string, Dims>> = {
  N: d(1, 1, -2),
  kN: d(1, 1, -2),
  MN: d(1, 1, -2),
  lbf: d(1, 1, -2),
  Hz: d(0, 0, -1),
  kHz: d(0, 0, -1),
  MHz: d(0, 0, -1),
  A: d(0, 0, 0, 0, 1),
  mA: d(0, 0, 0, 0, 1),
  V: d(2, 1, -3, 0, -1),
  mV: d(2, 1, -3, 0, -1),
  kV: d(2, 1, -3, 0, -1),
  Ω: d(2, 1, -3, 0, -2),
  ohm: d(2, 1, -3, 0, -2),
  kΩ: d(2, 1, -3, 0, -2),
  C: d(0, 0, 1, 0, 1),
  F: d(-2, -1, 4, 0, 2),
  µF: d(-2, -1, 4, 0, 2),
  uF: d(-2, -1, 4, 0, 2),
  H: d(2, 1, -2, 0, -2),
  T: d(0, 1, -2, 0, -1),
  Wb: d(2, 1, -2, 0, -1),
  S: d(-2, -1, 3, 0, 2),
  mol: d(0, 0, 0, 0, 0, 1),
  kmol: d(0, 0, 0, 0, 0, 1),
  cd: [0, 0, 0, 0, 0, 0, 1, 0],
  rad: NONE,
  sr: NONE,
  '1': NONE,
};

const add = (a: Dims, b: Dims, sign = 1): Dims => a.map((x, i) => x + sign * b[i]);
const scale = (a: Dims, by: number): Dims => a.map((x) => x * by);
const same = (a: Dims, b: Dims): boolean => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
const plain = (a: Dims): boolean => a.every((x) => Math.abs(x) < 1e-9);

function lookUp(symbol: string): Dims | null {
  if (Object.hasOwn(EXTRA, symbol)) return EXTRA[symbol];
  const unit = calculatorUnits.find(symbol);
  if (!unit) return null;
  const [m, kg, s, K, byte] = unit.dim;
  return [m, kg, s, K, 0, 0, 0, byte];
}

/** The dimension of a unit written as text, such as kg*m/s^2, N·m, or m/s². */
export function unitDims(text: string): Dims {
  const source = text.trim().replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁻¹/g, '^-1').replace(/⁻²/g, '^-2');
  if (!source) return NONE;
  let out = NONE;
  let below = false;
  for (const token of source.match(/\/|[^\s*·/]+/g) ?? []) {
    if (token === '/') {
      below = true;
      continue;
    }
    const [, symbol, power] = /^(.+?)(?:\^\(?(-?\d+(?:\.\d+)?)\)?)?$/.exec(token) ?? [];
    const dims = symbol ? lookUp(symbol) : null;
    if (!dims) throw new SolverError('unit-unknown', token);
    out = add(out, scale(dims, (power ? Number(power) : 1) * (below ? -1 : 1)));
    below = false;
  }
  return out;
}

const SUPER: Record<string, string> = {
  '-': '⁻',
  '.': '·',
  ...Object.fromEntries([...'0123456789'].map((c, i) => [c, '⁰¹²³⁴⁵⁶⁷⁸⁹'[i]])),
};

/** A dimension in base units, such as kg·m²·s⁻², or 1 for none. */
export function dimsText(a: Dims): string {
  const parts = BASE.map((unit, i) => {
    const p = Number(a[i].toFixed(6));
    if (p === 0) return '';
    return p === 1 ? unit : `${unit}${String(p).replace(/[-.\d]/g, (c) => SUPER[c])}`;
  }).filter(Boolean);
  return parts.length ? parts.join('·') : '1';
}

export type UnitProblemCode = 'add' | 'argument' | 'exponent' | 'noUnit' | 'sides';

export interface UnitProblem {
  readonly code: UnitProblemCode;
  /** Where in the equation text, for underlining. */
  readonly start: number;
  readonly end: number;
  readonly left?: string;
  readonly right?: string;
  readonly name?: string;
}

export interface UnitCheck {
  readonly ok: boolean;
  readonly left: string;
  readonly right: string | null;
  readonly problems: readonly UnitProblem[];
  readonly steps: readonly Step[];
}

const DIMENSIONLESS_ARGUMENT = new Set([
  'sin',
  'cos',
  'tan',
  'sec',
  'csc',
  'cot',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'ln',
  'log',
  'log2',
  'log10',
  'factorial',
  'gamma',
]);

/** The place of the first equals sign outside every bracket, or -1. */
function equalsAt(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === '=' && depth === 0 && text[i + 1] !== '=' && text[i - 1] !== '<' && text[i - 1] !== '>') return i;
  }
  return -1;
}

/** Checks an equation (or an expression) with the unit of each letter. */
export function checkUnits(equation: string, units: Readonly<Record<string, string>>): UnitCheck {
  const at = equalsAt(equation);
  const sides = at < 0 ? [equation] : [equation.slice(0, at), equation.slice(at + 1)];
  const unitOf = new Map(Object.entries(units).map(([name, text]) => [name.trim(), unitDims(text)]));
  const problems: UnitProblem[] = [];
  const dims = sides.map((side, index) => {
    const offset = index === 0 ? 0 : at + 1;
    const node = read(side);
    // The tree's places count from the trimmed side text.
    const lead = side.length - side.trimStart().length;
    return dimsOf(node, unitOf, problems, offset + lead);
  });
  const steps: Step[] = [step('unitsLeft', dimsText(dims[0]))];
  if (dims[1]) {
    steps.push(step('unitsRight', dimsText(dims[1])));
    if (!same(dims[0], dims[1]))
      problems.push({
        code: 'sides',
        start: 0,
        end: equation.length,
        left: dimsText(dims[0]),
        right: dimsText(dims[1]),
      });
  }
  const ok = problems.length === 0;
  steps.push(step(ok ? 'unitsAgree' : 'unitsDisagree', '', { count: String(problems.length) }));
  return { ok, left: dimsText(dims[0]), right: dims[1] ? dimsText(dims[1]) : null, problems, steps };
}

function dimsOf(node: Node, units: ReadonlyMap<string, Dims>, problems: UnitProblem[], offset: number): Dims {
  const place = (n: Node) => ({ start: n.start + offset, end: n.end + offset });
  const walk = (n: Node): Dims => {
    switch (n.type) {
      case 'num':
        return NONE;
      case 'name': {
        const known = units.get(n.name);
        if (known) return known;
        if (mathConstant(n.name) === undefined) problems.push({ code: 'noUnit', ...place(n), name: n.name });
        return NONE;
      }
      case 'unary':
      case 'postfix':
        return n.type === 'unary' && n.op === '√' ? scale(walk(n.arg), 0.5) : walk(n.arg);
      case 'binary': {
        const left = walk(n.left);
        if (n.op === '^') {
          const right = walk(n.right);
          if (!plain(right)) problems.push({ code: 'exponent', ...place(n.right), left: dimsText(right) });
          if (isConstant(n.right)) return scale(left, compile(n.right, [])([]));
          if (!plain(left)) problems.push({ code: 'exponent', ...place(n), left: dimsText(left) });
          return NONE;
        }
        const right = walk(n.right);
        if (n.op === '*') return add(left, right);
        if (n.op === '/') return add(left, right, -1);
        if (n.op === '+' || n.op === '-') {
          if (!same(left, right))
            problems.push({ code: 'add', ...place(n), left: dimsText(left), right: dimsText(right) });
          return left;
        }
        return NONE;
      }
      case 'call': {
        const args = n.args.map(walk);
        if (n.name === 'sqrt') return scale(args[0], 0.5);
        if (n.name === 'cbrt') return scale(args[0], 1 / 3);
        if (n.name === 'abs' || n.name === 'min' || n.name === 'max' || n.name === 'sign') {
          args.slice(1).forEach((a, i) => {
            if (!same(a, args[0]))
              problems.push({ code: 'add', ...place(n.args[i + 1]), left: dimsText(args[0]), right: dimsText(a) });
          });
          return n.name === 'sign' ? NONE : args[0];
        }
        if (DIMENSIONLESS_ARGUMENT.has(n.name))
          args.forEach((a, i) => {
            if (!plain(a)) problems.push({ code: 'argument', ...place(n.args[i]), name: n.name, left: dimsText(a) });
          });
        return NONE;
      }
      default:
        throw new SolverError('unreadable', '');
    }
  };
  return walk(node);
}
