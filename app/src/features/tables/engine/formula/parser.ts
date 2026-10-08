// Reads formula text into the shared syntax tree (core/expr). The grammar is the engine's, with this precedence from
// loosest to tightest: compare, & (join text), + and -, * and /, a leading sign or square root, ^ (right to left),
// and the percent sign. So -2^2 is -4 and 2^-1 is 0.5, as in textbooks and calculators.

import { ExprError, parse, type Node } from '../../../../core/expr';
import { formulaDialect } from './dialect';
import { STORED, type Syntax } from './lexer';
import { describeProblem, type FormulaProblem } from './problems';

export type ParseResult = { ok: true; node: Node } | { ok: false; problem: FormulaProblem };

/** Parses formula text, which has no leading "=". Never throws. */
export function parseFormula(src: string, syntax: Syntax = STORED): ParseResult {
  try {
    if (src.trim() === '') return { ok: false, problem: { message: 'Type a formula.', pos: 0 } };
    return { ok: true, node: parse(src, formulaDialect(syntax)) };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, problem: describeProblem(e) };
    throw e;
  }
}
