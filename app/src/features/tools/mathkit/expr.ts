// The kit's helpers on the shared expression engine (core/expr): read text into a tree, run a tree with named
// variables, differentiate it, and write a tree back as tidy text or LaTeX. Nothing here runs text as code: trees
// become closures over the engine's fixed operations.
import {
  compileNode,
  differentiate as differentiateNode,
  formatExpression,
  GENERAL,
  mathConstant,
  parse,
  simplify,
  standardFunctions,
  type Node,
} from '../../../core/expr';
import { KitError } from './types';

export type { Node };

const TABLE = standardFunctions('strict');

/** Reads expression text. A missing multiplication sign between a number and a letter is a product. */
export function read(text: string): Node {
  const source = text.trim();
  if (!source) throw new KitError('empty');
  try {
    const plain = source
      .replace(/\*\*/g, '^')
      .replace(/[·×]/g, '*')
      .replace(/−/g, '-')
      .replace(/π/g, 'pi')
      .replace(/θ/g, 'theta')
      .replace(/φ/g, 'phi');
    return parse(plain, GENERAL);
  } catch {
    throw new KitError('unreadable', source);
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
 * A tree as a function of the named variables, in order. A variable shadows a constant of the same name. Where the
 * expression is not defined the function gives NaN; it never throws.
 */
export function compile(node: Node, variables: readonly string[]): Fn {
  const missing = [...namesIn(node)].filter((name) => !variables.includes(name));
  if (missing.length) throw new KitError('unknown-name', missing[0]);
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

/** Reads and compiles text as a function of the named variables. Other names are an error. */
export function readFunction(text: string, variables: readonly string[]): Fn {
  return compile(read(text), variables);
}

export function tidy(node: Node): Node {
  try {
    return simplify(node);
  } catch {
    return node;
  }
}

/** The partial derivative of a tree, simplified. */
export function derivative(node: Node, variable: string): Node {
  return tidy(differentiateNode(node, variable));
}

/** A tree as plain expression text. */
export function show(node: Node): string {
  return formatExpression(tidy(node));
}

/** Expression text as LaTeX, for the common shapes: powers, fractions, and function names. */
export function latexOf(text: string): string {
  let s = text.trim();
  s = s.replace(/\*\*/g, '^').replace(/\bpi\b/g, '\\pi ');
  s = s.replace(/\b(sin|cos|tan|ln|exp|sinh|cosh|tanh|asin|acos|atan|log)\(/g, '\\$1(');
  s = s.replace(/\bsqrt\(([^()]*)\)/g, '\\sqrt{$1}');
  s = s.replace(/\*/g, ' \\cdot ');
  s = s.replace(/\^\(([^()]*)\)/g, '^{$1}').replace(/\^(-?[A-Za-z0-9.]+)/g, '^{$1}');
  return s;
}

/** The first number in a trusted text, NaN when it is not a number. */
export function numberOf(text: string): number {
  try {
    const value = compile(read(text.trim() || 'nan'), [])([]);
    return value;
  } catch {
    return NaN;
  }
}
