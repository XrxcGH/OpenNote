// Runs a tree whose numbers may have units. A sum or a difference needs the same dimension on both sides. A product
// or a quotient combines dimensions, a power scales them, and a conversion (5 mi in km) changes the unit a quantity
// is shown in without changing its value. Functions such as sin need plain numbers. A few keep the unit: abs,
// floor, ceil, round, trunc, min, max, hypot, and the roots when the dimension divides evenly. Errors carry the place
// of the failing step, as the calculator's do. Temperatures in Celsius and Fahrenheit are readings: they convert,
// but do not add.

import type { BinaryNode, Node, UnaryNode } from './ast';
import { finite, operation } from './compile';
import { ExprError } from './errors';
import { findFunction, standardFunctions } from './functions';
import { fail, snap } from './numeric';
import {
  addDims,
  amount,
  displayOf,
  fromAmount,
  isPlain,
  mergeParts,
  NO_DIMENSION,
  resolveUnit,
  sameDim,
  scaleDim,
  type Dimension,
  type Display,
  type Quantity,
  type UnitSystem,
} from './quantity';
import { degreesToMode, type AngleMode } from './trig';

export interface QuantityEnv {
  units: UnitSystem;
  /** The value of a name: a quantity, a plain number, or undefined when the name has none. */
  name(name: string): Quantity | number | undefined;
  /** The angle mode for trigonometry and the degree sign. Default radians. */
  angle?: AngleMode;
  /** A function the host defines, such as one written as f(x) = x^2. Returns undefined if there is none by this name. */
  userFunction?(name: string): UserFunction | undefined;
}

/** A function made of a tree: its parameter names and its body. */
export interface UserFunction {
  params: readonly string[];
  body: Node;
}

/** The most calls inside calls, so a function that calls itself stops with an error. */
const MAX_CALL_DEPTH = 40;

/**
 * The most nodes one evaluation may visit, counting every call of the page's own functions. Functions that each call
 * the one before twice double the work at every level, far inside the call depth limit, so depth alone cannot stop
 * a page from hanging. Ordinary lines visit a few hundred nodes.
 */
const MAX_STEPS = 200_000;

/** The steps taken so far. An evaluator shares them with the ones it makes to run a function's body. */
interface Work {
  steps: number;
}

const TABLE = standardFunctions('strict');
/** Functions that give a result in the unit of their arguments, by working on the number as shown. */
const SHOWN = new Set(['abs', 'floor', 'ceil', 'round', 'trunc']);
const ROOTS: Readonly<Record<string, number>> = { sqrt: 2, cbrt: 3 };

const plain = (si: number): Quantity => ({ si, dim: NO_DIMENSION, display: null });
const isReading = (q: Quantity): boolean => q.display !== null && q.display.offset !== 0;

function mismatch(node: Node): ExprError {
  return new ExprError('unit-mismatch', node.pos, undefined, { length: Math.max(1, node.end - node.start) });
}

function requirePlain(q: Quantity, node: Node): number {
  if (!isPlain(q.dim)) throw mismatch(node);
  return q.si;
}

class QuantityEvaluator {
  constructor(
    private readonly env: QuantityEnv,
    private readonly depth = 0,
    private readonly work: Work = { steps: 0 },
  ) {}

  eval(node: Node): Quantity {
    try {
      this.work.steps += 1;
      if (this.work.steps > MAX_STEPS) throw new ExprError('too-deep');
      return this.step(node);
    } catch (error) {
      if (!(error instanceof ExprError)) throw error;
      const name = node.type === 'call' || node.type === 'name' ? node.name : undefined;
      throw error.at(node.pos, name, node.end - node.start);
    }
  }

