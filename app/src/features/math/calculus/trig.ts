// Trig integrals by identity. An odd power of sine or cosine becomes a substitution after sin^2 + cos^2 = 1, and
// even powers are halved with the power-reduction formulas. Powers of tangent and secant (and of cotangent and
// cosecant) use the same two ideas. Sines and cosines of different insides multiply out by product-to-sum.
import { build } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { isRational, norm, tidy } from './algebra';
import type { Factor } from './algebra';
import { linearSlope } from './integrate';
import type { Integrated, Integrator, Method } from './integrate';
import { freshLetter, substituted } from './methods';
import { latexOf } from './print';
import type { Step, StepRule } from './types';

const { num, name, call, add, sub, mul, div, pow, neg } = build;
const FAMILY = new Set(['sin', 'cos', 'tan', 'sec', 'cot', 'csc']);

interface Powers {
  inside: Node;
  /** The whole-number power of each function, 0 when it is not there. */
  of: Record<string, number>;
}

/** The trig functions of g, when all are of one linear inside with whole-number powers. */
function powersOf(g: Node, I: Integrator): Powers | null {
  const [term] = norm(g);
  if (!term) return null;
  let inside: Node | null = null;
  const of: Record<string, number> = { sin: 0, cos: 0, tan: 0, sec: 0, cot: 0, csc: 0 };
  for (const f of term.factors) {
    const { base, exp } = f;
    if (base.type !== 'call' || !FAMILY.has(base.name) || !isRational(exp) || exp.d !== 1n) return null;
    if (inside && latexOf(inside) !== latexOf(base.args[0])) return null;
    inside = base.args[0];
    of[base.name] += Number(exp.n);
  }
  return inside && linearSlope(inside, I.x) ? { inside, of } : null;
}

const only = (p: Powers, ...names: string[]) => Object.entries(p.of).every(([k, v]) => v === 0 || names.includes(k));

function rewritten(I: Integrator, g: Node, rule: StepRule, next: Node, note?: string): Integrated | null {
  const found = I.child().integrate(next);
  if (!found) return null;
  const rewrite: Step = { rule, latex: `${latexOf(g)} = ${latexOf(next)}`, ...(note ? { note } : {}) };
  return { node: found.node, step: I.step(rule, g, found.node, [rewrite, found.step]) };
}

/** Substitutes w = fn(inside) with dw = d(fn) dx, for an integrand already written in w. */
function viaSubstitution(I: Integrator, g: Node, p: Powers, fn: string, inW: (w: Node) => Node): Integrated | null {
  const w = freshLetter(g, I.x);
  const u = call(fn, p.inside);
  const a = linearSlope(p.inside, I.x) as Node;
  const derivative: Record<string, Node> = {
    sin: call('cos', p.inside),
    cos: neg(call('sin', p.inside)),
    tan: pow(call('sec', p.inside), num(2)),
    sec: mul(call('sec', p.inside), call('tan', p.inside)),
    cot: neg(pow(call('csc', p.inside), num(2))),
    csc: neg(mul(call('csc', p.inside), call('cot', p.inside))),
  };
  const du = tidy(mul(a, derivative[fn]));
  const sign = fn === 'cos' || fn === 'cot' || fn === 'csc' ? -1 : 1;
  const integrand = tidy(div(mul(num(sign), inW(name(w))), a));
  const found = substituted(I, g, u, du, w, integrand);
  if (!found) return null;
  const identity: Step = {
    rule: 'pythagorean',
    latex: `${latexOf(g)} = ${latexOf(tidy(substituteBack(integrand, w, u, du)))}`,
  };
  return { node: found.node, step: { ...found.step, children: [identity, ...(found.step.children ?? [])] } };
}

/** The integrand written back in x, for the identity step: the w-integrand times dw/dx. */
const substituteBack = (inW: Node, w: string, u: Node, du: Node): Node => mul(replaceName(inW, w, u), du);

function replaceName(node: Node, w: string, u: Node): Node {
  switch (node.type) {
    case 'name':
      return node.name === w ? u : node;
    case 'unary':
      return { ...node, arg: replaceName(node.arg, w, u) };
    case 'binary':
      return { ...node, left: replaceName(node.left, w, u), right: replaceName(node.right, w, u) };
    case 'call':
      return { ...node, args: node.args.map((arg) => replaceName(arg, w, u)) };
    default:
      return node;
  }
}

