// Turns a tree into a function. The tree becomes a chain of closures over a fixed set of operations. No text is ever
// run as code, so a hostile expression can only return a number or an error.
//
// Two ways to run it, picked by `strict`:
//   strict: a calculator. A step that has no answer throws an ExprError with the place of the step. A result that is
//           NaN is a 'domain' error, and an infinite one is 'overflow'. With `snap`, sums, differences, and products
//           are rounded to 15 digits, so 0.1 + 0.2 is 0.3.
//   lenient: a grapher. NaN and Infinity pass through as numbers, because a gap in a curve is not a failure.
// Lenient closures are written out one operator at a time, because a grapher calls them many thousands of times.

import type { BinaryNode, Node, PostfixNode, UnaryNode } from './ast';
import { ExprError } from './errors';
import { findFunction, type FnDef, type FunctionTable } from './functions';
import { fail, modulo, moduloOrNaN, realPower, snap, snappedModulo } from './numeric';
import { degreesToMode, type AngleMode } from './trig';

/** A compiled node: reads its inputs from a context the host chooses. */
export type Compiled<C> = (ctx: C) => number;

export interface CompileOptions<C> {
  strict: boolean;
  /** Round sums, differences, and products to 15 digits. Only meaningful when strict. */
  snap?: boolean;
  table: FunctionTable;
  /** Gives the reader for a name, or undefined when the name has no value. */
  bind: (name: string) => Compiled<C> | undefined;
  /** The angle mode, read each time a function or degree sign runs. Default: radians. */
  angle?: (ctx: C) => AngleMode;
}

type Operation = (a: number, b: number) => number;

/** A comparison is 1 when it holds and 0 when it does not. Text joining has no number to give. */
function comparison(op: BinaryNode['op']): Operation {
  switch (op) {
    case '=':
      return (a, b) => Number(a === b);
    case '<>':
      return (a, b) => Number(a !== b);
    case '<':
      return (a, b) => Number(a < b);
    case '>':
      return (a, b) => Number(a > b);
    case '<=':
      return (a, b) => Number(a <= b);
    case '>=':
      return (a, b) => Number(a >= b);
    default:
      return () => fail('unknown-name');
  }
}

/**
 * The number operation for a binary operator. Strict operations throw an ExprError for division by zero and the like.
 * Lenient ones follow floating point, with a real result for odd roots of negative numbers.
 */
export function operation(op: BinaryNode['op'], strict: boolean, roundSums: boolean): Operation {
  const cache = operations[(strict ? 2 : 0) + (roundSums ? 1 : 0)];
  let found = cache.get(op);
  if (found === undefined) {
    found = makeOperation(op, strict, roundSums);
    cache.set(op, found);
  }
  return found;
}

/** Operations already made, in four maps: lenient or strict, with or without rounding. */
const operations: Map<string, Operation>[] = [new Map(), new Map(), new Map(), new Map()];

function makeOperation(op: BinaryNode['op'], strict: boolean, roundSums: boolean): Operation {
  const round = strict && roundSums ? snap : (x: number) => x;
  switch (op) {
    case '+':
      return (a, b) => round(a + b);
    case '-':
      return (a, b) => round(a - b);
    case '*':
      return (a, b) => round(a * b);
    case '/':
      return strict ? (a, b) => (b === 0 ? fail('divide-by-zero') : a / b) : (a, b) => a / b;
    case '^':
      if (!strict) return realPower;
      return (a, b) => (a === 0 && b < 0 ? fail('divide-by-zero') : Math.pow(a, b));
    case 'mod':
      if (!strict) return moduloOrNaN;
      return roundSums ? snappedModulo : modulo;
    default:
      return comparison(op);
  }
}

/** In strict mode a result that is not a finite number is an error. */
export function finite(value: number): number {
  if (Number.isNaN(value)) return fail('domain');
  return Number.isFinite(value) ? value : fail('overflow');
}

/** A lenient node whose right side is a plain number: the number is read once, not on every run. */
function lenientWithNumber<C>(op: BinaryNode['op'], l: Compiled<C>, k: number): Compiled<C> | null {
  switch (op) {
    case '+':
      return (c) => l(c) + k;
    case '-':
      return (c) => l(c) - k;
    case '*':
      return (c) => l(c) * k;
    case '/':
      return (c) => l(c) / k;
    case '^':
      // A square is the commonest power in a curve, and a product is exactly the rounded square.
      if (k === 2) {
        return (c) => {
          const v = l(c);
          return v * v;
        };
      }
      return (c) => realPower(l(c), k);
    default:
      return null;
  }
}

