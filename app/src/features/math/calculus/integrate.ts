// Step-by-step integrals. The integrator splits sums, takes out constants, and then tries its methods in order: the
// table of basic integrals (with a linear inside such as 3x + 1), polynomials multiplied out, partial fractions for a
// ratio of polynomials, trig identities, substitution, and integration by parts. Every antiderivative a method finds
// is checked by its slope at several points before it is used, so an answer is never a guess. When no method works,
// it says so; it never makes one up.
import { build, dependsOn, differentiate, freeNames } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { expNode, isRational, norm, tidy, toNode, ONE } from './algebra';
import type { Factor } from './algebra';
import { slopeMatches } from './numeric';
import { latexOf } from './print';
import type { Step, StepRule } from './types';

export interface Integrated {
  node: Node;
  step: Step;
}

export interface IntegratorOptions {
  /** How many times integration by parts may still be used, one inside another. */
  parts: number;
  substitution: boolean;
}

export type Method = (g: Node, integrator: Integrator) => Integrated | null;

const { num, name, call, add, mul, div, pow, neg } = build;
const MAX_DEPTH = 12;

export const intLatex = (f: Node, x: string): string => {
  const body = latexOf(f);
  return norm(f).length > 1 ? `\\int \\left(${body}\\right)\\,d${x}` : `\\int ${body}\\,d${x}`;
};
export const factorsNode = (factors: Factor[]): Node => toNode([{ coef: ONE, factors }]);
const lnAbs = (u: Node) => call('ln', call('abs', u));

/** The slope of an expression that is linear in x, such as 3 for 3x + 1, or null when it is not linear. */
export function linearSlope(u: Node, x: string): Node | null {
  if (!dependsOn(u, x)) return null;
  try {
    const slope = tidy(differentiate(u, x));
    return dependsOn(slope, x) || (slope.type === 'num' && slope.value === 0) ? null : slope;
  } catch {
    return null;
  }
}

const over = (node: Node, a: Node) => (a.type === 'num' && a.value === 1 ? node : div(node, a));

/** Antiderivatives of f(u)^n for a trig or hyperbolic f, by "name^power". */
const TABLE: Readonly<Record<string, [StepRule, (u: Node) => Node]>> = {
  'sin^1': ['trig', (u) => neg(call('cos', u))],
  'cos^1': ['trig', (u) => call('sin', u)],
  'tan^1': ['trig', (u) => neg(lnAbs(call('cos', u)))],
  'cot^1': ['trig', (u) => lnAbs(call('sin', u))],
  'sec^1': ['trig', (u) => lnAbs(add(call('sec', u), call('tan', u)))],
  'csc^1': ['trig', (u) => neg(lnAbs(add(call('csc', u), call('cot', u))))],
  'cos^-1': ['trig', (u) => lnAbs(add(call('sec', u), call('tan', u)))],
  'sin^-1': ['trig', (u) => neg(lnAbs(add(call('csc', u), call('cot', u))))],
  'sec^2': ['trig', (u) => call('tan', u)],
  'cos^-2': ['trig', (u) => call('tan', u)],
  'csc^2': ['trig', (u) => neg(call('cot', u))],
  'sin^-2': ['trig', (u) => neg(call('cot', u))],
  'sec^3': [
    'parts',
    (u) => div(add(mul(call('sec', u), call('tan', u)), lnAbs(add(call('sec', u), call('tan', u)))), num(2)),
  ],
  'sinh^1': ['hyperbolic', (u) => call('cosh', u)],
  'cosh^1': ['hyperbolic', (u) => call('sinh', u)],
  'tanh^1': ['hyperbolic', (u) => call('ln', call('cosh', u))],
};

/** Antiderivatives of a product of two trig functions of the same inside. */
const PAIRS: Readonly<Record<string, (u: Node) => Node>> = {
  'sec^1*tan^1': (u) => call('sec', u),
  'cot^1*csc^1': (u) => neg(call('csc', u)),
  'cos^-2*sin^1': (u) => call('sec', u),
  'cos^1*sin^-2': (u) => neg(call('csc', u)),
  'sec^2*tan^1': (u) => div(pow(call('tan', u), num(2)), num(2)),
};

