// Reads formula text into the shared syntax tree (core/expr) with Excel's rules (ADR 0058), from loosest to tightest:
// compare, & (join text), + and -, * and /, ^ (left to right), the percent sign, a leading sign, and the reference
// operators. So -2^2 is 4 and 2^3^2 is 64. A formula from a table without data.sheet.v was written with the textbook
// rules (-2^2 is -4), and legacy.ts rewrites it first so it keeps that meaning.

import { ExprError, parse, type Node } from '../../../../core/expr';
import { formulaDialect } from './dialect';
import { rewriteLegacy } from './legacy';
import { STORED, type Syntax } from './lexer';
import { describeProblem, type FormulaProblem } from './problems';

export type ParseResult = { ok: true; node: Node } | { ok: false; problem: FormulaProblem };

export interface ParseOptions {
  /**
   * True for a formula from a table without data.sheet.v, read with the old textbook rules. Default true, so text
   * outside a table with the new rules, such as quick math in a note, keeps the meaning it always had.
   */
  legacy?: boolean;
}

/** Parses formula text, which has no leading "=". Never throws. */
export function parseFormula(src: string, syntax: Syntax = STORED, options: ParseOptions = {}): ParseResult {
  try {
    if (src.trim() === '') return { ok: false, problem: { message: 'Type a formula.', pos: 0 } };
    const text = options.legacy === false ? src : rewriteLegacy(src, syntax);
    return { ok: true, node: parse(text, formulaDialect(syntax)) };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, problem: describeProblem(e) };
    throw e;
  }
}
