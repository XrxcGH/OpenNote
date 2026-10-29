// Integration for the solvers. Antiderivatives are found the way a first calculus course finds them: the power rule,
// linear substitution, and integration by parts for a polynomial times an exponential or a sine. A numeric rule does
// everything else. `antiderivative` gives null rather than a wrong answer when no rule fits. The numeric rule is
// tanh-sinh quadrature, which keeps full accuracy at endpoints where the integrand has a square root or a log.
import { dependsOn } from '../../../core/expr';
import {
  asFraction,
  build,
  compile,
  derive,
  isConstant,
  namesIn,
  numberNode,
  substitute,
  tidy,
  valueOf,
  type Node,
} from './expr';

const { add, sub, mul, div, pow, num, neg, call, name } = build;

/** A polynomial in one variable: the coefficient trees by power. Coefficients do not depend on the variable. */
export type Poly = Map<number, Node>;

const ONE = num(1);
const ZERO = num(0);

function addInto(out: Poly, power: number, coefficient: Node): void {
  const had = out.get(power);
  out.set(power, had ? add(had, coefficient) : coefficient);
}

function times(a: Poly, b: Poly): Poly {
  const out: Poly = new Map();
  for (const [pa, ca] of a) for (const [pb, cb] of b) addInto(out, pa + pb, mul(ca, cb));
  return out;
}

/** The tree as a polynomial in `v`, or null when it is not one (a power of `v` above 12 counts as not). */
export function polyOf(node: Node, v: string): Poly | null {
  if (!dependsOn(node, v)) return new Map([[0, node]]);
  switch (node.type) {
    case 'name':
      return new Map([[1, ONE]]);
    case 'unary': {
      const inner = polyOf(node.arg, v);
      if (!inner || node.op === '√') return null;
      return node.op === '-' ? new Map([...inner].map(([p, c]) => [p, neg(c)])) : inner;
    }
    case 'binary': {
      if (node.op === '+' || node.op === '-') {
        const left = polyOf(node.left, v);
        const right = polyOf(node.right, v);
        if (!left || !right) return null;
        const out: Poly = new Map(left);
        for (const [p, c] of right) addInto(out, p, node.op === '-' ? neg(c) : c);
        return out;
      }
      if (node.op === '*') {
        const left = polyOf(node.left, v);
        const right = left && polyOf(node.right, v);
        return left && right ? times(left, right) : null;
      }
      if (node.op === '/' && !dependsOn(node.right, v)) {
        const left = polyOf(node.left, v);
        return left && new Map([...left].map(([p, c]) => [p, div(c, node.right)]));
      }
      if (node.op === '^' && isConstant(node.right)) {
        const n = valueOf(node.right);
        if (!Number.isInteger(n) || n < 0 || n > 12) return null;
        const base = polyOf(node.left, v);
        if (!base) return null;
        let out: Poly = new Map([[0, ONE]]);
        for (let i = 0; i < n; i += 1) out = times(out, base);
        return out;
      }
      return null;
    }
    default:
      return null;
  }
}

const PROBES = [0.37, 1.13, 2.71, -0.83, 0.59];

/**
 * A tree whose value is a plain fraction for every value of its letters, such as cos(t)^2 + sin(t)^2, becomes that
 * fraction. Five sample points must all agree; the rules never need a proof stronger than the numeric check that
 * every answer gets anyway.
 */
export function fold(node: Node): Node {
  const names = [...namesIn(node)];
  const fn = compile(node, names);
  const values = PROBES.map((_, i) => fn(names.map((__, j) => PROBES[(i + j) % PROBES.length] * (j + 1))));
  if (!values.every((one) => Number.isFinite(one) && Math.abs(one - values[0]) <= 1e-12 * Math.max(1, Math.abs(one))))
    return node;
  const fraction = asFraction(values[0], 1000, 1e-11);
  return fraction ? numberNode(fraction[0] / fraction[1]) : node;
}

/** The polynomial written out, highest power first, with each coefficient simplified and zero terms dropped. */
export function polyNode(poly: Poly, v: string): Node {
  const terms: Node[] = [];
  for (const power of [...poly.keys()].sort((a, b) => b - a)) {
    const c = fold(tidy(poly.get(power)!));
    if (isConstant(c) && Math.abs(valueOf(c)) < 1e-14) continue;
    const variable = power === 0 ? null : power === 1 ? name(v) : pow(name(v), num(power));
    terms.push(variable ? (isConstant(c) && valueOf(c) === 1 ? variable : mul(c, variable)) : c);
  }
  return tidy(terms.length ? terms.reduce((a, b) => add(a, b)) : ZERO);
}

/** Collects the tree as a polynomial in `v` when it is one, so a result reads as 2x^3 - x rather than a pile. */
export function collect(node: Node, v: string): Node {
  const poly = polyOf(tidy(node), v);
  return poly ? polyNode(poly, v) : tidy(node);
}

