// Symbolic derivatives. `differentiate(tree, "x")` returns a tree for the derivative with respect to x, already
// simplified, so d/dx of sin(2x) is 2*cos(2*x). Every other name counts as a constant. That is how the grapher's
// sliders work: the slider value stays fixed while x moves. Angles are radians. The derivative of a degree sign
// or deg() uses the name "pi", which every host defines. A function with no derivative everywhere (floor and mod
// by a variable are examples) throws a 'not-differentiable' error with the place of the function.

import { MAX_TREE_DEPTH, treeDepth, type BinaryNode, type CallNode, type Node, type PostfixNode } from './ast';
import { add, call, dependsOn, div, mul, name, neg, num, pow, sub } from './build';
import { ExprError } from './errors';
import { Budget, simplify } from './simplify';

/**
 * The most nodes the rules and the simplifier may visit for one call of `differentiate`, over every order. The product
 * and quotient rules use parts twice, so each order can multiply the size of the written-out result.
 */
const MAX_NODES = 50_000;

/** The most times `differentiate` will differentiate. */
const MAX_ORDER = 10;

const two = num(2);
const square = (u: Node): Node => pow(u, two);
const recip = (u: Node): Node => div(num(1), u);

/** f'(u) for functions of one argument. The chain rule multiplies it by u'. */
const OUTER: Readonly<Record<string, (u: Node) => Node>> = {
  sin: (u) => call('cos', u),
  cos: (u) => neg(call('sin', u)),
  tan: (u) => recip(square(call('cos', u))),
  sec: (u) => mul(call('sec', u), call('tan', u)),
  csc: (u) => neg(mul(call('csc', u), call('cot', u))),
  cot: (u) => neg(recip(square(call('sin', u)))),
  asin: (u) => recip(call('sqrt', sub(num(1), square(u)))),
  acos: (u) => neg(recip(call('sqrt', sub(num(1), square(u))))),
  atan: (u) => recip(add(num(1), square(u))),
  sinh: (u) => call('cosh', u),
  cosh: (u) => call('sinh', u),
  tanh: (u) => recip(square(call('cosh', u))),
  asinh: (u) => recip(call('sqrt', add(square(u), num(1)))),
  acosh: (u) => recip(call('sqrt', sub(square(u), num(1)))),
  atanh: (u) => recip(sub(num(1), square(u))),
  exp: (u) => call('exp', u),
  ln: (u) => recip(u),
  log2: (u) => recip(mul(u, call('ln', num(2)))),
  log10: (u) => recip(mul(u, call('ln', num(10)))),
  sqrt: (u) => recip(mul(num(2), call('sqrt', u))),
  cbrt: (u) => recip(mul(num(3), square(call('cbrt', u)))),
  abs: (u) => div(u, call('abs', u)),
  deg: () => div(num(180), name('pi')),
  rad: () => div(name('pi'), num(180)),
};

/** Functions that are flat between jumps: their derivative is 0 wherever it exists. */
const FLAT = new Set(['floor', 'ceil', 'round', 'trunc', 'sign']);

class Differentiator {
  constructor(
    private readonly variable: string,
    private readonly budget: Budget,
  ) {}

  private moves(node: Node): boolean {
    return dependsOn(node, this.variable);
  }

  private cannot(node: Node, what: string): ExprError {
    return new ExprError('not-differentiable', node.pos, what, { length: Math.max(1, node.end - node.start) });
  }

  d(node: Node): Node {
    this.budget.spend();
    switch (node.type) {
      case 'name':
        return num(node.name === this.variable ? 1 : 0);
      case 'unary':
        if (node.op === '-') return neg(this.d(node.arg));
        return node.op === '+' ? this.d(node.arg) : this.d(call('sqrt', node.arg));
      case 'postfix':
        return this.postfix(node);
      case 'binary':
        return this.binary(node);
      case 'call':
        return this.call(node);
      case 'convert':
        throw this.cannot(node, 'in');
      default:
        return num(0);
    }
  }

