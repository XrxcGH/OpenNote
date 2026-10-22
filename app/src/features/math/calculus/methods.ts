// The integrator's methods beyond the table: multiplying out, substitution, and integration by parts (with the
// "comes back" case of e^x sin x solved for the integral). Each returns an antiderivative with its steps, or null
// when it does not apply; the integrator checks every answer by its slope before using it.
import { build, differentiate, formatExpression, freeNames } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { expand, isRational, norm, simplest, substitute, tidy, toNode } from './algebra';
import type { Factor } from './algebra';
import { factorsNode, intLatex, linearSlope } from './integrate';
import type { Integrated, Integrator, Method } from './integrate';
import { polynomial } from './partial';
import { latexOf } from './print';
import type { Step } from './types';

const { num, name, call, add, sub, mul, div, pow } = build;

/** A letter for the new variable that the expression does not already use. */
export function freshLetter(g: Node, x: string): string {
  const used = new Set([...freeNames(g), x]);
  return ['u', 'w', 't', 'v', 's'].find((letter) => !used.has(letter)) ?? 'u';
}

/** Polynomial products and powers multiplied out: x (x + 1)^2 is x^3 + 2x^2 + x. */
export const expandPolynomial: Method = (g, I) => {
  if (!polynomial(g, I.x)) return null;
  return multiplyOut(g, I);
};

/** Any product over a sum spread out, as a last resort: (x + 1) e^x is x e^x + e^x. */
export const distribute: Method = (g, I) => multiplyOut(g, I);

function multiplyOut(g: Node, I: Integrator): Integrated | null {
  const spread = expand(norm(g));
  if (spread.length < 2) return null;
  const node = toNode(spread);
  const found = I.child().sum(
    node,
    spread.map((term) => toNode([term])),
  );
  if (!found) return null;
  const rewrite: Step = { rule: 'expand', latex: `${latexOf(g)} = ${latexOf(node)}` };
  return { node: found.node, step: I.step('expand', g, found.node, [rewrite, found.step]) };
}

/** The parts of g worth trying as u: insides of functions, bases and exponents of powers, and the functions. */
function candidates(g: Node, I: Integrator): Node[] {
  const found = new Map<string, Node>();
  const keep = (node: Node) => {
    if (!I.has(node) || (node.type === 'name' && node.name === I.x)) return;
    const tidied = tidy(node);
    if (formatExpression(tidied) !== formatExpression(g)) found.set(formatExpression(tidied), tidied);
  };
  const walk = (node: Node) => {
    if (node.type === 'call') {
      node.args.forEach(keep);
      if (node.name !== 'abs') keep(node);
      node.args.forEach(walk);
    } else if (node.type === 'binary') {
      if (node.op === '^') [node.left, node.right].forEach(keep);
      if (node.op === '/') keep(node.right);
      [node.left, node.right].forEach(walk);
    } else if (node.type === 'unary') walk(node.arg);
  };
  walk(g);
  return [...found.values()].sort((a, b) => formatExpression(b).length - formatExpression(a).length).slice(0, 10);
}

function replaceAll(node: Node, key: string, w: string): Node {
  if (formatExpression(node) === key) return name(w);
  switch (node.type) {
    case 'unary':
      return { ...node, arg: replaceAll(node.arg, key, w) };
    case 'binary':
      return { ...node, left: replaceAll(node.left, key, w), right: replaceAll(node.right, key, w) };
    case 'call':
      return { ...node, args: node.args.map((arg) => replaceAll(arg, key, w)) };
    default:
      return node;
  }
}

/** g in terms of u alone, after dividing by du/dx, or null when x is left over. */
function inTermsOf(g: Node, u: Node, du: Node, w: string, I: Integrator): Node | null {
  const q = tidy(div(g, du));
  let inW = tidy(replaceAll(q, formatExpression(u), w));
  if (!I.has(inW)) return inW;
  // For a linear u = ax + b, any x left over is (u - b) / a.
  const a = linearSlope(u, I.x);
  if (!a) return null;
  const b = tidy(sub(u, mul(a, name(I.x))));
  inW = tidy(substitute(inW, I.x, div(sub(name(w), b), a)));
  return I.has(inW) ? null : inW;
}

/** The steps of a substitution: rewrite in u, integrate, and put x back. */
export function substituted(I: Integrator, g: Node, u: Node, du: Node, w: string, inW: Node): Integrated | null {
  const inner = I.child({ substitution: false }, w).integrate(inW);
  if (!inner) return null;
  const F = tidy(substitute(inner.node, w, u));
  const note = `${w} = ${latexOf(u)},\\ d${w} = ${latexOf(du)}\\,d${I.x}`;
  const rewrite: Step = { rule: 'substitution', latex: `${intLatex(g, I.x)} = ${intLatex(inW, w)}` };
  const back: Step = {
    rule: 'backSubstitute',
    latex: `${latexOf(inner.node)} = ${latexOf(F)}`,
    note: `${w} = ${latexOf(u)}`,
  };
  return { node: F, step: I.step('substitution', g, F, [rewrite, inner.step, back], note) };
}