  private step(node: Node): Quantity {
    switch (node.type) {
      case 'num':
        return plain(node.value);
      case 'name':
        return this.name(node.name);
      case 'quantity': {
        const { dim, display } = resolveUnit(node.unit, this.env.units);
        return fromAmount(node.value.value, dim, display);
      }
      case 'convert':
        return this.convert(node);
      case 'unary':
        return this.unary(node);
      case 'postfix':
        return this.postfix(node);
      case 'binary':
        return this.binary(node);
      case 'call':
        return this.call(node, node.name, node.args);
      default:
        throw new ExprError('unknown-name');
    }
  }

  private name(name: string): Quantity {
    const value = this.env.name(name);
    if (value === undefined) throw new ExprError('unknown-name', -1, name);
    return typeof value === 'number' ? plain(value) : value;
  }

  private convert(node: Extract<Node, { type: 'convert' }>): Quantity {
    const value = this.eval(node.value);
    const { dim, display } = resolveUnit(node.unit, this.env.units);
    if (!sameDim(value.dim, dim)) throw mismatch(node);
    return { si: value.si, dim, display };
  }

  private unary(node: UnaryNode): Quantity {
    if (node.op === '√') return this.call(node, 'sqrt', [node.arg]);
    const arg = this.eval(node.arg);
    if (node.op === '+') return arg;
    if (isReading(arg)) return fromAmount(-amount(arg), arg.dim, arg.display);
    return { ...arg, si: -arg.si };
  }

  private postfix(node: Extract<Node, { type: 'postfix' }>): Quantity {
    if (node.op === '!') return this.call(node, 'factorial', [node.arg]);
    const value = requirePlain(this.eval(node.arg), node.arg);
    const result = node.op === '%' ? value / 100 : degreesToMode(value, this.env.angle ?? 'rad');
    return plain(finite(result));
  }

  private binary(node: BinaryNode): Quantity {
    const left = this.eval(node.left);
    const right = this.eval(node.right);
    switch (node.op) {
      case '+':
      case '-':
      case 'mod':
        return this.sameKind(node, left, right);
      case '*':
      case '/':
        return this.product(node.op, left, right);
      case '^':
        return this.power(node, left, right);
      default:
        return this.compare(node, left, right);
    }
  }

  /** Sum, difference, and remainder: both sides must have the same dimension, and the left unit is kept. */
  private sameKind(node: BinaryNode, left: Quantity, right: Quantity): Quantity {
    if (!sameDim(left.dim, right.dim) || isReading(left) || isReading(right)) throw mismatch(node);
    const si = finite(operation(node.op, true, true)(left.si, right.si));
    return { si, dim: left.dim, display: left.display ?? right.display };
  }

  private product(op: '*' | '/', left: Quantity, right: Quantity): Quantity {
    if (isReading(left) || isReading(right)) throw new ExprError('unit-mismatch');
    const divide = op === '/';
    const si = finite(operation(op, true, true)(left.si, right.si));
    const dim = addDims(left.dim, right.dim, divide ? -1 : 1);
    const parts = mergeParts(left.display?.parts ?? [], right.display?.parts ?? [], divide ? -1 : 1);
    return { si, dim, display: this.showable(dim, parts) };
  }

  /** The display for a product, or null when no unit is left to show or the parts no longer match the dimension. */
  private showable(dim: Dimension, parts: ReturnType<typeof mergeParts>): Display | null {
    const display = displayOf(parts);
    if (display === null) return null;
    // A product of units whose powers cancel the dimension (km/m) is a plain number in base units.
    return isPlain(dim) ? null : display;
  }

  private power(node: BinaryNode, left: Quantity, right: Quantity): Quantity {
    const exponent = requirePlain(right, node.right);
    if (isReading(left)) throw mismatch(node);
    if (!isPlain(left.dim) && !Number.isInteger(exponent)) throw mismatch(node);
    const si = finite(operation('^', true, true)(left.si, exponent));
    const dim = scaleDim(left.dim, exponent);
    const parts = (left.display?.parts ?? []).map((p) => ({ ...p, power: p.power * exponent }));
    return { si, dim, display: this.showable(dim, parts) };
  }

