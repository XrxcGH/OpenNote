// Expressions in more than one variable, such as z = x^2 - y^2, the x(t) of a parametric curve, or r(θ) of a polar
// one. The grapher's dialect and the shared engine (core/expr) read and compile the text, as for y = f(x), so the
// rules are the same everywhere: `2xy` is 2 times x times y, angles are radians, and text is never run as code.
import {
  asExprError,
  compileNode,
  differentiate,
  formatExpression,
  type Compiled,
  type Node,
} from '../../../core/expr';
import { CONSTANTS, TABLE, functionInfo } from '../grapher/dialect';
import { ExpressionError, explain } from '../grapher/errors';
import type { ExpressionProblem } from '../grapher/evaluate';
import { parseExpression } from '../grapher/parser';

export type Values = Readonly<Record<string, number>>;

export interface MultiExpression {
  readonly source: string;
  /** The expression's text after the engine has read it, such as a derivative's. */
  readonly text: string;
  readonly variables: readonly string[];
  /** The value at these variables and parameters. NaN where the expression is not defined. */
  readonly evaluate: (values: Values) => number;
}

export type MultiResult =
  | { readonly ok: true; readonly expression: MultiExpression; readonly node: Node }
  | { readonly ok: false; readonly error: ExpressionProblem };

/** Spelled-out Greek letters people type for an angle. The engine reads θ as one letter. */
const GREEK: Readonly<Record<string, string>> = { theta: 'θ', phi: 'φ' };

/** `theta` becomes θ, so `r = 1 + cos theta` reads as one letter and not t·h·e·t·a. */
export function greekWords(source: string): string {
  return source.replace(/\b(theta|phi)\b/g, (word) => GREEK[word]);
}

const HEAD = /^\s*([\p{L}]+)\s*(?:\(\s*[\p{L}]+(?:\s*,\s*[\p{L}]+)*\s*\))?\s*=(?!=)/u;

/**
 * Drops a leading `z =`, `f(x, y) =`, `r(θ) =`, or `x(t) =` so people can type the whole equation. The head is
 * replaced by spaces, so a problem's position still points at the right character.
 */
export function dropHead(source: string): string {
  const head = HEAD.exec(source);
  if (!head || functionInfo(head[1]) !== undefined) return source;
  return ' '.repeat(head[0].length) + source.slice(head[0].length);
}

interface Frame {
  values: Values;
}

function binder(names: ReadonlySet<string>): (name: string) => Compiled<Frame> | undefined {
  return (name) => {
    if (names.has(name)) return (frame) => (Object.hasOwn(frame.values, name) ? frame.values[name] : NaN);
    if (Object.hasOwn(CONSTANTS, name)) {
      const value = CONSTANTS[name];
      return () => value;
    }
    return undefined;
  };
}

function build(node: Node, source: string, variables: readonly string[], names: ReadonlySet<string>): MultiResult {
  const run = compileNode<Frame>(node, { strict: false, table: TABLE, bind: binder(names) });
  const frame: Frame = { values: {} };
  const expression: MultiExpression = {
    source,
    text: formatExpression(node),
    variables,
    evaluate: (values) => {
      frame.values = values;
      return run(frame);
    },
  };
  return { ok: true, expression, node };
}

function failure(error: unknown, source: string): MultiResult {
  if (error instanceof ExpressionError) {
    return { ok: false, error: { message: error.message, position: error.position, length: error.length } };
  }
  const found = asExprError(error);
  if (found === null) throw error;
  const explained = explain(found, source, functionInfo);
  return { ok: false, error: { message: explained.message, position: explained.position, length: explained.length } };
}

/**
 * Reads `source` as a function of `variables` (and of `parameters`, whose values come with the call). A mistake
 * comes back as `error` with its place, never as a throw.
 */
export function compileMulti(
  source: string,
  variables: readonly string[],
  parameters: readonly string[] = [],
): MultiResult {
  const text = dropHead(greekWords(source));
  const names = new Set([...variables, ...parameters]);
  try {
    const node = parseExpression(text, { parameters: [...names] });
    return build(node, source, variables, names);
  } catch (error) {
    return failure(error, text);
  }
}

/** The partial derivative of `source` with respect to `variable`, worked out exactly, ready to evaluate. */
export function partialDerivative(
  source: string,
  variable: string,
  variables: readonly string[],
  parameters: readonly string[] = [],
): MultiResult {
  const read = compileMulti(source, variables, parameters);
  if (!read.ok) return read;
  try {
    const node = differentiate(read.node, variable);
    return build(node, source, variables, new Set([...variables, ...parameters]));
  } catch (error) {
    const found = asExprError(error);
    if (found === null) throw error;
    const message = `${found.detail ?? 'This'} has no derivative that can be written down.`;
    return { ok: false, error: { message, position: found.position, length: Math.max(1, found.length) } };
  }
}

/**
 * The letters in `source` that are not one of `variables`, a constant, or a function: the ones that need a slider.
 * Spelled-out Greek counts as its letter.
 */
export function multiParameters(source: string, variables: readonly string[]): string[] {
  const text = dropHead(greekWords(source));
  const found: string[] = [];
  const skip = new Set(variables);
  // Letters split the way the grapher splits them: each name that is not a function or a constant is one letter.
  const words = text.match(/\p{L}+/gu) ?? [];
  for (const word of words) {
    if (functionInfo(word) !== undefined || Object.hasOwn(CONSTANTS, word)) continue;
    for (const letter of splitLetters(word)) {
      if (!skip.has(letter) && !found.includes(letter)) found.push(letter);
    }
  }
  return found;
}

/** A run of letters as the names it stands for: functions and constants whole, other letters one at a time. */
function splitLetters(word: string): string[] {
  const out: string[] = [];
  let index = 0;
  while (index < word.length) {
    let taken = 1;
    for (let end = word.length; end > index + 1; end--) {
      const part = word.slice(index, end);
      if (functionInfo(part) !== undefined || Object.hasOwn(CONSTANTS, part)) {
        taken = end - index;
        break;
      }
    }
    const part = word.slice(index, index + taken);
    if (taken === 1 && functionInfo(part) === undefined && !Object.hasOwn(CONSTANTS, part)) out.push(part);
    index += taken;
  }
  return out;
}
