// The calculator's dialect of the shared expression grammar. Names are ASCII. Functions are written with brackets,
// so sin(30) works and sin 30 does not. Side-by-side multiplication such as 2pi and 3(4+1) works, but two numbers in
// a row do not. The postfix signs ! % and the degree sign work, and so does the word "mod". Text longer than 2000
// characters is refused.

import {
  BASE_LEX,
  functionLookup,
  setOf,
  standardFunctions,
  type Dialect,
  type FunctionTable,
} from '../../../core/expr';

/** The longest expression, in characters. */
export const MAX_LENGTH = 2000;

/** How many nested groups, signs, and powers an expression can have. */
export const MAX_DEPTH = 100;

/** The strict function table: angle modes, exact familiar angles, and errors outside a function's domain. */
export const TABLE: FunctionTable = standardFunctions('strict');

/** The canonical names of the functions the calculator offers. */
export const FUNCTION_NAMES: readonly string[] = [
  ...['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'],
  ...['exp', 'ln', 'log', 'log2', 'sqrt', 'cbrt', 'root', 'abs', 'sign', 'floor', 'ceil', 'trunc', 'round'],
  ...['factorial', 'npr', 'ncr', 'mod', 'min', 'max', 'hypot', 'deg', 'rad'],
];

const ALIASES: Readonly<Record<string, string>> = {
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  arsinh: 'asinh',
  arcosh: 'acosh',
  artanh: 'atanh',
  arcsinh: 'asinh',
  arccosh: 'acosh',
  arctanh: 'atanh',
  log10: 'log',
  fact: 'factorial',
  nthroot: 'root',
};

export const CALCULATOR: Dialect = {
  lex: {
    ...BASE_LEX,
    words: { π: 'pi', τ: 'tau', φ: 'phi', '√': 'sqrt' },
    maxLength: MAX_LENGTH,
  },
  infix: setOf('+', '-', '*', '/', '^', 'mod'),
  prefix: setOf('-', '+'),
  postfix: setOf('!', '%', '°'),
  implicit: 'strict',
  functions: functionLookup(TABLE, { names: FUNCTION_NAMES, aliases: ALIASES }),
  calls: 'paren',
  unknownCalls: 'multiply',
  checkArity: true,
  cells: false,
  strictNames: false,
  definitions: false,
  maxDepth: MAX_DEPTH,
};
