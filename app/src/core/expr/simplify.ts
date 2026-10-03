// Tidies a tree without changing its value: folds sums, products, and powers of plain numbers, drops 0 and 1 where
// they do nothing, and moves signs outward. Like a computer algebra system, it takes names to stand for ordinary
// numbers, so x*0 is 0 and x/x is 1. Division only folds when the quotient is whole, so 1/3 stays 1/3.

import type { Node } from './ast';
import { binary, mul, neg, num } from './build';
import { sameTree } from './ast';
import { ExprError } from './errors';

const isNum = (node: Node): node is Extract<Node, { type: 'num' }> => node.type === 'num';
const isValue = (node: Node, value: number): boolean => node.type === 'num' && node.value === value;

function foldPower(base: number, exponent: number): Node | null {
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 64) return null;
  const value = Math.pow(base, exponent);
  return Number.isSafeInteger(value) ? num(value) : null;
}

function foldNumbers(op: string, a: number, b: number): Node | null {
  switch (op) {
    case '+':
      return num(a + b);
    case '-':
      return num(a - b);
    case '*':
      return num(a * b);
    case '/':
      return b !== 0 && Number.isInteger(a / b) ? num(a / b) : null;
    case '^':
      return foldPower(a, b);
    default:
      return null;
  }
}

function simplifyNeg(arg: Node): Node {
  if (isNum(arg)) return num(-arg.value);
  if (arg.type === 'unary' && arg.op === '-') return arg.arg;
  return neg(arg);
}

function simplifySum(op: '+' | '-', left: Node, right: Node): Node {
  if (isNum(left) && isNum(right)) return foldNumbers(op, left.value, right.value) ?? binary(op, left, right);
  if (isValue(right, 0)) return left;
  if (isValue(left, 0)) return op === '+' ? right : simplifyNeg(right);
  const rightNegated = right.type === 'unary' && right.op === '-';
  if (rightNegated) return op === '+' ? simplifySum('-', left, right.arg) : simplifySum('+', left, right.arg);
  if (isNum(right) && right.value < 0) return simplifySum(op === '+' ? '-' : '+', left, num(-right.value));
  const leftNegated = left.type === 'unary' && left.op === '-';
  if (leftNegated && op === '+') return simplifySum('-', right, left.arg);
  if (op === '-' && sameTree(left, right)) return num(0);
  return binary(op, left, right);
}

function splitSign(node: Node): { negative: boolean; rest: Node } {
  if (node.type === 'unary' && node.op === '-') return { negative: true, rest: node.arg };
  if (isNum(node) && node.value < 0) return { negative: true, rest: num(-node.value) };
  return { negative: false, rest: node };
}

function simplifyProduct(left: Node, right: Node): Node {
  if (isNum(left) && isNum(right)) return num(left.value * right.value);
  if (isValue(left, 0) || isValue(right, 0)) return num(0);
  if (isValue(left, 1)) return right;
  if (isValue(right, 1)) return left;
  const a = splitSign(left);
  const b = splitSign(right);
  if (a.negative || b.negative) {
    const inner = simplifyProduct(a.rest, b.rest);
    return a.negative !== b.negative ? simplifyNeg(inner) : inner;
  }
  // Keep the number in front, and combine 2 * (3 * x) into 6 * x.
  if (isNum(right) && !isNum(left)) return simplifyProduct(right, left);
  if (isNum(left) && right.type === 'binary' && right.op === '*' && isNum(right.left)) {
    return simplifyProduct(num(left.value * right.left.value), right.right);
  }
  return mul(left, right);
}

function simplifyQuotient(left: Node, right: Node): Node {
  if (isNum(left) && isNum(right)) return foldNumbers('/', left.value, right.value) ?? binary('/', left, right);
  if (isValue(right, 1)) return left;
  if (isValue(left, 0) && !isValue(right, 0)) return num(0);
  const a = splitSign(left);
  const b = splitSign(right);
  if (a.negative || b.negative) {
    const inner = simplifyQuotient(a.rest, b.rest);
    return a.negative !== b.negative ? simplifyNeg(inner) : inner;
  }
  if (sameTree(left, right) && !isValue(left, 0)) return num(1);
  return binary('/', left, right);
}

function simplifyPower(left: Node, right: Node): Node {
  if (isNum(left) && isNum(right)) return foldNumbers('^', left.value, right.value) ?? binary('^', left, right);
  if (isValue(right, 1)) return left;
  if (isValue(right, 0)) return num(1);
  if (isValue(left, 1)) return num(1);
  return binary('^', left, right);
}

/** Counts the nodes a rewrite visits, and stops one that grows past its limit with a 'too-deep' error. */
export class Budget {
  private spent = 0;

  constructor(private readonly limit: number) {}

  spend(): void {
    this.spent += 1;
    if (this.spent > this.limit) throw new ExprError('too-deep');
  }
}

/**
 * A simpler tree with the same value. A derivative shares parts, and each part is visited once for every place it is
 * used. So `budget` can stop a tree whose written-out form would be too large.
 */
export function simplify(node: Node, budget?: Budget): Node {
  const visit = (current: Node): Node => {
    budget?.spend();
    switch (current.type) {
      case 'unary':
        if (current.op === '-') return simplifyNeg(visit(current.arg));
        return current.op === '+' ? visit(current.arg) : { ...current, arg: visit(current.arg) };
      case 'postfix':
        return { ...current, arg: visit(current.arg) };
      case 'call':
        return { ...current, args: current.args.map(visit) };
      case 'binary':
        return simplifyBinary(current.op, visit(current.left), visit(current.right), current);
      default:
        return current;
    }
  };
  return visit(node);
}

function simplifyBinary(op: string, left: Node, right: Node, original: Extract<Node, { type: 'binary' }>): Node {
  switch (op) {
    case '+':
    case '-':
      return simplifySum(op, left, right);
    case '*':
      return simplifyProduct(left, right);
    case '/':
      return simplifyQuotient(left, right);
    case '^':
      return simplifyPower(left, right);
    default:
      return { ...original, left, right };
  }
}
