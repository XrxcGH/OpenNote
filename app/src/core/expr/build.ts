// Makes trees by hand, for code that builds an expression instead of reading one: the derivative, the simplifier, and
// tests. Every node made here has an empty place (all positions 0), since it did not come from source text.

import type { BinaryNode, CallNode, Node, NumNode } from './ast';
import { numberText } from './print';

const SPAN = { start: 0, end: 0, pos: 0 } as const;

export function num(value: number): NumNode {
  return { type: 'num', value, text: numberText(value), ...SPAN };
}

export function name(text: string): Node {
  return { type: 'name', name: text, ...SPAN };
}

export function neg(arg: Node): Node {
  return { type: 'unary', op: '-', arg, ...SPAN };
}

export function binary(op: BinaryNode['op'], left: Node, right: Node): BinaryNode {
  return { type: 'binary', op, left, right, ...SPAN };
}

export const add = (left: Node, right: Node): Node => binary('+', left, right);
export const sub = (left: Node, right: Node): Node => binary('-', left, right);
export const mul = (left: Node, right: Node): Node => binary('*', left, right);
export const div = (left: Node, right: Node): Node => binary('/', left, right);
export const pow = (left: Node, right: Node): Node => binary('^', left, right);

export function call(fn: string, ...args: Node[]): CallNode {
  return { type: 'call', name: fn, args, ...SPAN };
}

/** True when the name appears anywhere in the tree. */
export function dependsOn(node: Node, variable: string): boolean {
  switch (node.type) {
    case 'name':
      return node.name === variable;
    case 'unary':
    case 'postfix':
      return dependsOn(node.arg, variable);
    case 'binary':
      return dependsOn(node.left, variable) || dependsOn(node.right, variable);
    case 'call':
      return node.args.some((arg) => dependsOn(arg, variable));
    default:
      return false;
  }
}
