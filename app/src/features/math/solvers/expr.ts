// The solvers' shared helpers on the expression engine (core/expr): read text into a tree, run a tree with named
// variables, write a tree back as tidy text, swap a name for a tree, and say a number the way a textbook would
// (3/8, 2π/3). Nothing here runs text as code: trees become closures over the engine's fixed operations.
import {
  build,
  compileNode,
  differentiate,
  formatExpression,
  GENERAL,
  mathConstant,
  parse,
  simplify,
  standardFunctions,
  type Node,
} from '../../../core/expr';

const TABLE = standardFunctions('strict');

/** Why a solver could not go on. The interface turns the code into words. */
export class SolverError extends Error {
  constructor(
    readonly code: string,
    readonly detail = '',
  ) {
    super(code);
  }
}

/** Reads expression text with the general dialect. A missing multiplication sign between letters is a name. */
export function read(text: string): Node {
  const source = text.trim();
  if (!source) throw new SolverError('empty');
  try {
    const plain = source
      .replace(/\*\*/g, '^')
      .replace(/[·×]/g, '*')
      .replace(/−/g, '-')
      .replace(/θ/g, 'theta')
      .replace(/ρ/g, 'rho')
      .replace(/[φϕ]/g, 'phi');
    return parse(plain, GENERAL);
  } catch {
    throw new SolverError('unreadable', source);
  }
}

/** The names a tree reads that are not constants. */
export function namesIn(node: Node, out = new Set<string>()): Set<string> {
  switch (node.type) {
    case 'name':
      if (mathConstant(node.name) === undefined) out.add(node.name);
      break;
    case 'unary':
    case 'postfix':
      namesIn(node.arg, out);
      break;
    case 'binary':
      namesIn(node.left, out);
      namesIn(node.right, out);
      break;
    case 'call':
      for (const arg of node.args) namesIn(arg, out);
      break;
    default:
  }
  return out;
}

export type Fn = (values: readonly number[]) => number;

/**
 * A tree as a function of the named variables, in order. A variable shadows a constant of the same name, so phi can
 * be the polar angle. Where the expression is not defined the function gives NaN; it never throws.
 */
export function compile(node: Node, variables: readonly string[]): Fn {
  const missing = [...namesIn(node)].filter((name) => !variables.includes(name));
  if (missing.length) throw new SolverError('unknown-name', missing[0]);
  const run = compileNode<readonly number[]>(node, {
    strict: false,
    table: TABLE,
    bind: (name) => {
      const at = variables.indexOf(name);
      if (at >= 0) return (frame) => frame[at];
      const value = mathConstant(name);
      return value === undefined ? undefined : () => value;
    },
  });
  return (values) => {
    try {
      return run(values);
    } catch {
      return NaN;
    }
  };
}

/** A one-variable function. */
export function compile1(node: Node, variable: string): (x: number) => number {
  const fn = compile(node, [variable]);
  return (x) => fn([x]);
}

/** The tree with every `name` replaced by `by`. */
export function substitute(node: Node, name: string, by: Node): Node {
  switch (node.type) {
    case 'name':
      return node.name === name ? by : node;
    case 'unary':
    case 'postfix':
      return { ...node, arg: substitute(node.arg, name, by) };
    case 'binary':
      return { ...node, left: substitute(node.left, name, by), right: substitute(node.right, name, by) };
    case 'call':
      return { ...node, args: node.args.map((arg) => substitute(arg, name, by)) };
    default:
      return node;
  }
}

/** Simplifies, and gives the tree back unchanged when the simplifier gives up. */
export function tidy(node: Node): Node {
  try {
    return simplify(node);
  } catch {
    return node;
  }
}

/**
 * The tree with the numbers in each product gathered into one leading fraction and powers of π kept apart, so
 * -(27·(1/3)·cos(φ)) reads -9·cos(φ). The value never changes.
 */
export function neat(node: Node): Node {
  return tidy(neatInner(tidy(node)));
}

function neatInner(node: Node): Node {
  if (node.type === 'binary' && (node.op === '+' || node.op === '-'))
    return { ...node, left: neatInner(node.left), right: neatInner(node.right) };
  if (node.type === 'call') return { ...node, args: node.args.map(neatInner) };
  if (!(node.type === 'binary' && (node.op === '*' || node.op === '/')) && !(node.type === 'unary' && node.op === '-'))
    return node;
  let coefficient = 1;
  let piPower = 0;
  const top: Node[] = [];
  const bottom: Node[] = [];
  const walk = (part: Node, up: boolean): void => {
    if (part.type === 'binary' && part.op === '*') {
      walk(part.left, up);
      walk(part.right, up);
    } else if (part.type === 'binary' && part.op === '/') {
      walk(part.left, up);
      walk(part.right, !up);
    } else if (part.type === 'unary' && part.op === '-') {
      coefficient = -coefficient;
      walk(part.arg, up);
    } else if (part.type === 'num') {
      coefficient = up ? coefficient * part.value : coefficient / part.value;
    } else if (part.type === 'name' && part.name === 'pi') {
      piPower += up ? 1 : -1;
    } else (up ? top : bottom).push(neatInner(part));
  };
  walk(node, true);
  if (!asFraction(coefficient, 100_000, 1e-12)) return node;
  const pi = piPower === 0 ? null : piPower === 1 ? build.name('pi') : build.pow(build.name('pi'), build.num(piPower));
  const factors = [...(pi && piPower > 0 ? [pi] : []), ...top];
  let out: Node | null = factors.length ? factors.reduce((a, b) => build.mul(a, b)) : null;
  const magnitude = Math.abs(coefficient);
  const below = [...bottom, ...(pi && piPower < 0 ? [build.pow(build.name('pi'), build.num(-piPower))] : [])];
  const fraction = asFraction(magnitude, 100_000, 1e-12)!;
  if (fraction[0] !== 1 || !out) out = out ? build.mul(build.num(fraction[0]), out) : build.num(fraction[0]);
  if (fraction[1] !== 1) below.unshift(build.num(fraction[1]));
  if (below.length)
    out = build.div(
      out,
      below.reduce((a, b) => build.mul(a, b)),
    );
  return coefficient < 0 ? build.neg(out) : out;
}

