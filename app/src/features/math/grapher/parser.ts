// Reads an expression such as `2x sin(x)^2 + a` into a tree. The shared engine (core/expr) does the reading. This
// file sets the grapher's dialect and drops a leading `y =` or `f(x) =` so that people can type a whole equation.
// It reports problems as ExpressionError values with a sentence and a place, and never runs code from the text.
// Precedence from loosest to tightest: + -, then * / and side-by-side multiplication, then a leading sign, then ^
// (right to left), then !.

import {
  ExprError,
  definitionHead,
  parseTokens,
  splitWords,
  tokenize,
  type Node,
  type Token,
} from '../../../core/expr';
import { VARIABLE, functionInfo, grapherDialect } from './dialect';
import { explain } from './errors';

export type { Node };

export interface ParseOptions {
  /** Names that stand for values you choose, such as the `a` in `a x^2`. The variable is always `x`. */
  readonly parameters?: readonly string[];
}

/** The letters a person can use as parameters: letters only, and not the variable. */
function usableParameters(options: ParseOptions): string[] {
  return (options.parameters ?? []).filter((name) => name !== VARIABLE && /^\p{L}+$/u.test(name));
}

/** Drops a leading `y =` or `f(x) =`, where f is not a function. Anything else with an equals sign stays an error. */
function dropEquationStart(tokens: Token[]): Token[] {
  const head = definitionHead(tokens);
  if (head === null) return tokens;
  const plainY = head.params.length === 0 && head.name.text === 'y';
  const functionOfX =
    head.params.length === 1 && head.params[0].text === VARIABLE && functionInfo(head.name.text) === undefined;
  return plainY || functionOfX ? tokens.slice(head.length) : tokens;
}

function wrap(error: unknown, source: string): never {
  if (!(error instanceof ExprError)) throw error;
  throw explain(error, source, (name) => functionInfo(name));
}

/** Parses `source` into a tree. Throws an ExpressionError that says where the problem is. */
export function parseExpression(source: string, options: ParseOptions = {}): Node {
  try {
    const dialect = grapherDialect(usableParameters(options));
    return parseTokens(dropEquationStart(tokenize(source, dialect.lex)), source, dialect);
  } catch (error) {
    return wrap(error, source);
  }
}

/** The letters in `source` that are not the variable, a constant, or a function, in order of first use. */
export function findParameters(source: string): string[] {
  const found: string[] = [];
  try {
    const dialect = grapherDialect([]);
    const tokens = dropEquationStart(tokenize(source, dialect.lex));
    splitWords(tokens, dialect.split ?? new Set(), (letter) => {
      if (!found.includes(letter)) found.push(letter);
    });
  } catch (error) {
    if (!(error instanceof ExprError)) throw error;
    throw explain(error, source, () => undefined);
  }
  return found;
}
