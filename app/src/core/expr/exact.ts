// Evaluates a tree with exact fractions. The four operations, whole-number powers, and many functions stay exact.
// Those functions are abs, floor, round, min, max, mod, factorial, nCr, and roots that come out whole. So 0.1 + 0.2 is
// exactly 3/10 and 1/3 * 3 is exactly 1. A step with no exact answer, such as sin(1) or 2^0.5, gives a double, and
// everything built on a double is a double. The result says which kind it is.

import type { BinaryNode, Node } from './ast';
import { ExprError } from './errors';
import { finite, operation } from './compile';
import { findFunction, standardFunctions } from './functions';
import * as q from './rational';
import { fromDecimalText, fromNumber, rational, type Rational } from './rational';

export type ExactValue = { exact: true; value: Rational } | { exact: false; value: number };

export interface ExactEnv {
  /** The value of a name: an exact fraction, a double, or undefined when the name has none. */
  name(name: string): Rational | number | undefined;
}

type ExactFn = (args: Rational[]) => Rational | null;

const approx = (value: number): ExactValue => ({ exact: false, value });
const exact = (value: Rational): ExactValue => ({ exact: true, value });
const toDouble = (v: ExactValue): number => (v.exact ? q.toNumber(v.value) : v.value);

function wholeBig(value: Rational): bigint | null {
  return q.isInteger(value) ? value.n : null;
}

/** The functions that keep exact arguments exact. Each returns null when this particular answer is not exact. */
const EXACT_FUNCTIONS: Readonly<Record<string, ExactFn>> = {
  abs: ([x]) => q.abs(x),
  sign: ([x]) => rational(BigInt(q.sign(x))),
  floor: ([x]) => q.floor(x),
  ceil: ([x]) => q.ceil(x),
  trunc: ([x]) => q.trunc(x),
  round: ([x, places]) => {
    if (places === undefined) return q.round(x);
    const count = wholeBig(places);
    if (count === null || count < 0n || count > 15n) throw new ExprError('domain');
    const scale = q.powInt(rational(10n), count);
    return q.div(q.round(q.mul(x, scale)), scale);
  },
  min: (args) => args.reduce((a, b) => (q.compare(b, a) < 0 ? b : a)),
  max: (args) => args.reduce((a, b) => (q.compare(b, a) > 0 ? b : a)),
  mod: ([x, y]) => q.mod(x, y),
  pow: ([x, y]) => power(x, y),
  factorial: ([x]) => q.factorialExact(x),
  fact: ([x]) => q.factorialExact(x),
  sqrt: ([x]) => {
    if (q.sign(x) < 0) throw new ExprError('domain');
    return q.rootExact(x, 2);
  },
  cbrt: ([x]) => {
    const root = q.rootExact(q.abs(x), 3);
    return root === null ? null : q.sign(x) < 0 ? q.neg(root) : root;
  },
  root: ([x, n]) => {
    const k = wholeBig(n);
    if (k === null || k < 1n || k > 1000n) return null;
    const root = q.rootExact(q.abs(x), Number(k));
    if (root === null) return null;
    if (q.sign(x) >= 0) return root;
    return k % 2n === 1n
      ? q.neg(root)
      : (() => {
          throw new ExprError('domain');
        })();
  },
  ncr: ([n, r]) => choose(n, r, false),
  npr: ([n, r]) => choose(n, r, true),
};

function choose(n: Rational, r: Rational, ordered: boolean): Rational {
  const top = wholeBig(n);
  const pick = wholeBig(r);
  if (top === null || pick === null || top < 0n || pick < 0n || pick > top) throw new ExprError('domain');
  if (top > 3000n) throw new ExprError('overflow');
  const k = ordered ? pick : pick > top - pick ? top - pick : pick;
  let result = 1n;
  for (let i = 0n; i < k; i += 1n) {
    result = ordered ? result * (top - i) : (result * (top - i)) / (i + 1n);
  }
  return rational(result);
}

