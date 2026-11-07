// The formula dialect is the engine's spreadsheet dialect (core/expr/sheet.ts) with Excel's rules (ADR 0058):
// -2^2 is 4, 2^3^2 is 64, and E is a name. Formulas are stored in one form (period decimal mark, comma separator).
// People type them in their region's form (comma decimal mark, semicolon separator), so the dialect takes a syntax.
// Functions are not known to the grammar: any name followed by brackets is a call, and the formula compiler decides
// whether the function exists. Formulas from tables written before these rules pass through legacy.ts first.

import { sheetDialect, type Dialect } from '../../../../core/expr';
import type { Syntax } from './lexer';

/** The dialect for formulas written with this decimal mark and separator. */
export function formulaDialect(syntax: Syntax): Dialect {
  return sheetDialect({ decimal: syntax.decimal, separator: syntax.separator, rules: 'excel' });
}
