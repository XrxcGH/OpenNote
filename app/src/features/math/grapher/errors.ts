// A problem in an expression, with where it is. The engine (core/expr) reports problems as codes with places. The
// grapher shows them under the input box, so this file turns each code into a short sentence.

import { ExprError } from '../../../core/expr';

/** A problem in an expression, with where it is. `position` counts UTF-16 code units from the start. */
export class ExpressionError extends Error {
  readonly position: number;
  readonly length: number;

  constructor(message: string, position: number, length = 1) {
    super(message);
    this.name = 'ExpressionError';
    this.position = position;
    this.length = Math.max(1, length);
  }
}

/** The text of the token that a problem found, or "the end". */
function found(error: ExprError): string {
  return error.code === 'unexpected-end' || error.code === 'unclosed-paren' || error.detail === undefined
    ? 'the end'
    : `"${error.detail}"`;
}

function unexpected(error: ExprError): string {
  switch (error.expected) {
    case 'operand': {
      const hint = error.code === 'unexpected-end' ? ' Something is missing after the last operator.' : '';
      return `Expected a number, a name, or "(" but found ${found(error)}.${hint}`;
    }
    case ')':
      return `Expected a closing bracket ")" but found ${found(error)}.`;
    case 'number':
      return `Expected a number after ^ on a function but found ${found(error)}.`;
    default: {
      const hint = error.detail === '=' ? ' Only "y =" or "f(x) =" can come before an expression.' : '';
      return `Unexpected ${found(error)}.${hint}`;
    }
  }
}

function takes(min: number, max: number): string {
  const count = min === max ? `${min}` : `${min} to ${max}`;
  return `${count} value${count === '1' ? '' : 's'}`;
}

/**
 * Turns an engine error into the grapher's ExpressionError. `source` is the text that was parsed, so a message can
 * say the name as it was typed, and `arity` tells how many values a function takes, by its canonical name.
 */
export function explain(
  error: ExprError,
  source: string,
  arity: (name: string) => { min: number; max: number } | undefined,
): ExpressionError {
  const typed = source.slice(error.position, error.position + error.length);
  const place = (message: string) => new ExpressionError(message, error.position, error.length);
  switch (error.code) {
    case 'empty':
      return place('Type an expression, such as x^2.');
    case 'bad-character':
      return place(`Unexpected character "${error.detail}".`);
    case 'unknown-name':
      return place(`Unknown name "${error.detail}". Declare it as a parameter to use it.`);
    case 'missing-argument':
      return place(`${typed} needs a value after it.`);
    case 'arity': {
      const limits = arity(error.detail ?? typed) ?? { min: 1, max: 1 };
      return place(`${typed} takes ${takes(limits.min, limits.max)} in brackets.`);
    }
    case 'too-deep':
      return place('This expression is nested too deeply.');
    case 'too-long':
      return place('This expression is too long.');
    case 'bad-number':
      return place(`"${error.detail}" is too large to read as a number.`);
    default:
      return place(unexpected(error));
  }
}