/** A lenient binary node, with the operator written into the closure so nothing is looked up when it runs. */
function lenientBinary<C>(node: BinaryNode, l: Compiled<C>, r: Compiled<C>): Compiled<C> {
  const op = node.op;
  if (node.right.type === 'num') {
    const fixed = lenientWithNumber(op, l, node.right.value);
    if (fixed !== null) return fixed;
  }
  if (node.left.type === 'num' && (op === '+' || op === '*')) {
    const k = node.left.value;
    return op === '+' ? (c) => k + r(c) : (c) => k * r(c);
  }
  switch (op) {
    case '+':
      return (c) => l(c) + r(c);
    case '-':
      return (c) => l(c) - r(c);
    case '*':
      return (c) => l(c) * r(c);
    case '/':
      return (c) => l(c) / r(c);
    case '^':
      return (c) => realPower(l(c), r(c));
    case 'mod':
      return (c) => moduloOrNaN(l(c), r(c));
    default: {
      const compare = comparison(op);
      return (c) => compare(l(c), r(c));
    }
  }
}

/** Puts the place of `node` on an ExprError that has none. Other errors are bugs and pass through. */
function place(error: unknown, node: Node): unknown {
  if (!(error instanceof ExprError)) return error;
  return error.at(node.pos, node.type === 'call' ? node.name : undefined, node.end - node.start);
}

class Compiler<C> {
  private readonly strict: boolean;

  constructor(private readonly options: CompileOptions<C>) {
    this.strict = options.strict;
  }

  node(node: Node): Compiled<C> {
    switch (node.type) {
      case 'num':
        return () => node.value;
      case 'name':
        return this.name(node);
      case 'unary':
        return this.unary(node);
      case 'binary':
        return this.binary(node);
      case 'postfix':
        return this.postfix(node);
      case 'call':
        return this.call(node, node.name, node.args);
      default:
        return () => fail('unknown-name');
    }
  }

  private name(node: Extract<Node, { type: 'name' }>): Compiled<C> {
    const read = this.options.bind(node.name);
    if (read !== undefined) return read;
    if (!this.strict) return () => NaN;
    const length = node.end - node.start;
    return () => {
      throw new ExprError('unknown-name', node.pos, node.name, { length });
    };
  }

  private unary(node: UnaryNode): Compiled<C> {
    if (node.op === '√') return this.call(node, 'sqrt', [node.arg]);
    const arg = this.node(node.arg);
    return node.op === '-' ? (ctx) => -arg(ctx) : arg;
  }

  private postfix(node: PostfixNode): Compiled<C> {
    if (node.op === '!') return this.call(node, 'factorial', [node.arg]);
    const arg = this.node(node.arg);
    const angle = this.options.angle;
    const apply: (value: number, ctx: C) => number =
      node.op === '%'
        ? (value) => value / 100
        : (value, ctx) => degreesToMode(value, angle === undefined ? 'rad' : angle(ctx));
    if (!this.strict) return (ctx) => apply(arg(ctx), ctx);
    return (ctx) => {
      try {
        return finite(apply(arg(ctx), ctx));
      } catch (error) {
        throw place(error, node);
      }
    };
  }

  private binary(node: BinaryNode): Compiled<C> {
    const left = this.node(node.left);
    const right = this.node(node.right);
    if (!this.strict) return lenientBinary(node, left, right);
    const operate = operation(node.op, true, this.options.snap === true);
    return (ctx) => {
      try {
        return finite(operate(left(ctx), right(ctx)));
      } catch (error) {
        throw place(error, node);
      }
    };
  }

  /** A call of the function `name`. `owner` is the node an error is reported at: a call, or the sign that means one. */
  private call(owner: Node, name: string, argNodes: readonly Node[]): Compiled<C> {
    const fn = findFunction(this.options.table, name);
    const args = argNodes.map((arg) => this.node(arg));
    if (fn === undefined) {
      if (!this.strict) return () => NaN;
      return () => {
        throw place(new ExprError('unknown-name'), owner);
      };
    }
    const run = this.invoke(fn, args);
    if (!this.strict) return run;
    return (ctx) => {
      try {
        return finite(run(ctx));
      } catch (error) {
        throw place(error, owner);
      }
    };
  }

  private invoke(fn: FnDef, args: Compiled<C>[]): Compiled<C> {
    const angle = this.options.angle;
    const [a, b] = args;
    if (args.length === 1 && fn.run1 !== undefined) {
      const run1 = fn.run1;
      return angle === undefined ? (ctx) => run1(a(ctx), 'rad') : (ctx) => run1(a(ctx), angle(ctx));
    }
    if (args.length === 2 && fn.run2 !== undefined) {
      const run2 = fn.run2;
      return angle === undefined ? (ctx) => run2(a(ctx), b(ctx), 'rad') : (ctx) => run2(a(ctx), b(ctx), angle(ctx));
    }
    const { run } = fn;
    return (ctx) =>
      run(
        args.map((arg) => arg(ctx)),
        angle === undefined ? 'rad' : angle(ctx),
      );
  }
}

/** Compiles a tree. Strict failures throw an ExprError when the result is run, not here. */
export function compileNode<C>(node: Node, options: CompileOptions<C>): Compiled<C> {
  return new Compiler(options).node(node);
}
