// Step-by-step derivatives and integrals for the equation panel's Steps. A derivative names the rule at each part of
// the expression (sum, constant multiple, product, quotient, power, chain, and the derivatives of the usual
// functions) and shows that part's derivative, worked out by the shared engine (core/expr/derive.ts). An integral
// uses a table of rules (sum, constant multiple, power, 1/x, and sin, cos, exp, and powers of a linear expression)
// and says plainly when the integrand is not in it. A definite integral also gets its value, from the antiderivative
// or, when there is none in the table, by Simpson's rule.
import { build, dependsOn, differentiate, formatExpression, freeNames, simplify, tryParse } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { compileExpression } from '../grapher';
import { Unsupported, latexToText, treeToLatex } from './convert';

export type StepRule =
  | 'constant'
  | 'variable'
  | 'sum'
  | 'constantMultiple'
  | 'product'
  | 'quotient'
  | 'power'
  | 'chain'
  | 'exponential'
  | 'function'
  | 'logarithm'
  | 'reciprocal'
  | 'linear'
  | 'evaluate'
  | 'numeric'
  | 'simplify';

export interface Step {
  rule: StepRule;
  /** The step as LaTeX, such as \frac{d}{dx}\left[x^2\right] = 2x. */
  latex: string;
}

export type StepsResult =
  | { ok: true; kind: 'derivative' | 'integral'; steps: Step[]; result: string }
  | { ok: false; reason: 'unsupported' | 'letters' | 'notInTable' };

/** At most this many steps, so a large expression stays readable. */
const MAX_STEPS = 24;
const CONSTANTS = new Set(['pi', 'e', 'tau', 'phi']);

const latexOf = (node: Node) => treeToLatex(simplify(node));
const d = (variable: string) => `\\frac{d}{d${variable}}`;
const bracket = (latex: string) => `\\left[${latex}\\right]`;