/** u-substitution: a part of the integrand whose derivative is also there, up to a constant. */
export const substitution: Method = (g, I) => {
  if (!I.options.substitution) return null;
  const w = freshLetter(g, I.x);
  for (const u of candidates(g, I)) {
    let du: Node;
    try {
      du = simplest(differentiate(u, I.x));
    } catch {
      continue;
    }
    if (du.type === 'num' && du.value === 0) continue;
    const inW = inTermsOf(g, u, du, w, I);
    const found = inW && substituted(I, g, u, du, w, inW);
    if (found) return found;
  }
  return null;
};

const LOGS = new Set(['ln', 'log']);
const INVERSE = new Set(['asin', 'acos', 'atan']);
const TRIG = new Set(['sin', 'cos', 'sinh', 'cosh']);

/** LIATE: logs, inverse trig, algebraic, trig, exponential. The highest is u. 0 when parts does not apply. */
function rank(f: Factor, I: Integrator): number {
  const { base, exp } = f;
  const wholePower = isRational(exp) && exp.d === 1n && exp.n > 0n;
  if (base.type === 'call' && wholePower && LOGS.has(base.name)) return 5;
  if (base.type === 'call' && wholePower && exp.n === 1n && INVERSE.has(base.name)) return 4;
  if (wholePower && (base.type === 'name' || polynomial(base, I.x))) return 3;
  if (base.type === 'call' && wholePower && exp.n === 1n && TRIG.has(base.name)) return 2;
  if (!isRational(exp) && !I.has(base) && linearSlope(exp, I.x)) return 1;
  return 0;
}

/** e^(a x) sin(b x) and e^(a x) cos(b x): parts twice brings the integral back, so it is solved for. */
function cyclic(g: Node, factors: Factor[], I: Integrator): Integrated | null {
  const e = factors.find((f) => !isRational(f.exp));
  const t = factors.find((f) => f.base.type === 'call' && (f.base.name === 'sin' || f.base.name === 'cos'));
  if (!e || !t || t.base.type !== 'call' || !(e.base.type === 'name' && e.base.name === 'e')) return null;
  const [inside] = t.base.args;
  const a = linearSlope(e.exp as Node, I.x);
  const b = linearSlope(inside, I.x);
  if (!a || !b) return null;
  const [s, c] = [call('sin', inside), call('cos', inside)];
  const mix = t.base.name === 'sin' ? sub(mul(a, s), mul(b, c)) : add(mul(a, c), mul(b, s));
  const F = tidy(div(mul(pow(e.base, e.exp as Node), mix), add(pow(a, num(2)), pow(b, num(2)))));
  return { node: F, step: I.step('partsCyclic', g, F) };
}

/** Integration by parts: the integral of u dv is u v minus the integral of v du. */
export const byParts: Method = (g, I) => {
  if (I.options.parts <= 0) return null;
  const [term] = norm(g);
  const ranked = term.factors.map((f) => ({ f, r: rank(f, I) }));
  if (ranked.some((item) => item.r === 0)) return null;
  if (ranked.length === 2 && ranked.some((i) => i.r === 1) && ranked.some((i) => i.r === 2)) {
    return cyclic(g, term.factors, I);
  }
  const best = ranked.reduce((top, item) => (item.r > top.r ? item : top));
  if (ranked.length === 1 && best.r < 4) return null;
  const u = factorsNode([best.f]);
  const dv = ranked.length === 1 ? num(1) : factorsNode(term.factors.filter((f) => f !== best.f));
  const v = I.child({ parts: 0 }).integrate(dv);
  if (!v) return null;
  let du: Node;
  try {
    du = simplest(differentiate(u, I.x));
  } catch {
    return null;
  }
  const remaining = tidy(mul(v.node, du));
  const rest = I.child({ parts: I.options.parts - 1 }).integrate(remaining);
  if (!rest) return null;
  const uv = tidy(mul(u, v.node));
  const F = tidy(sub(uv, rest.node));
  const dx = `\\,d${I.x}`;
  const note = `u = ${latexOf(u)},\\ dv = ${latexOf(dv)}${dx},\\ du = ${latexOf(du)}${dx},\\ v = ${latexOf(v.node)}`;
  const formula: Step = { rule: 'parts', latex: `${intLatex(g, I.x)} = ${latexOf(uv)} - ${intLatex(remaining, I.x)}` };
  return { node: F, step: I.step('parts', g, F, [v.step, formula, rest.step], note) };
};