/** x to the power y when y is a whole number, or a ratio that gives an exact root. Otherwise null. */
function power(x: Rational, y: Rational): Rational | null {
  const whole = wholeBig(y);
  if (whole !== null) return q.powInt(x, whole);
  if (q.sign(x) < 0) throw new ExprError('domain');
  if (y.d > 1000n || y.n > 100_000n || y.n < -100_000n) return null;
  const root = q.rootExact(x, Number(y.d));
  return root === null ? null : q.powInt(root, y.n);
}

class ExactEvaluator {
  constructor(private readonly env: ExactEnv) {}

  eval(node: Node): ExactValue {
    try {
      return this.step(node);
    } catch (error) {
      const name = node.type === 'name' || node.type === 'call' ? node.name : undefined;
      throw error instanceof ExprError ? error.at(node.pos, name, node.end - node.start) : error;
    }
  }

  private step(node: Node): ExactValue {
    switch (node.type) {
      case 'num': {
        const value = fromDecimalText(node.text);
        return value === null ? approx(node.value) : exact(value);
      }
      case 'name':
        return this.name(node.name);
      case 'unary':
        return this.unary(node);
      case 'postfix':
        return this.postfix(node);
      case 'binary':
        return this.binary(node);
      case 'call':
        return this.call(node.name, node.args);
      default:
        throw new ExprError('unknown-name');
    }
  }

  private name(name: string): ExactValue {
    const value = this.env.name(name);
    if (value === undefined) throw new ExprError('unknown-name');
    return typeof value === 'number' ? approx(value) : exact(value);
  }

  private unary(node: Extract<Node, { type: 'unary' }>): ExactValue {
    if (node.op === '√') return this.call('sqrt', [node.arg]);
    const arg = this.eval(node.arg);
    if (node.op === '+') return arg;
    return arg.exact ? exact(q.neg(arg.value)) : approx(-arg.value);
  }

  private postfix(node: Extract<Node, { type: 'postfix' }>): ExactValue {
    if (node.op === '!') return this.call('factorial', [node.arg]);
    const arg = this.eval(node.arg);
    if (node.op === '%') return arg.exact ? exact(q.div(arg.value, rational(100n))) : approx(finite(arg.value / 100));
    return approx(finite((toDouble(arg) * Math.PI) / 180));
  }

  private binary(node: BinaryNode): ExactValue {
    const left = this.eval(node.left);
    const right = this.eval(node.right);
    if (left.exact && right.exact) {
      const result = this.exactBinary(node.op, left.value, right.value);
      if (result !== null) return exact(result);
    }
    return approx(finite(operation(node.op, true, false)(toDouble(left), toDouble(right))));
  }

  private exactBinary(op: BinaryNode['op'], a: Rational, b: Rational): Rational | null {
    switch (op) {
      case '+':
        return q.add(a, b);
      case '-':
        return q.sub(a, b);
      case '*':
        return q.mul(a, b);
      case '/':
        return q.div(a, b);
      case '^':
        return power(a, b);
      case 'mod':
        return q.mod(a, b);
      default:
        return null;
    }
  }

  private call(name: string, argNodes: readonly Node[]): ExactValue {
    const table = standardFunctions('strict');
    const fn = findFunction(table, name);
    if (fn === undefined) throw new ExprError('unknown-name');
    const args = argNodes.map((arg) => this.eval(arg));
    const rules = Object.hasOwn(EXACT_FUNCTIONS, name) ? EXACT_FUNCTIONS[name] : undefined;
    if (rules !== undefined && args.every((a) => a.exact)) {
      const result = rules(args.map((a) => a.value as Rational));
      if (result !== null) return exact(result);
    }
    return approx(finite(fn.run(args.map(toDouble), 'rad')));
  }
}

/** Evaluates exactly. Throws an ExprError with the place of the failing step. */
export function evaluateExact(node: Node, env: ExactEnv): ExactValue {
  return new ExactEvaluator(env).eval(node);
}

/** The value as a double, for showing next to the exact form. */
export function exactToNumber(value: ExactValue): number {
  return toDouble(value);
}

/** An exact fraction for a double, read as the decimal a person means. Null for NaN and Infinity. */
export function exactFromNumber(value: number): Rational | null {
  return fromNumber(value);
}
