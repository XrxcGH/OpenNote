// Reads the formulas students type into the dynamics tools (x(t), forcing F(t), kinetic and potential energy) with
// the shared expression engine. Text is parsed into a tree and compiled to a closure; nothing is run as code.
import { compileNode, freeNames, GENERAL, standardFunctions, tryParse } from '../../../core/expr';
import type { Node } from '../../../core/expr';

const TABLE = standardFunctions('plain');
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

export type ReadExpr = { ok: true; node: Node } | { ok: false; error: 'exprSyntax' | 'exprUnknown'; name?: string };

/** Parses text and checks that every free name is one of `names` or a constant. */
export function readExpr(text: string, names: readonly string[]): ReadExpr {
  const parsed = tryParse(text.trim() === '' ? '0' : text, GENERAL);
  if (!parsed.ok) return { ok: false, error: 'exprSyntax' };
  for (const name of freeNames(parsed.value)) {
    if (!names.includes(name) && !(name in CONSTANTS)) return { ok: false, error: 'exprUnknown', name };
  }
  return { ok: true, node: parsed.value };
}

/** Compiles a tree to a function of the values of `names`, in order. Bad arithmetic gives NaN, never a throw. */
export function compileExpr(node: Node, names: readonly string[]): (values: readonly number[]) => number {
  const index = new Map(names.map((name, i) => [name, i]));
  const run = compileNode<readonly number[]>(node, {
    strict: false,
    table: TABLE,
    bind: (name) => {
      const i = index.get(name);
      if (i !== undefined) return (values) => values[i];
      const constant = CONSTANTS[name];
      return constant === undefined ? undefined : () => constant;
    },
  });
  return (values) => {
    try {
      return run(values);
    } catch {
      return Number.NaN;
    }
  };
}