/** `a v + b` with `a` not depending on `v` and not zero, or null. */
function linear(node: Node, v: string): { a: Node; b: Node } | null {
  const poly = polyOf(node, v);
  if (!poly || [...poly.keys()].some((p) => p > 1) || !poly.has(1)) return null;
  const a = tidy(poly.get(1)!);
  if (isConstant(a) && valueOf(a) === 0) return null;
  return { a, b: poly.get(0) ?? ZERO };
}

/** The factors of a product. Dividing by something without `v` and a leading minus count as constant factors. */
function factorsOf(node: Node, v: string): Node[] {
  if (node.type === 'binary' && node.op === '*') return [...factorsOf(node.left, v), ...factorsOf(node.right, v)];
  if (node.type === 'binary' && node.op === '/' && !dependsOn(node.right, v))
    return [...factorsOf(node.left, v), div(ONE, node.right)];
  if (node.type === 'unary' && node.op === '-') return [num(-1), ...factorsOf(node.arg, v)];
  return [node];
}

const productOf = (list: readonly Node[]): Node => (list.length ? list.reduce((a, b) => mul(a, b)) : ONE);

type Kind = 'exp' | 'sin' | 'cos' | 'sinh' | 'cosh';

/** exp, sin, cos, sinh, or cosh of a linear argument, as e^(L) also counts. */
function special(node: Node, v: string): { kind: Kind; arg: Node; a: Node } | null {
  if (node.type === 'call' && ['exp', 'sin', 'cos', 'sinh', 'cosh'].includes(node.name) && node.args.length === 1) {
    const lin = linear(node.args[0], v);
    return lin && { kind: node.name as Kind, arg: node.args[0], a: lin.a };
  }
  if (node.type === 'binary' && node.op === '^' && node.left.type === 'name' && node.left.name === 'e') {
    const lin = linear(node.right, v);
    return lin && { kind: 'exp', arg: node.right, a: lin.a };
  }
  return null;
}

/** The k-th antiderivative of a special function, k from 1. */
function nthIntegral(kind: Kind, arg: Node, a: Node, k: number): Node {
  const scale = pow(a, num(k));
  const cycle: Record<Kind, readonly [string, number][]> = {
    exp: [['exp', 1]],
    sin: [
      ['cos', -1],
      ['sin', -1],
      ['cos', 1],
      ['sin', 1],
    ],
    cos: [
      ['sin', 1],
      ['cos', -1],
      ['sin', -1],
      ['cos', 1],
    ],
    sinh: [
      ['cosh', 1],
      ['sinh', 1],
    ],
    cosh: [
      ['sinh', 1],
      ['cosh', 1],
    ],
  };
  const list = cycle[kind];
  const [fn, sign] = list[(k - 1) % list.length];
  const term = div(call(fn, arg), scale);
  return sign < 0 ? neg(term) : term;
}

/** The antiderivative of one factor that depends on `v`. */
function single(node: Node, v: string): Node | null {
  if (node.type === 'name' && node.name === v) return div(pow(name(v), num(2)), num(2));
  const fn = special(node, v);
  if (fn) return nthIntegral(fn.kind, fn.arg, fn.a, 1);
  if (node.type === 'call' && node.args.length === 1) {
    const lin = linear(node.args[0], v);
    if (!lin) return null;
    const arg = node.args[0];
    if (node.name === 'sqrt') return div(mul(num(2), pow(arg, div(num(3), num(2)))), mul(num(3), lin.a));
    if (node.name === 'tan') return neg(div(call('ln', call('abs', call('cos', arg))), lin.a));
    return null;
  }
  if (node.type === 'binary' && node.op === '^') {
    if (!dependsOn(node.right, v) && isConstant(node.right)) {
      const lin = linear(node.left, v);
      if (!lin) return null;
      const n = valueOf(node.right);
      if (n === -1) return div(call('ln', call('abs', node.left)), lin.a);
      return div(pow(node.left, num(n + 1)), mul(num(n + 1), lin.a));
    }
    if (!dependsOn(node.left, v)) {
      const lin = linear(node.right, v);
      return lin && div(node, mul(call('ln', node.left), lin.a));
    }
    return null;
  }
  if (node.type === 'binary' && node.op === '/' && !dependsOn(node.left, v))
    return reciprocal(node.left, node.right, v);
  return null;
}

/** The antiderivative of c / g(v). */
function reciprocal(c: Node, g: Node, v: string): Node | null {
  const lin = linear(g, v);
  if (lin) return mul(c, div(call('ln', call('abs', g)), lin.a));
  if (g.type === 'binary' && g.op === '^' && isConstant(g.right)) {
    const inner = linear(g.left, v);
    const n = valueOf(g.right);
    if (inner && n !== 1) return mul(c, div(pow(g.left, num(1 - n)), mul(num(1 - n), inner.a)));
  }
  const poly = polyOf(g, v);
  if (poly && [...poly.keys()].every((p) => p === 0 || p === 2) && poly.has(2) && poly.has(0)) {
    const [p2, p0] = [tidy(poly.get(2)!), tidy(poly.get(0)!)];
    if (isConstant(p2) && isConstant(p0) && valueOf(p2) > 0 && valueOf(p0) > 0) {
      const k = Math.sqrt(valueOf(p2) / valueOf(p0));
      return mul(c, div(call('atan', mul(num(k), name(v))), num(Math.sqrt(valueOf(p2) * valueOf(p0)))));
    }
  }
  return null;
}

