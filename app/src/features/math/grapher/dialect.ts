// The grapher's dialect of the shared expression grammar (core/expr). Letters split into names, so `pix` is pi
// times x. Anything side by side multiplies. A function takes brackets or none: sin x, sin 2x, sin^2(x), and
// sin^-1(x) all work. The factorial sign is allowed. Functions follow floating point: outside its domain a function
// gives NaN or Infinity, and the graph shows a gap. Angles are radians.

import {
  BASE_LEX,
  functionLookup,
  setOf,
  standardFunctions,
  type Dialect,
  type FunctionInfo,
  type FunctionTable,
  type LexSpec,
} from '../../../core/expr';

/** The longest expression, in characters. Generous for anything typed, and a bound on pasted text. */
export const MAX_LENGTH = 10_000;

/** The variable. Every other letter that is not a function or a constant is a parameter. */
export const VARIABLE = 'x';

export const TABLE: FunctionTable = standardFunctions('plain');

/** Constants by name. `deg` is a constant here (90deg is pi/2), not the degrees function. */
export const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  π: Math.PI,
  tau: 2 * Math.PI,
  τ: 2 * Math.PI,
  e: Math.E,
  deg: Math.PI / 180,
};

const NAMES = [
  ...['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'atan2', 'sqrt', 'cbrt', 'exp', 'ln'],
  ...['log', 'log2', 'log10', 'abs', 'floor', 'ceil', 'round', 'trunc', 'min', 'max', 'hypot', 'pow', 'mod'],
  ...['gamma', 'fact', 'asin', 'acos', 'atan', 'asinh', 'acosh', 'atanh', 'sign'],
];

const ALIASES: Readonly<Record<string, string>> = {
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  arcsinh: 'asinh',
  arccosh: 'acosh',
  arctanh: 'atanh',
  sgn: 'sign',
};

/** Every name typed as a function, aliases included. A run of letters splits at these. */
export const FUNCTION_NAMES: readonly string[] = [...NAMES, ...Object.keys(ALIASES)];

const lookup = functionLookup(TABLE, { names: NAMES, aliases: ALIASES, caseSensitive: true });

export function functionInfo(name: string): FunctionInfo | undefined {
  return lookup(name);
}

const BASE_NAMES: ReadonlySet<string> = new Set([...FUNCTION_NAMES, ...Object.keys(CONSTANTS), VARIABLE]);

/** The lexer settings never change, so one object serves every dialect and its compiled form is reused. */
const LEX: LexSpec = {
  ...BASE_LEX,
  names: 'letters',
  operators: ['+', '-', '*', '/', '^', '!', '='],
  words: { '√': 'sqrt' },
  maxLength: MAX_LENGTH,
};

const INFIX = setOf('+', '-', '*', '/', '^');
const PREFIX = setOf('-', '+');
const POSTFIX = setOf('!');

const splitSets = new Map<string, ReadonlySet<string>>();

/** The names a run of letters can split into, with these parameters. Sets are kept for the last few lists. */
function splitNames(parameters: readonly string[]): ReadonlySet<string> {
  if (parameters.length === 0) return BASE_NAMES;
  const key = parameters.join(',');
  let names = splitSets.get(key);
  if (names === undefined) {
    if (splitSets.size >= 64) splitSets.clear();
    names = new Set([...BASE_NAMES, ...parameters]);
    splitSets.set(key, names);
  }
  return names;
}

/** The dialect for an expression whose extra letters (the parameters) are `parameters`. */
export function grapherDialect(parameters: readonly string[]): Dialect {
  return {
    lex: LEX,
    infix: INFIX,
    prefix: PREFIX,
    postfix: POSTFIX,
    implicit: 'free',
    functions: lookup,
    calls: 'bare',
    unknownCalls: 'multiply',
    checkArity: true,
    split: splitNames(parameters),
    cells: false,
    strictNames: false,
    definitions: false,
    maxDepth: 200,
  };
}
