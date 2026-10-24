// Turns a parsed expression into a plain function of x. The text is never run as code. The shared engine
// (core/expr) turns the tree into a chain of closures over a fixed set of operations, so a bad or hostile
// expression can only return a number. Where an expression is not defined it returns NaN, or Infinity, and the
// graph shows a gap there.

import {
  asExprError,
  compileNode,
  differentiate,
  formatExpression,
  type Compiled,
  type Node,
} from '../../../core/expr';
import { CONSTANTS, TABLE, VARIABLE, functionInfo } from './dialect';
import { ExpressionError, explain } from './errors';
import { parseExpression, type ParseOptions } from './parser';

/** The values of the parameters, by name. A parameter with no value makes the result NaN. */
export type Params = Readonly<Record<string, number>>;

const NO_PARAMS: Params = {};

/** What a compiled expression reads each time it runs. */
interface Frame {
  x: number;
  params: Params;
}

/** An expression ready to evaluate. */
export interface CompiledExpression {
  readonly source: string;
  readonly parameters: readonly string[];
  /** The value at `x`, NaN where the expression is not defined. Infinity is possible, such as 1/0. */
  readonly evaluate: (x: number, params?: Params) => number;
}

/** What went wrong and where, for showing under the input box. */
export interface ExpressionProblem {
  readonly message: string;
  readonly position: number;
  readonly length: number;
}

export type CompileResult =
  | { readonly ok: true; readonly expression: CompiledExpression }
  | { readonly ok: false; readonly error: ExpressionProblem };

/** The reader for a name: the variable, a parameter (which shadows a constant), or a constant. */
function binder(parameters: ReadonlySet<string>): (name: string) => Compiled<Frame> | undefined {
  return (name) => {
    if (name === VARIABLE) return (frame) => frame.x;
    if (parameters.has(name)) return (frame) => (Object.hasOwn(frame.params, name) ? frame.params[name] : NaN);
    if (Object.hasOwn(CONSTANTS, name)) {
      const value = CONSTANTS[name];
      return () => value;
    }
    return undefined;
  };
}

function build(node: Node, source: string, parameters: readonly string[]): CompiledExpression {
  const run = compileNode<Frame>(node, {
    strict: false,
    table: TABLE,
    bind: binder(new Set(parameters)),
  });
  const frame: Frame = { x: 0, params: {} };
  return {
    source,
    parameters,
    evaluate: (x, params = NO_PARAMS) => {
      frame.x = x;
      frame.params = params;
      return run(frame);
    },
  };
}

function problem(error: ExpressionError): ExpressionProblem {
  return { message: error.message, position: error.position, length: error.length };
}

/** Parses and compiles `source`. A mistake in the text comes back as `error` with its position, never as a throw. */
export function compileExpression(source: string, options: ParseOptions = {}): CompileResult {
  try {
    const expression = build(parseExpression(source, options), source, options.parameters ?? []);
    return { ok: true, expression };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, error: problem(error) };
    const found = asExprError(error);
    if (found === null) throw error;
    return { ok: false, error: problem(explain(found, source, functionInfo)) };
  }
}

/** The derivative of an expression with respect to x, ready to evaluate, and its text for showing. */
export type DerivativeResult =
  | { readonly ok: true; readonly expression: CompiledExpression; readonly text: string }
  | { readonly ok: false; readonly error: ExpressionProblem };

/**
 * The derivative of `source` with respect to x, `order` times (default once). Parameters count as constants.
 * A function with no derivative everywhere, such as floor or mod by x, comes back as `error` at that function.
 */
export function differentiateExpression(source: string, options: ParseOptions = {}, order = 1): DerivativeResult {
  try {
    const node = differentiate(parseExpression(source, options), VARIABLE, order);
    const text = formatExpression(node);
    return { ok: true, expression: build(node, text, options.parameters ?? []), text };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, error: problem(error) };
    const found = asExprError(error);
    if (found === null) throw error;
    if (found.code === 'too-deep') {
      const message = 'This derivative is too large to work out.';
      return { ok: false, error: { message, position: 0, length: Math.max(1, source.length) } };
    }
    const message = `${found.detail ?? 'This'} has no derivative that can be written down.`;
    return { ok: false, error: { message, position: found.position, length: Math.max(1, found.length) } };
  }
}