/** The tree as text, simplified, with π for pi. */
export function show(node: Node): string {
  return prettyText(formatExpression(neat(node)));
}

/** Printer text, for reading: π, a raised dot for times, Greek angle names, and no -(...) around a product. */
export function prettyText(text: string): string {
  let out = text
    .replace(/\bpi\b/g, 'π')
    .replace(/\btheta\b/g, 'θ')
    .replace(/\bphi\b/g, 'φ')
    .replace(/\brho\b/g, 'ρ')
    .replace(/\*/g, '·');
  const wrapped = /^-\((.*)\)$/.exec(out);
  if (wrapped && balanced(wrapped[1]) && !/[+-]/.test(topLevel(wrapped[1]))) out = `-${wrapped[1]}`;
  return out;
}

function balanced(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    depth += c === '(' ? 1 : c === ')' ? -1 : 0;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** The text with everything inside brackets taken out, and exponents such as 1e-5 read as one word. */
function topLevel(text: string): string {
  let depth = 0;
  let out = '';
  for (const c of text) {
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (depth === 0) out += c;
  }
  return out.replace(/\de-/g, 'e');
}

/** The derivative, simplified. */
export function derive(node: Node, variable: string, order = 1): Node {
  try {
    return tidy(differentiate(node, variable, order));
  } catch {
    throw new SolverError('no-derivative', variable);
  }
}

/** True when the tree has no variables, only numbers and constants. */
export const isConstant = (node: Node): boolean => namesIn(node).size === 0;

/** The value of a tree with no variables. */
export const valueOf = (node: Node): number => compile(node, [])([]);

/** A fraction p/q close to x, with q at most `maxDen`, or null when none is within the tolerance. */
export function asFraction(x: number, maxDen = 10_000, tolerance = 1e-10): [number, number] | null {
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  let value = Math.abs(x);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  for (let i = 0; i < 40; i += 1) {
    const a = Math.floor(value);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > maxDen) return null;
    if (Math.abs(h1 / k1 - Math.abs(x)) <= tolerance * Math.max(1, Math.abs(x))) return [sign * h1, k1];
    const rest = value - a;
    if (rest < 1e-15) break;
    value = 1 / rest;
  }
  return Math.abs(h1 / k1 - Math.abs(x)) <= tolerance * Math.max(1, Math.abs(x)) ? [sign * h1, k1] : null;
}

/** A plain number: up to 10 significant digits, no trailing zeros, and a real minus sign. */
export function numberText(x: number, digits = 10): string {
  if (Number.isNaN(x)) return 'undefined';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  if (Math.abs(x) < 1e-13) return '0';
  const text =
    Math.abs(x) >= 1e9 || Math.abs(x) < 1e-5
      ? x.toExponential(digits - 1).replace(/\.?0+e/, 'e')
      : String(Number(x.toPrecision(digits)));
  return text.replace(/^-/, '−');
}

/** A number as a textbook writes it: a whole number, a small fraction, a fraction of π, or a decimal. */
export function niceNumber(x: number): string {
  const plain = asFraction(x, 1000);
  if (plain) return fractionText(plain, '');
  const ofPi = asFraction(x / Math.PI, 100);
  if (ofPi && ofPi[0] !== 0) return fractionText(ofPi, 'π');
  return numberText(x);
}

function fractionText([p, q]: [number, number], unit: string): string {
  const sign = p < 0 ? '−' : '';
  const top = Math.abs(p) === 1 && unit ? unit : `${Math.abs(p)}${unit}`;
  return q === 1 ? `${sign}${top}` : `${sign}${top}/${q}`;
}

/** A number as a tree, as a fraction when it is close to one. */
export function numberNode(x: number): Node {
  const fraction = asFraction(x, 10_000, 1e-12);
  if (fraction && fraction[1] !== 1) {
    const node = build.div(build.num(Math.abs(fraction[0])), build.num(fraction[1]));
    return fraction[0] < 0 ? build.neg(node) : node;
  }
  return x < 0 ? build.neg(build.num(-x)) : build.num(x);
}

export { build };
export type { Node };