const oneMinusSquare = (w: Node) => sub(num(1), pow(w, num(2)));
const squareMinusOne = (w: Node) => sub(pow(w, num(2)), num(1));
const onePlusSquare = (w: Node) => add(num(1), pow(w, num(2)));

function sineCosine(g: Node, p: Powers, I: Integrator): Integrated | null {
  const { sin: m, cos: n } = p.of;
  if (m > 0 && m % 2 === 1) {
    return viaSubstitution(I, g, p, 'cos', (w) => mul(pow(oneMinusSquare(w), num((m - 1) / 2)), pow(w, num(n))));
  }
  if (n > 0 && n % 2 === 1) {
    return viaSubstitution(I, g, p, 'sin', (w) => mul(pow(oneMinusSquare(w), num((n - 1) / 2)), pow(w, num(m))));
  }
  if (m >= 0 && n >= 0 && m + n >= 2 && m % 2 === 0 && n % 2 === 0) {
    const double = mul(num(2), p.inside);
    const sinSquared = div(sub(num(1), call('cos', double)), num(2));
    const cosSquared = div(add(num(1), call('cos', double)), num(2));
    const next = mul(pow(sinSquared, num(m / 2)), pow(cosSquared, num(n / 2)));
    return rewritten(I, g, 'powerReduction', next);
  }
  return null;
}

function tangentSecant(g: Node, p: Powers, I: Integrator, [t, s]: [string, string]): Integrated | null {
  const [m, n] = [p.of[t], p.of[s]];
  if (n >= 2 && n % 2 === 0 && m >= 0) {
    return viaSubstitution(I, g, p, t, (w) => mul(pow(w, num(m)), pow(onePlusSquare(w), num((n - 2) / 2))));
  }
  if (m >= 1 && m % 2 === 1 && n >= 1) {
    return viaSubstitution(I, g, p, s, (w) => mul(pow(squareMinusOne(w), num((m - 1) / 2)), pow(w, num(n - 1))));
  }
  if (n === 0 && m >= 2) {
    const next = mul(pow(call(t, p.inside), num(m - 2)), sub(pow(call(s, p.inside), num(2)), num(1)));
    return rewritten(I, g, 'trigIdentity', next);
  }
  return null;
}

/** sin(a x) cos(b x) and the like, as half a sum of sines or cosines. */
function productToSum(g: Node, factors: Factor[], I: Integrator): Integrated | null {
  if (factors.length !== 2 || !factors.every((f) => isRational(f.exp) && f.exp.n === 1n && f.exp.d === 1n)) return null;
  const [f1, f2] = [...factors].sort((a, b) =>
    (a.base as { name: string }).name === 'sin' ? -1 : b.key < a.key ? 1 : 0,
  );
  if (f1.base.type !== 'call' || f2.base.type !== 'call') return null;
  const [A, B] = [f1.base.args[0], f2.base.args[0]];
  if (!A || !B || !linearSlope(A, I.x) || !linearSlope(B, I.x)) return null;
  const kinds = `${f1.base.name}*${f2.base.name}`;
  const [plus, minus] = [add(A, B), sub(A, B)];
  const halves: Record<string, Node> = {
    'sin*cos': add(call('sin', plus), call('sin', minus)),
    'sin*sin': sub(call('cos', minus), call('cos', plus)),
    'cos*cos': add(call('cos', minus), call('cos', plus)),
  };
  const sum = halves[kinds];
  return sum ? rewritten(I, g, 'productToSum', div(sum, num(2))) : null;
}

/** Trig identities for the integrand, when one applies. */
export const trigIdentities: Method = (g, I) => {
  const p = powersOf(g, I);
  if (!p) {
    const [term] = norm(g);
    return term ? productToSum(g, term.factors, I) : null;
  }
  if (only(p, 'sin', 'cos')) return sineCosine(g, p, I);
  if (only(p, 'tan', 'sec')) return tangentSecant(g, p, I, ['tan', 'sec']);
  if (only(p, 'cot', 'csc')) return tangentSecant(g, p, I, ['cot', 'csc']);
  return null;
};