  private postfix(node: PostfixNode): Node {
    if (node.op === '%') return div(this.d(node.arg), num(100));
    if (node.op === '°') return mul(this.d(node.arg), div(name('pi'), num(180)));
    if (!this.moves(node.arg)) return num(0);
    throw this.cannot(node, '!');
  }

  private binary(node: BinaryNode): Node {
    const { left, right } = node;
    switch (node.op) {
      case '+':
        return add(this.d(left), this.d(right));
      case '-':
        return sub(this.d(left), this.d(right));
      case '*':
        return add(mul(this.d(left), right), mul(left, this.d(right)));
      case '/':
        return div(sub(mul(this.d(left), right), mul(left, this.d(right))), square(right));
      case '^':
        return this.power(left, right);
      case 'mod':
        if (this.moves(right)) throw this.cannot(node, 'mod');
        return this.d(left);
      default:
        throw this.cannot(node, node.op);
    }
  }

  /** d/dv of base^exponent. */
  private power(base: Node, exponent: Node): Node {
    if (!this.moves(exponent)) {
      // The power rule: n * u^(n-1) * u'.
      return mul(mul(exponent, pow(base, sub(exponent, num(1)))), this.d(base));
    }
    if (!this.moves(base)) {
      // b^v is b^v * ln(b) * v', and for e it is e^v * v'.
      const isE = base.type === 'name' && base.name === 'e';
      const scale = isE ? num(1) : call('ln', base);
      return mul(mul(pow(base, exponent), scale), this.d(exponent));
    }
    // u^v is e^(v ln u): u^v * (v' ln u + v u' / u).
    const left = mul(this.d(exponent), call('ln', base));
    const right = mul(exponent, div(this.d(base), base));
    return mul(pow(base, exponent), add(left, right));
  }

  private call(node: CallNode): Node {
    const args = node.args;
    if (!args.some((arg) => this.moves(arg)) || FLAT.has(node.name)) return num(0);
    if (Object.hasOwn(OUTER, node.name)) return mul(OUTER[node.name](args[0]), this.d(args[0]));
    switch (node.name) {
      case 'log':
        return this.log(args);
      case 'pow':
        return this.power(args[0], args[1]);
      case 'root':
        return this.power(args[0], recip(args[1]));
      case 'atan2':
        return this.atan2(args[0], args[1]);
      case 'hypot':
        return this.hypot(args);
      case 'mod':
        if (this.moves(args[1])) throw this.cannot(node, 'mod');
        return this.d(args[0]);
      default:
        throw this.cannot(node, node.name);
    }
  }

  private log([u, base]: readonly Node[]): Node {
    if (base === undefined) return mul(recip(mul(u, call('ln', num(10)))), this.d(u));
    if (this.moves(base)) return this.d(div(call('ln', u), call('ln', base)));
    return mul(recip(mul(u, call('ln', base))), this.d(u));
  }

  private atan2(y: Node, x: Node): Node {
    const sum = add(square(x), square(y));
    return add(mul(div(x, sum), this.d(y)), mul(neg(div(y, sum)), this.d(x)));
  }

  private hypot(args: readonly Node[]): Node {
    const total = args.map((a) => mul(a, this.d(a))).reduce((sum, term) => add(sum, term));
    return div(total, call('hypot', ...args));
  }
}

/**
 * The derivative of `node` with respect to `variable`, `order` times (default once, at most MAX_ORDER), simplified.
 * Throws an ExprError with code 'not-differentiable' for a function with no derivative, and 'too-deep' for a
 * derivative too large or too deep to work with.
 */
export function differentiate(node: Node, variable: string, order = 1): Node {
  const budget = new Budget(MAX_NODES);
  const differentiator = new Differentiator(variable, budget);
  const times = Number.isFinite(order) ? Math.min(Math.max(Math.trunc(order), 0), MAX_ORDER) : 0;
  let result = node;
  for (let i = 0; i < times; i += 1) result = simplify(differentiator.d(result), budget);
  if (treeDepth(result) > MAX_TREE_DEPTH) throw new ExprError('too-deep');
  return result;
}