/** ∫ p(v) g(v) dv by parts, repeated, for a polynomial p and a special g: Σ (-1)^k p^(k) G_(k+1). */
function byParts(p: Node, g: { kind: Kind; arg: Node; a: Node }, v: string): Node | null {
  const poly = polyOf(p, v);
  if (!poly) return null;
  const degree = Math.max(...poly.keys());
  const terms: Node[] = [];
  let derivative = polyNode(poly, v);
  for (let k = 0; k <= degree; k += 1) {
    const term = mul(derivative, nthIntegral(g.kind, g.arg, g.a, k + 1));
    terms.push(k % 2 ? neg(term) : term);
    derivative = derive(derivative, v);
  }
  return terms.reduce((a, b) => add(a, b));
}

/**
 * An antiderivative of the tree with respect to `v`, or null when none of the rules fits. The constant of
 * integration is left out.
 */
export function antiderivative(input: Node, v: string): Node | null {
  const node = fold(tidy(input));
  if (!dependsOn(node, v)) return mul(node, name(v));
  if (node.type === 'unary' && node.op === '-') {
    const inner = antiderivative(node.arg, v);
    return inner && neg(inner);
  }
  if (node.type === 'binary' && (node.op === '+' || node.op === '-')) {
    const left = antiderivative(node.left, v);
    const right = left && antiderivative(node.right, v);
    return left && right ? (node.op === '+' ? add(left, right) : sub(left, right)) : null;
  }
  const poly = polyOf(node, v);
  if (poly) {
    const out: Poly = new Map();
    for (const [p, c] of poly) out.set(p + 1, div(c, num(p + 1)));
    return polyNode(out, v);
  }
  if (node.type === 'binary' && node.op === '/' && !dependsOn(node.right, v)) {
    const inner = antiderivative(node.left, v);
    return inner && div(inner, node.right);
  }
  const factors = factorsOf(node, v);
  const constants = factors.filter((one) => !dependsOn(one, v));
  const varying = factors.filter((one) => dependsOn(one, v));
  if (varying.length === 1) {
    const inner = single(varying[0], v);
    return inner && (constants.length ? mul(productOf(constants), inner) : inner);
  }
  const specials = varying.map((one) => special(one, v));
  const at = specials.findIndex((one) => one !== null);
  if (at >= 0 && specials.filter((one) => one !== null).length === 1) {
    const rest = varying.filter((_, i) => i !== at);
    const parts = byParts(productOf(rest), specials[at]!, v);
    return parts && (constants.length ? mul(productOf(constants), parts) : parts);
  }
  return null;
}

/** F(hi) - F(lo). */
export function definite(F: Node, v: string, lo: Node, hi: Node): Node {
  return sub(substitute(F, v, hi), substitute(F, v, lo));
}

// Tanh-sinh quadrature. The abscissas crowd toward the ends, where they are written as a distance from the end so
// that an endpoint singularity such as 1/sqrt(1 - x) is never evaluated at the end itself.
type Rule = readonly { far: number; weight: number }[];

function makeRule(h: number, levels: number): Rule {
  const out: { far: number; weight: number }[] = [];
  for (let k = -levels; k <= levels; k += 1) {
    const t = k * h;
    const u = (Math.PI / 2) * Math.sinh(t);
    const weight = (h * (Math.PI / 2) * Math.cosh(t)) / Math.cosh(u) ** 2;
    // The distance from the nearer end, in units of the half-width: 1 - |tanh u|.
    const far = 2 / (1 + Math.exp(2 * Math.abs(u)));
    if (weight > 1e-300) out.push({ far: k < 0 ? -far : far, weight });
  }
  return out;
}

/** 129 points for one integral; 57 for each level of a double or triple integral, which is still near 1e-12. */
const FINE = makeRule(1 / 16, 64);
const COARSE = makeRule(1 / 8, 28);

/** ∫ f from a to b. Points where f is not finite count as zero, so a log at an end does not spoil the sum. */
export function quadrature(f: (x: number) => number, a: number, b: number, coarse = false): number {
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const half = (b - a) / 2;
  let sum = 0;
  for (const { far, weight } of coarse ? COARSE : FINE) {
    const x = far > 0 ? b - half * far : a - half * far;
    const value = f(x);
    if (Number.isFinite(value)) sum += weight * value;
  }
  return sum * half;
}

/** ∫ f from a to infinity, by t = a + s/(1 - s) over [0, 1). */
export function quadratureToInfinity(f: (t: number) => number, a = 0): number {
  return quadrature((s) => (s >= 1 ? 0 : f(a + s / (1 - s)) / (1 - s) ** 2), 0, 1);
}