  private compare(node: BinaryNode, left: Quantity, right: Quantity): Quantity {
    if (!sameDim(left.dim, right.dim)) throw mismatch(node);
    return plain(operation(node.op, true, true)(left.si, right.si));
  }

  private call(owner: Node, name: string, argNodes: readonly Node[]): Quantity {
    const args = argNodes.map((arg) => this.eval(arg));
    const own = this.env.userFunction?.(name);
    if (own !== undefined) return this.callOwn(own, args, owner);
    const fn = findFunction(TABLE, name);
    if (fn === undefined) return this.callName(name, args);
    if (args.length < fn.min || args.length > fn.max) throw new ExprError('arity', -1, name);
    if (SHOWN.has(name)) return this.shown(fn.run, args[0], args.slice(1), owner);
    if (name === 'min' || name === 'max') return this.extreme(name, args, owner);
    if (name === 'hypot') return this.hypot(args, owner);
    if (Object.hasOwn(ROOTS, name)) return this.root(ROOTS[name], args[0], owner);
    const values = args.map((a) => requirePlain(a, owner));
    return plain(finite(fn.run(values, this.env.angle ?? 'rad')));
  }

  /** A call of a name that is not a function. A variable followed by brackets is a product: rent(12). */
  private callName(name: string, args: Quantity[]): Quantity {
    const value = this.env.name(name);
    if (value === undefined || args.length !== 1) throw new ExprError('unknown-name', -1, name);
    const left = typeof value === 'number' ? plain(value) : value;
    return this.product('*', left, args[0]);
  }

  private callOwn(fn: UserFunction, args: Quantity[], owner: Node): Quantity {
    if (args.length !== fn.params.length)
      throw new ExprError('arity', -1, owner.type === 'call' ? owner.name : undefined);
    if (this.depth >= MAX_CALL_DEPTH) throw new ExprError('too-deep');
    const bound = new Map(fn.params.map((param, i) => [param, args[i]]));
    const inner: QuantityEnv = { ...this.env, name: (n) => bound.get(n) ?? this.env.name(n) };
    return new QuantityEvaluator(inner, this.depth + 1, this.work).eval(fn.body);
  }

  /** abs, floor, and the like work on the number as shown, so floor(5.7 km) is 5 km. */
  private shown(
    run: (args: readonly number[], angle: AngleMode) => number,
    q: Quantity,
    rest: Quantity[],
    owner: Node,
  ): Quantity {
    const extra = rest.map((a) => requirePlain(a, owner));
    const result = finite(run([amount(q), ...extra], 'rad'));
    return fromAmount(result, q.dim, q.display);
  }

  private extreme(name: string, args: Quantity[], owner: Node): Quantity {
    if (!args.every((a) => sameDim(a.dim, args[0].dim))) throw mismatch(owner);
    return args.reduce((best, q) => (name === 'min' ? (q.si < best.si ? q : best) : q.si > best.si ? q : best));
  }

  private hypot(args: Quantity[], owner: Node): Quantity {
    if (!args.every((a) => sameDim(a.dim, args[0].dim))) throw mismatch(owner);
    const si = finite(Math.hypot(...args.map((a) => a.si)));
    return { si, dim: args[0].dim, display: args[0].display };
  }

  private root(degree: number, q: Quantity, owner: Node): Quantity {
    if (!q.dim.every((x) => x % degree === 0)) throw mismatch(owner);
    const si = degree === 2 ? (q.si >= 0 ? Math.sqrt(q.si) : fail('domain')) : Math.cbrt(q.si);
    const parts = (q.display?.parts ?? []).map((p) => ({ ...p, power: p.power / degree }));
    const whole = parts.every((p) => Number.isInteger(p.power));
    const dim = scaleDim(q.dim, 1 / degree);
    return { si: snap(si), dim, display: whole ? this.showable(dim, parts) : null };
  }
}

/** Evaluates a tree with units. Throws an ExprError with the place of the failing step. */
export function evaluateQuantity(node: Node, env: QuantityEnv): Quantity {
  return new QuantityEvaluator(env).eval(node);
}
