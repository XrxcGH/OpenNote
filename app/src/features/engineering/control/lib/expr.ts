// The kit's helpers on the expression engine (core/expr): read text into a tree and run a tree with named
// variables. Nothing here runs text as code: trees become closures over the engine's fixed operations. Ported from
// the math solvers so the kit keeps within its own feature.
import { compileNode, GENERAL, mathConstant, parse, standardFunctions, type Node } from '../../../../core/expr';

const TABLE = standardFunctions('strict');

/** Why an expression could not be read or run. The tools turn the code into words. */
export class ExprError extends Error {
  constructor(
    readonly code: string,
    readonly detail = '',
  ) {
    super(code);
  }
}

/** Reads expression text with the general dialect. A missing multiplication sign between letters is a name. */
export function read(text: string): Node {
  const source = text.trim();
  if (!source) throw new ExprError('empty');
  try {
    const plain = source
      .replace(/\*\*/g, '^')
      .replace(/[·×]/g, '*')
      .replace(/−/g, '-')
      .replace(/θ/g, 'theta')
      .replace(/ρ/g, 'rho')
      .replace(/[φϕ]/g, 'phi');
    return parse(plain, GENERAL);
  } catch {
    throw new ExprError('unreadable', source);
  }
}

/** The names a tree reads that are not constants. */
export function namesIn(node: Node, out = new Set<string>()): Set<string> {
  switch (node.type) {
    case 'name':
      if (mathConstant(node.name) === undefined) out.add(node.name);
      break;
    case 'unary':
    case 'postfix':
      namesIn(node.arg, out);
      break;
    case 'binary':
      namesIn(node.left, out);
      namesIn(node.right, out);
      break;
    case 'call':
      for (const arg of node.args) namesIn(arg, out);
      break;
    default:
  }
  return out;
}

export type Fn = (values: readonly number[]) => number;

/**
 * A tree as a function of the named variables, in order. A variable shadows a constant of the same name, so phi can
 * be the polar angle. Where the expression is not defined the function gives NaN; it never throws.
 */
export function compile(node: Node, variables: readonly string[]): Fn {
  const missing = [...namesIn(node)].filter((name) => !variables.includes(name));
  if (missing.length) throw new ExprError('unknown-name', missing[0]);
  const run = compileNode<readonly number[]>(node, {
    strict: false,
    table: TABLE,
    bind: (name) => {
      const at = variables.indexOf(name);
      if (at >= 0) return (frame) => frame[at];
      const value = mathConstant(name);
      return value === undefined ? undefined : () => value;
    },
  });
  return (values) => {
    try {
      return run(values);
    } catch {
      return NaN;
    }
  };
}

/** A one-variable function. */
export function compile1(node: Node, variable: string): (x: number) => number {
  const fn = compile(node, [variable]);
  return (x) => fn([x]);
}

/** True when the tree has no variables: it has only numbers, constants, or both. */
export const isConstant = (node: Node): boolean => namesIn(node).size === 0;

/** The value of a tree with no variables. */
export const valueOf = (node: Node): number => compile(node, [])([]);

export type { Node };
