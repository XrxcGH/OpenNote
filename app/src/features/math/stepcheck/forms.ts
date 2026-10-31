// Forms of working that Check my work reads as a whole: a derivative set to zero, the quadratic formula's letters, a
// function spread over a sum, a factoring, a limit's body, and a formula with values put in. Used by check.ts.
import { compareValues, fn, outcome, solutionsOf, type ChainState, type Equation, type Outcome } from './compare';
import { variables, type Atom, type Scalar, type Statement, type Value } from './read';
import { build, type Node, type Rational } from '../../../core/expr';
import { polynomial } from '../calculus/partial';
import { textOf } from '../calculus/print';

type Relations = Extract<Statement, { kind: 'relations' }>;

const namesOf = (atoms: Atom[]): Set<string> =>
  new Set(atoms.flatMap((atom) => variables(build.sub(atom.left.node, atom.right.node))));

/** y', y'', f'(x), dy/dx or d^2y/dx^2 before the first =, after an optional set or let. */
export const DERIVATIVE_LABEL =
  /^(?:(?:let|set)\s+)?([a-zA-Z]'+(?:\s*\(\s*[a-zA-Z]\s*\))?|d(?:\^2)?[a-zA-Z]\s*\/\s*d[a-zA-Z](?:\^2)?)\s*=\s*(.+)$/i;
export const HAS_DERIVATIVE = /'|\bd(?:\^2)?[a-zA-Z]?\s*\/\s*d[a-zA-Z]/;

/**
 * y' = 2x = 0: the derivative worked out, then set to zero. Read as y' = 2x and y' = 0, so the second is the equation
 * 2x = 0. Only when the last value is a number and the one before it has letters; f'(x) = 2x - 4 = 2(x - 2) is a chain.
 */
export function derivativeChain(text: string): string[] {
  const found = DERIVATIVE_LABEL.exec(text.trim());
  if (!found || /[<>≤≥≠]/.test(found[2])) return [text];
  const sides = found[2].split('=').map((side) => side.trim());
  if (sides.length !== 2 || !/[a-zA-Z]/.test(sides[0]) || !/^-?\d+(?:\.\d+)?$/.test(sides[1])) return [text];
  return [`${found[1]} = ${sides[0]}`, `${found[1]} = ${sides[1]}`];
}

/**
 * lim_(h→0) (2xh + h^2)/h, then = lim_(h→0) (2x + h^2): the same limit taken of a body that is not the same, a slip
 * even when the two limits agree. Null unless both values are limits at the same point of bodies with other letters.
 */
export function limitBodies(a: Value, b: Value, chain: ChainState, seed: number): Outcome | null {
  if (a.kind !== 'scalar' || b.kind !== 'scalar' || !a.limit || !b.limit) return null;
  if (a.limit.x !== b.limit.x || a.limit.to !== b.limit.to) return null;
  const body = (s: Scalar, node: Node): Value => ({ kind: 'scalar', node, integrals: [], text: s.text });
  const found = compareValues(body(a, a.limit.body), body(b, b.limit.body), chain, seed);
  return found.verdict === 'broken' ? outcome('broken', 'limitBody', found.method, 0.95, found.params) : null;
}

/** The letters of the quadratic formula. */
export const COEFFICIENTS = new Set(['a', 'b', 'c']);

/** Functions that do not spread over a sum, as sin(a + b) is not sin(a) + sin(b). */
export const SPREAD = new Set(['sin', 'cos', 'tan', 'ln', 'log', 'sqrt', 'exp']);

export const sameTree = (a: Node, b: Node) => textOf(a) === textOf(b);

/** True when `parts` is `whole` spread over its sum: sin(a) + sin(b) for sin(a + b), x^2 + y^2 for (x + y)^2. */
export function spreadOver(whole: Node, parts: Node): boolean {
  if (parts.type !== 'binary' || (parts.op !== '+' && parts.op !== '-')) return false;
  const call = whole.type === 'call' && whole.args.length === 1 && SPREAD.has(whole.name) ? whole : null;
  const power = whole.type === 'binary' && whole.op === '^' ? whole : null;
  const inner = call ? call.args[0] : power ? power.left : null;
  if (!inner || inner.type !== 'binary' || inner.op !== parts.op) return false;
  if (variables(inner.left).length === 0 || variables(inner.right).length === 0) return false;
  const applied = (part: Node, arg: Node) =>
    call
      ? part.type === 'call' && part.name === call.name && part.args.length === 1 && sameTree(part.args[0], arg)
      : !!power &&
        part.type === 'binary' &&
        part.op === '^' &&
        sameTree(part.left, arg) &&
        sameTree(part.right, power.right);
  return applied(parts.left, inner.left) && applied(parts.right, inner.right);
}

export const numberOf = (q: Rational) => Number(q.n) / Number(q.d);

/**
 * (x - 3)(x - 3) = 0 after x^2 - 9 = 0: a product of the same degree that does not multiply out to the line before
 * (or a multiple of it), so the factoring is off. The suggestion is the factoring by the real roots, when they are
 * whole numbers. Null for any other step, such as dividing by x, which drops a solution instead.
 */
export function factoringSlip(prev: Relations, statement: Relations, eq: Equation, seed: number): Outcome | null {
  const one = (s: Relations) => (s.groups.length === 1 && s.groups[0].length === 1 ? s.groups[0][0] : null);
  const [p, q] = [one(prev), one(statement)];
  const zero = (atom: Atom) =>
    atom.rel === '=' && variables(atom.right.node).length === 0 && fn(atom.right.node)({}) === 0;
  if (!p || !q || !zero(p) || !zero(q) || eq.names.length !== 1) return null;
  const top = q.left.node;
  if (top.type !== 'binary' || (top.op !== '*' && top.op !== '^')) return null;
  const x = eq.names[0];
  const [pa, pb] = [polynomial(p.left.node, x), polynomial(q.left.node, x)].map((poly) => poly?.map(numberOf) ?? null);
  if (!pa || !pb || pa.length !== pb.length || pa.length < 3) return null;
  const [la, lb] = [pa[pa.length - 1], pb[pb.length - 1]];
  if (pa.every((c, i) => Math.abs(c * lb - pb[i] * la) < 1e-9 * Math.max(1, Math.abs(c * lb)))) return null;
  const roots = solutionsOf(eq, seed);
  const whole = pa.length === 3 && roots.length >= 1 && roots.every(Number.isInteger) && Number.isInteger(la);
  const factor = (r: number) => (r === 0 ? x : r < 0 ? `(${x} + ${-r})` : `(${x} - ${r})`);
  const [r1, r2] = roots.length === 1 ? [roots[0], roots[0]] : roots;
  const lead = la === 1 ? '' : la === -1 ? '-' : `${la}`;
  const suggestion = whole ? `${lead}${factor(r1)}${factor(r2)} = 0` : undefined;
  return outcome('broken', 'factoringOff', 'symbolic', 0.97, {}, suggestion);
}

export interface Formula {
  statement: Relations;
  values: Map<string, Node>;
}

/** A = πr^2: one equation in two letters or more, with no integral in it. */
export function isFormula(s: Relations): boolean {
  if (s.groups.length !== 1 || s.groups[0].length !== 1) return false;
  const [atom] = s.groups[0];
  return atom.rel === '=' && atom.left.integrals.length + atom.right.integrals.length === 0 && namesOf([atom]).size > 1;
}

export const sameNumber = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * True when `target` is `pattern` with numbers in place of some of its letters (0 + 2 × 5 for u + at), the same
 * number each time a letter comes back. The numbers go into `bound`.
 */
export function fits(pattern: Node, target: Node, bound: Map<string, Node>): boolean {
  if (pattern.type === 'name' && variables(pattern).length > 0) {
    if (target.type === 'name' && target.name === pattern.name) return true;
    if (variables(target).length > 0) return false;
    const value = fn(target)({});
    if (!Number.isFinite(value)) return false;
    const had = bound.get(pattern.name);
    if (had) return sameNumber(fn(had)({}), value);
    bound.set(pattern.name, target);
    return true;
  }
  if (pattern.type !== target.type) return false;
  switch (pattern.type) {
    case 'num':
      return pattern.value === (target as typeof pattern).value;
    case 'name':
      return pattern.name === (target as typeof pattern).name;
    case 'binary': {
      const t = target as typeof pattern;
      return pattern.op === t.op && fits(pattern.left, t.left, bound) && fits(pattern.right, t.right, bound);
    }
    case 'unary':
    case 'postfix': {
      const t = target as typeof pattern;
      return pattern.op === t.op && fits(pattern.arg, t.arg, bound);
    }
    case 'call': {
      const t = target as typeof pattern;
      const same = pattern.name === t.name && pattern.args.length === t.args.length;
      return same && pattern.args.every((arg, i) => fits(arg, t.args[i], bound));
    }
    default:
      return false;
  }
}

/** True when a one-equation line is the formula above it with numbers in place of some of its letters. */
export function fitsLine(formula: Relations, statement: Relations, bound: Map<string, Node>): boolean {
  if (statement.groups.length !== 1 || statement.groups[0].length !== 1) return false;
  const [[p], [t]] = [formula.groups[0], statement.groups[0]];
  return t.rel === '=' && fits(p.left.node, t.left.node, bound) && fits(p.right.node, t.right.node, bound);
}

/** u = 0, a = 2, t = 5: letters and their values, for a reason's sentence. */
export const boundText = (bound: Map<string, Node>) =>
  [...bound].map(([name, value]) => `${name} = ${textOf(value)}`).join(', ');

/** 3x^2 + 2x, then = 3(2)^2 + 2(2): the expression with a number in place of each of its letters, or null. */
export function putInAll(a: Node, b: Node): Map<string, Node> | null {
  const bound = new Map<string, Node>();
  if (variables(b).length > 0 || !fits(a, b, bound)) return null;
  return variables(a).every((name) => bound.has(name)) ? bound : null;
}