const powerKey = (f: Factor) =>
  isRational(f.exp) && f.exp.d === 1n ? `${(f.base as { name: string }).name}^${f.exp.n}` : '';

export class Integrator {
  constructor(
    readonly x: string,
    readonly methods: readonly Method[],
    readonly options: IntegratorOptions = { parts: 2, substitution: true },
    private readonly depth = 0,
  ) {}

  has = (node: Node): boolean => dependsOn(node, this.x);

  step(rule: StepRule, f: Node, F: Node, children: Step[] = [], note?: string): Step {
    const found = children.filter(Boolean);
    return {
      rule,
      latex: `${intLatex(f, this.x)} = ${latexOf(F)}`,
      ...(note ? { note } : {}),
      ...(found.length ? { children: found } : {}),
    };
  }

  /** An integrator one level in, with some methods turned off, or for another variable. */
  child(options: Partial<IntegratorOptions> = {}, x = this.x): Integrator {
    return new Integrator(x, this.methods, { ...this.options, ...options }, this.depth + 1);
  }

  integrate(raw: Node): Integrated | null {
    if (this.depth > MAX_DEPTH) return null;
    const f = tidy(raw);
    if (!this.has(f)) {
      const F = tidy(mul(f, name(this.x)));
      return { node: F, step: this.step('constant', f, F) };
    }
    const form = norm(f);
    if (form.length > 1)
      return this.sum(
        f,
        form.map((term) => toNode([term])),
      );
    const [term] = form;
    const moving = term.factors.filter((fa) => this.has(fa.base) || (!isRational(fa.exp) && this.has(fa.exp)));
    const unit = term.coef.n === 1n && term.coef.d === 1n;
    if (unit && moving.length === term.factors.length) return this.single(f);
    const g = factorsNode(moving);
    const inner = this.single(g);
    if (!inner) return null;
    const c = tidy(div(f, g));
    const F = tidy(mul(c, inner.node));
    return { node: F, step: this.step('constantMultiple', f, F, [inner.step], `c = ${latexOf(c)}`) };
  }

  sum(f: Node, terms: Node[]): Integrated | null {
    const parts: Integrated[] = [];
    for (const term of terms) {
      const found = this.integrate(term);
      if (!found) return null;
      parts.push(found);
    }
    const F = tidy(parts.map((p) => p.node).reduce((a, b) => add(a, b)));
    return {
      node: F,
      step: this.step(
        'sum',
        f,
        F,
        parts.map((p) => p.step),
      ),
    };
  }

  /** A product of factors that all depend on x, with no constant in front. */
  private single(g: Node): Integrated | null {
    const names = freeNames(g);
    for (const method of [table, ...this.methods]) {
      const found = method(g, this);
      if (found && slopeMatches(found.node, g, this.x, names)) return found;
    }
    return null;
  }
}

function powerRule(g: Node, base: Node, exp: Node, I: Integrator): Integrated | null {
  const a = linearSlope(base, I.x);
  if (!a) return null;
  const plain = base.type === 'name';
  const n = tidy(exp);
  if (n.type === 'unary' && n.arg.type === 'num' && n.arg.value === 1) {
    const F = tidy(over(lnAbs(base), a));
    return { node: F, step: I.step(plain ? 'reciprocal' : 'linear', g, F) };
  }
  const raised = tidy(add(n, num(1)));
  const F = tidy(div(pow(base, raised), mul(raised, a)));
  return { node: F, step: I.step(plain ? 'power' : 'linear', g, F, [], plain ? undefined : `u = ${latexOf(base)}`) };
}

