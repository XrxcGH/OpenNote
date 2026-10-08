// The general-purpose dialect and the calls most code wants: parse a string, evaluate it, and get a result value
// back instead of an exception. The calculator, the grapher, and the table formulas build their own dialects from
// the same pieces. Use this one for tests, tools, and anything that needs "a scientific calculator's grammar".

import type { Node } from './ast';
import { mathConstant } from './constants';
import { BASE_LEX, setOf, type Dialect } from './dialect';
import { attempt, type Outcome } from './errors';
import { compileNode } from './compile';
import { standardFunctions } from './functions';
import { COMMON_ALIASES, functionLookup } from './lookup';
import { parse } from './parser';
import { snap } from './numeric';
import type { AngleMode } from './trig';

const TABLE = standardFunctions('strict');

/** Everything in the strict table except the names that are more useful as variables. */
const GENERAL_NAMES = Object.keys(TABLE).filter((name) => !['deg', 'rad', 'pow', 'sec', 'csc', 'cot'].includes(name));

export const GENERAL: Dialect = {
  lex: {
    ...BASE_LEX,
    operators: [...BASE_LEX.operators, '='],
    words: { π: 'pi', τ: 'tau', φ: 'phi', '√': 'sqrt' },
    maxLength: 2000,
  },
  infix: setOf('+', '-', '*', '/', '^', 'mod'),
  prefix: setOf('-', '+'),
  postfix: setOf('!', '%', '°'),
  implicit: 'strict',
  functions: functionLookup(TABLE, {
    names: GENERAL_NAMES,
    aliases: { ...COMMON_ALIASES, fact: 'factorial', log10: 'log' },
  }),
  calls: 'paren',
  unknownCalls: 'multiply',
  checkArity: true,
  cells: false,
  strictNames: false,
  definitions: true,
  maxDepth: 100,
};

export interface EvaluateOptions {
  /** Values for names, in addition to pi, e, tau, and phi. */
  variables?: Readonly<Record<string, number>>;
  /** The angle mode for trigonometry and the degree sign. Default 'rad'. */
  angle?: AngleMode;
}

/** Parses without throwing. */
export function tryParse(source: string, dialect: Dialect = GENERAL): Outcome<Node> {
  return attempt(() => parse(source, dialect));
}

/**
 * Parses and evaluates with the general dialect, a strict evaluator, and sums rounded to 15 digits. Returns a result
 * value: the number, or the problem with its place. Never throws for text, however odd.
 */
export function evaluate(source: string, options: EvaluateOptions = {}): Outcome<number> {
  return attempt(() => {
    const node = parse(source, GENERAL);
    const variables = options.variables ?? {};
    const run = compileNode<void>(node, {
      strict: true,
      snap: true,
      table: TABLE,
      angle: () => options.angle ?? 'rad',
      bind: (name) => {
        const value = Object.hasOwn(variables, name) ? variables[name] : mathConstant(name);
        return value === undefined ? undefined : () => value;
      },
    });
    return snap(run());
  });
}