function parseText(latex: string): Node | null {
  try {
    const parsed = tryParse(latexToText(latex));
    return parsed.ok ? parsed.value : null;
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

// Derivatives

class Explainer {
  readonly steps: Step[] = [];
  constructor(private readonly x: string) {}

  private say(rule: StepRule, node: Node, latex?: string): void {
    if (this.steps.length >= MAX_STEPS) return;
    const derivative = latex ?? latexOf(differentiate(node, this.x));
    this.steps.push({ rule, latex: `${d(this.x)}${bracket(latexOf(node))} = ${derivative}` });
  }

  private has = (node: Node) => dependsOn(node, this.x);

  explain(node: Node): void {
    if (this.steps.length >= MAX_STEPS) return;
    if (!this.has(node)) return this.say('constant', node, '0');
    switch (node.type) {
      case 'name':
        return this.say('variable', node, '1');
      case 'unary':
        this.say('constantMultiple', node);
        return this.explain(node.arg);
      case 'binary':
        return this.binary(node);
      case 'call':
        return this.call(node);
      default:
        return this.say('simplify', node);
    }
  }

  private binary(node: Node & { type: 'binary' }): void {
    const { op, left, right } = node;
    if (op === '+' || op === '-') {
      this.say('sum', node);
      this.explain(left);
      this.explain(right);
    } else if (op === '*') {
      if (!this.has(left) || !this.has(right)) {
        this.say('constantMultiple', node);
        this.explain(this.has(left) ? left : right);
      } else {
        this.say('product', node);
        this.explain(left);
        this.explain(right);
      }
    } else if (op === '/') {
      if (!this.has(right)) {
        this.say('constantMultiple', node);
        this.explain(left);
      } else {
        this.say('quotient', node);
        this.explain(left);
        this.explain(right);
      }
    } else if (op === '^') {
      if (!this.has(right)) {
        this.say(left.type === 'name' ? 'power' : 'chain', node);
        if (left.type !== 'name') this.explain(left);
      } else if (!this.has(left)) {
        this.say('exponential', node);
        if (!(right.type === 'name')) this.explain(right);
      } else this.say('simplify', node);
    } else this.say('simplify', node);
  }

  private call(node: Node & { type: 'call' }): void {
    const [arg] = node.args;
    const rule: StepRule = node.name === 'ln' || node.name === 'log' ? 'logarithm' : 'function';
    if (arg && arg.type !== 'name' && this.has(arg)) {
      this.say('chain', node);
      this.explain(arg);
    } else this.say(rule, node);
  }
}

/** The variable of a derivative or an integral: x when it is there, or the one letter used. */
function variableOf(node: Node, written?: string): string | null {
  if (written) return written;
  const names = freeNames(node).filter((name) => !CONSTANTS.has(name));
  if (names.includes('x')) return 'x';
  return names.length === 1 ? names[0] : names.length === 0 ? 'x' : null;
}

export function derivativeSteps(latex: string): StepsResult {
  const written = /^\s*\\frac\{d\}\{d([a-z])\}\s*(.*)$/s.exec(latex);
  const at = latex.indexOf('=');
  const body = written ? written[2] : at >= 0 && /^\s*[yf]/.test(latex) ? latex.slice(at + 1) : latex;
  const node = parseText(body.trim());
  if (!node) return { ok: false, reason: 'unsupported' };
  const x = variableOf(node, written?.[1]);
  if (!x) return { ok: false, reason: 'letters' };
  let result: Node;
  try {
    result = differentiate(node, x);
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
  const explainer = new Explainer(x);
  explainer.explain(node);
  const answer = latexOf(result);
  explainer.steps.push({ rule: 'simplify', latex: `${d(x)}${bracket(latexOf(node))} = ${answer}` });
  return { ok: true, kind: 'derivative', steps: explainer.steps, result: answer };
}

// Integrals

interface Integrated {
  node: Node;
  steps: Step[];
}

class Integrator {
  constructor(private readonly x: string) {}

  private has = (node: Node) => dependsOn(node, this.x);
  private int = (latex: string) => `\\int ${latex}\\,d${this.x}`;

  private step(rule: StepRule, from: Node, to: Node): Step {
    return { rule, latex: `${this.int(latexOf(from))} = ${latexOf(to)} + C` };
  }

  /** The slope of a linear expression a x + b, or null when it is not linear in x. */
  private slope(node: Node): number | null {
    if (!this.has(node)) return null;
    try {
      const derivative = differentiate(node, this.x);
      if (this.has(derivative)) return null;
      const value = compileExpression(treeToText(derivative));
      return value.ok ? value.expression.evaluate(0) : null;
    } catch {
      return null;
    }
  }

  integrate(node: Node, depth = 0): Integrated | null {
    if (depth > 12) return null;
    const { num, name, add, sub, mul, div, pow, call, neg } = build;
    if (!this.has(node)) {
      const to = mul(node, name(this.x));
      return { node: to, steps: [this.step('constant', node, to)] };
    }
    if (node.type === 'unary' && node.op === '-') {
      const inner = this.integrate(node.arg, depth + 1);
      return (
        inner && {
          node: neg(inner.node),
          steps: [this.step('constantMultiple', node, neg(inner.node)), ...inner.steps],
        }
      );
    }
    if (node.type === 'name') {
      const to = div(pow(node, num(2)), num(2));
      return { node: to, steps: [this.step('power', node, to)] };
    }
    if (node.type === 'binary') {
      const { op, left, right } = node;
      if (op === '+' || op === '-') {
        const [a, b] = [this.integrate(left, depth + 1), this.integrate(right, depth + 1)];
        if (!a || !b) return null;
        const to = op === '+' ? add(a.node, b.node) : sub(a.node, b.node);
        return { node: to, steps: [this.step('sum', node, to), ...a.steps, ...b.steps] };
      }
      if (op === '*' && (!this.has(left) || !this.has(right))) {
        const [c, f] = this.has(left) ? [right, left] : [left, right];
        const inner = this.integrate(f, depth + 1);
        if (!inner) return null;
        const to = mul(c, inner.node);
        return { node: to, steps: [this.step('constantMultiple', node, to), ...inner.steps] };
      }
      if (op === '/' && !this.has(right)) {
        const inner = this.integrate(left, depth + 1);
        if (!inner) return null;
        const to = div(inner.node, right);
        return { node: to, steps: [this.step('constantMultiple', node, to), ...inner.steps] };
      }
      if (op === '/' && !this.has(left)) {
        // c / (a x + b) is c ln|a x + b| / a.
        const a = this.slope(right);
        if (a === null || a === 0) return null;
        const to = div(mul(left, call('ln', call('abs', right))), num(a));
        return { node: to, steps: [this.step(right.type === 'name' ? 'reciprocal' : 'linear', node, to)] };
      }
      if (op === '^' && !this.has(right)) {
        const a = this.slope(left);
        if (a === null || a === 0) return null;
        const n = compileExpression(treeToText(right));
        const power = n.ok ? n.expression.evaluate(0) : NaN;
        if (power === -1) {
          const to = div(call('ln', call('abs', left)), num(a));
          return { node: to, steps: [this.step('reciprocal', node, to)] };
        }
        const raised = add(right, num(1));
        const to = div(pow(left, raised), mul(num(a), raised));
        return { node: to, steps: [this.step(left.type === 'name' ? 'power' : 'linear', node, to)] };
      }
      if (op === '^' && !this.has(left) && left.type === 'name' && left.name === 'e') {
        return this.integrate(call('exp', right), depth + 1);
      }
      return null;
    }
    if (node.type === 'call' && node.args.length === 1) {
      const [u] = node.args;
      const a = this.slope(u);
      if (a === null || a === 0) return null;
      const scale = (to: Node) => (a === 1 ? to : div(to, num(a)));
      const rule: StepRule = u.type === 'name' ? 'function' : 'linear';
      const table: Record<string, () => Node> = {
        sin: () => neg(scale(call('cos', u))),
        cos: () => scale(call('sin', u)),
        exp: () => scale(call('exp', u)),
        sec: () => scale(call('tan', u)),
      };
      const make = table[node.name];
      if (!make) return null;
      const to = make();
      return { node: to, steps: [this.step(rule, node, to)] };
    }
    return null;
  }
}

/** A tree as text the grapher reads. */
const treeToText = (node: Node): string => formatExpression(node);

/** The integral's parts: the integrand, the variable, and the limits of a definite integral. */
function readIntegral(latex: string): { body: string; x: string; from?: string; to?: string } | null {
  const match =
    /^\s*\\int(?:\s*_\s*(\{[^{}]*\}|[^\s{}^])\s*\^\s*(\{[^{}]*\}|[^\s{}]))?\s*(.*?)\s*(?:\\[,;!: ]\s*)*d([a-z])\s*$/s.exec(
      latex,
    );
  if (!match) return null;
  const strip = (part?: string) => part?.replace(/^\{|\}$/g, '');
  const from = strip(match[1]);
  const to = strip(match[2]);
  return { body: match[3], x: match[4], ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

/** Simpson's rule over [a, b] with an even number of slices. */
function simpson(f: (x: number) => number, a: number, b: number, slices = 1000): number {
  const h = (b - a) / slices;
  let total = f(a) + f(b);
  for (let i = 1; i < slices; i += 1) total += f(a + i * h) * (i % 2 === 1 ? 4 : 2);
  return (total * h) / 3;
}

const shown = (value: number) => String(Number(value.toPrecision(10)));

export function integralSteps(latex: string): StepsResult {
  const parts = readIntegral(latex);
  if (!parts) return { ok: false, reason: 'unsupported' };
  const node = parseText(parts.body);
  if (!node) return { ok: false, reason: 'unsupported' };
  const integrated = new Integrator(parts.x).integrate(node);
  const definite = parts.from !== undefined && parts.to !== undefined;
  const rename = (text: string) =>
    parts.x === 'x' ? text : text.replace(new RegExp(`(?<![A-Za-z])${parts.x}(?![A-Za-z])`, 'g'), 'x');
  const limit = (part: string) => {
    const read = parseText(part);
    const compiled = read && compileExpression(treeToText(read));
    return compiled && compiled.ok ? compiled.expression.evaluate(0) : NaN;
  };
  if (!integrated) {
    if (!definite) return { ok: false, reason: 'notInTable' };
    const f = compileExpression(rename(treeToText(node)));
    const [a, b] = [limit(parts.from!), limit(parts.to!)];
    if (!f.ok || !Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, reason: 'unsupported' };
    const value = simpson((x) => f.expression.evaluate(x), a, b);
    if (!Number.isFinite(value)) return { ok: false, reason: 'unsupported' };
    const answer = shown(value);
    return {
      ok: true,
      kind: 'integral',
      steps: [{ rule: 'numeric', latex: `${latex.trim()} \\approx ${answer}` }],
      result: answer,
    };
  }
  const antiderivative = latexOf(integrated.node);
  const steps = [...integrated.steps.slice(0, MAX_STEPS)];
  if (!definite) {
    steps.push({ rule: 'simplify', latex: `\\int ${latexOf(node)}\\,d${parts.x} = ${antiderivative} + C` });
    return { ok: true, kind: 'integral', steps, result: `${antiderivative} + C` };
  }
  const F = compileExpression(rename(treeToText(integrated.node)));
  const [a, b] = [limit(parts.from!), limit(parts.to!)];
  if (!F.ok || !Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, reason: 'unsupported' };
  const value = F.expression.evaluate(b) - F.expression.evaluate(a);
  const answer = shown(Math.abs(value) < 1e-12 ? 0 : value);
  steps.push({
    rule: 'evaluate',
    latex: `\\left[${antiderivative}\\right]_{${parts.from}}^{${parts.to}} = ${answer}`,
  });
  return { ok: true, kind: 'integral', steps, result: answer };
}

/** Steps for an integral, a written derivative, or else the derivative of the expression. */
export function stepsLatex(latex: string): StepsResult {
  if (latex.length > 2000) return { ok: false, reason: 'unsupported' };
  return /^\s*\\int/.test(latex) ? integralSteps(latex) : derivativeSteps(latex);
}