/** 1/(p x^2 + q) and 1/sqrt(q - p x^2), with numbers p and q: arctangents, arcsines, and their log cousin. */
function quadraticRule(g: Node, base: Node, exp: Node, I: Integrator): Integrated | null {
  const x = name(I.x);
  const form = norm(base);
  if (form.length !== 2) return null;
  const square = form.find((t) => t.factors.length === 1 && t.factors[0].base.type === 'name');
  const constant = form.find((t) => t.factors.length === 0);
  const two =
    square && isRational(square.factors[0].exp) && square.factors[0].exp.n === 2n && square.factors[0].exp.d === 1n;
  if (!square || !constant || !two || (square.factors[0].base as { name: string }).name !== I.x) return null;
  const [p, q] = [toNode([{ coef: square.coef, factors: [] }]), toNode([constant])];
  const [pv, qv] = [Number(square.coef.n) / Number(square.coef.d), Number(constant.coef.n) / Number(constant.coef.d)];
  const e = tidy(exp);
  const root = (node: Node) => pow(node, div(num(1), num(2)));
  let F: Node | null = null;
  if (e.type === 'unary' && e.arg.type === 'num' && e.arg.value === 1 && pv * qv > 0) {
    F = div(call('atan', mul(x, root(div(p, q)))), mul(root(mul(p, q)), num(Math.sign(pv))));
  } else if (e.type === 'unary' && e.arg.type === 'binary' && formatHalf(e.arg)) {
    if (qv > 0 && pv < 0) F = div(call('asin', mul(x, root(div(neg(p), q)))), root(neg(p)));
    else if (pv > 0) F = div(lnAbs(add(mul(root(p), x), root(base))), root(p));
  }
  if (!F) return null;
  const node = tidy(F);
  return { node, step: I.step('inverseTrig', g, node) };
}

const formatHalf = (node: Node) =>
  node.type === 'binary' &&
  node.op === '/' &&
  node.left.type === 'num' &&
  node.left.value === 1 &&
  node.right.type === 'num' &&
  node.right.value === 2;

function callRule(g: Node, base: Node & { type: 'call' }, f: Factor, I: Integrator): Integrated | null {
  const [u] = base.args;
  const a = base.args.length === 1 ? linearSlope(u, I.x) : null;
  const entry = a ? TABLE[powerKey(f)] : undefined;
  if (!a || !entry) return null;
  const F = tidy(over(entry[1](u), a));
  const plain = u.type === 'name';
  return { node: F, step: I.step(entry[0], g, F, [], plain ? undefined : `u = ${latexOf(u)}`) };
}

function exponentialRule(g: Node, base: Node, exp: Node, I: Integrator): Integrated | null {
  const a = linearSlope(exp, I.x);
  if (!a || I.has(base)) return null;
  const isE = base.type === 'name' && base.name === 'e';
  const F = tidy(over(pow(base, exp), isE ? a : mul(a, call('ln', base))));
  return { node: F, step: I.step('exponential', g, F) };
}

function pairRule(g: Node, factors: Factor[], I: Integrator): Integrated | null {
  const [f1, f2] = factors;
  if (f1.base.type !== 'call' || f2.base.type !== 'call' || f1.base.args.length !== 1) return null;
  const [u] = f1.base.args;
  if (f2.base.args.length !== 1 || latexOf(f2.base.args[0]) !== latexOf(u)) return null;
  const a = linearSlope(u, I.x);
  const make = PAIRS[[powerKey(f1), powerKey(f2)].sort().join('*')];
  if (!a || !make) return null;
  const F = tidy(over(make(u), a));
  return { node: F, step: I.step('trig', g, F) };
}

/** The table of basic integrals. */
export const table: Method = (g, I) => {
  const [term] = norm(g);
  if (!term) return null;
  if (term.factors.length === 2) return pairRule(g, term.factors, I);
  if (term.factors.length !== 1) return null;
  const [f] = term.factors;
  const exp = expNode(f.exp);
  if (!isRational(f.exp)) return exponentialRule(g, f.base, exp, I);
  if (f.base.type === 'call') return callRule(g, f.base, f, I);
  return powerRule(g, f.base, exp, I) ?? quadraticRule(g, f.base, exp, I);
};
