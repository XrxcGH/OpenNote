// Step-by-step derivatives. Each step names the rule it uses and shows the derivative of that part. The rules are
// sum, constant multiple, product, quotient, power, and chain, with the derivatives of trig, inverse trig,
// exponential, and log functions. The parts a step needs are steps inside it, so a long derivative folds into a few
// lines. The derivatives come from the shared engine (core/expr/derive.ts), tidied by the normal form (algebra.ts).
import { build, dependsOn, differentiate } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { expNode, isRational, norm, simplest, tidy, toNode } from './algebra';
import type { Factor, Form, Term } from './algebra';
import { latexOf } from './print';
import type { Step, StepRule } from './types';

/** At most this many steps in one explanation, so a large expression stays readable. */
const MAX_STEPS = 40;
const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
const INVERSE = new Set(['asin', 'acos', 'atan']);
const HYPERBOLIC = new Set(['sinh', 'cosh', 'tanh']);
const LOGS = new Set(['ln', 'log', 'log2', 'log10']);

export const dOf = (x: string, order = 1) =>
  order === 1 ? `\\frac{d}{d${x}}` : `\\frac{d^{${order}}}{d${x}^{${order}}}`;
export const bracket = (latex: string) => `\\left[${latex}\\right]`;

const termForm = (term: Term): Form => [term];
const factorsNode = (factors: Factor[]): Node => toNode([{ coef: { n: 1n, d: 1n }, factors }]);

/** The derivative of a tree, tidied and in its shortest form. */
export function derivativeOf(node: Node, x: string, order = 1): Node {
  return simplest(differentiate(tidy(node), x, order));
}

class Explainer {
  private count = 0;
  constructor(private readonly x: string) {}

  private has = (node: Node) => dependsOn(node, this.x);

  private step(rule: StepRule, node: Node, children: Step[] = [], note?: string): Step {
    this.count += 1;
    const latex = `${dOf(this.x)}${bracket(latexOf(node))} = ${latexOf(derivativeOf(node, this.x))}`;
    const found = children.filter(Boolean);
    return { rule, latex, ...(note ? { note } : {}), ...(found.length ? { children: found } : {}) };
  }

  /** Steps inside a step, unless the explanation is already long. */
  private inner(node: Node): Step[] {
    return this.count >= MAX_STEPS || !this.has(node) ? [] : [this.explain(node)];
  }

  explain(raw: Node): Step {
    const node = tidy(raw);
    if (!this.has(node)) return this.step('constant', node);
    const form = norm(node);
    if (form.length > 1) {
      return this.step(
        'sum',
        node,
        form.flatMap((term) => this.inner(toNode(termForm(term)))),
      );
    }
    const [term] = form;
    const moving = term.factors.filter((f) => this.has(f.base) || (!isRational(f.exp) && this.has(f.exp)));
    const isUnit = term.coef.n === 1n && term.coef.d === 1n;
    if (!isUnit || moving.length < term.factors.length) {
      return this.step('constantMultiple', node, this.inner(factorsNode(moving)));
    }
    if (moving.length > 1) return this.productOrQuotient(node, moving);
    return this.factor(node, moving[0]);
  }

  private productOrQuotient(node: Node, factors: Factor[]): Step {
    const below = (f: Factor) => isRational(f.exp) && f.exp.n < 0n;
    const top = factors.filter((f) => !below(f));
    const bottom = factors.filter(below);
    if (top.length > 0 && bottom.length > 0) {
      const v = toNode(norm(build.div(build.num(1), factorsNode(bottom))));
      const u = factorsNode(top);
      const note = `u = ${latexOf(u)},\\ v = ${latexOf(v)}`;
      return this.step('quotient', node, [...this.inner(u), ...this.inner(v)], note);
    }
    const [first, ...rest] = factors;
    const u = factorsNode([first]);
    const v = factorsNode(rest);
    return this.step('product', node, [...this.inner(u), ...this.inner(v)], `u = ${latexOf(u)},\\ v = ${latexOf(v)}`);
  }

  /** The outside function's derivative, in terms of u, for the chain rule. */
  private outer(rule: StepRule, inU: Node): Step {
    this.count += 1;
    const u = this.u;
    const d = `\\frac{d}{d${u}}`;
    return { rule, latex: `${d}${bracket(latexOf(inU))} = ${latexOf(derivativeOf(inU, u))}` };
  }

  private get u(): string {
    return this.x === 'u' ? 'w' : 'u';
  }

  private chain(node: Node, inside: Node, outer: Step): Step {
    return this.step('chain', node, [outer, ...this.inner(inside)], `${this.u} = ${latexOf(inside)}`);
  }

  private factor(node: Node, f: Factor): Step {
    const { base, exp } = f;
    const u = build.name(this.u);
    if (isRational(exp)) {
      const one = exp.n === 1n && exp.d === 1n;
      const half = exp.n === 1n && exp.d === 2n;
      if (base.type === 'name') return this.step(one ? 'variable' : half ? 'root' : 'power', node);
      if (base.type === 'call' && one) return this.call(node, base);
      return this.chain(node, base, this.outer(half ? 'root' : 'power', build.pow(u, expNode(exp))));
    }
    if (!this.has(base)) {
      if (exp.type === 'name' && exp.name === this.x) return this.step('exponential', node);
      return this.chain(node, exp, this.outer('exponential', build.pow(base, u)));
    }
    return this.step('generalPower', node, [...this.inner(base), ...this.inner(exp)]);
  }

  private call(node: Node, base: Node & { type: 'call' }): Step {
    const [arg] = base.args;
    const rule: StepRule = TRIG.has(base.name)
      ? 'trig'
      : INVERSE.has(base.name)
        ? 'inverseTrig'
        : HYPERBOLIC.has(base.name)
          ? 'hyperbolic'
          : LOGS.has(base.name)
            ? 'logarithm'
            : 'function';
    if (!arg || (arg.type === 'name' && arg.name === this.x) || base.args.length > 1) return this.step(rule, node);
    return this.chain(node, arg, this.outer(rule, build.call(base.name, build.name(this.u))));
  }
}

/** Steps for d/dx (or a higher order) of a tree. The last step is the answer, tidied. */
export function derivativeSteps(node: Node, x: string, order = 1): { steps: Step[]; result: Node } {
  const steps: Step[] = [];
  let current = tidy(node);
  for (let i = 1; i <= order; i += 1) {
    const explained = new Explainer(x).explain(current);
    current = derivativeOf(current, x);
    if (order === 1) steps.push(explained);
    else {
      const latex = `${dOf(x, i)}${bracket(latexOf(node))} = ${latexOf(current)}`;
      steps.push({ rule: 'higherOrder', latex, children: [explained] });
    }
  }
  return { steps, result: current };
}
