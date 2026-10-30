// Reads the custom model typed by the student into a function of x and the fit parameters. The text goes through the
// expression engine (core/expr), which builds closures over its own fixed operations; nothing is run as code.
import { compileNode, GENERAL, mathConstant, parse, standardFunctions } from '../../../../core/expr';
import type { Node } from '../../../../core/expr';

const TABLE = standardFunctions('strict');

/** Reads the text, or returns null when it is not an expression. */
export function readExpression(text: string): Node | null {
  const plain = text.trim().replace(/\*\*/g, '^').replace(/[·×]/g, '*').replace(/−/g, '-');
  if (plain === '') return null;
  try {
    return parse(plain, GENERAL);
  } catch {
    return null;
  }
}

/** The names the expression uses that are not constants such as pi, in the order they first appear. */
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

/** The expression as a function of the named variables, in order. Where it is undefined it gives NaN. */
export function compileExpression(node: Node, variables: readonly string[]): (values: readonly number[]) => number {
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
