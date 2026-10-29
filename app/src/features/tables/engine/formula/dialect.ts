// The formula dialect is the engine's spreadsheet dialect (core/expr/sheet.ts). Formulas are stored in one form
// (period decimal mark, comma separator). People type them in their region's form (comma decimal mark, semicolon
// separator), so the dialect takes a syntax. Functions are not known to the grammar: any name followed by brackets
// is a call, and the formula compiler decides whether the function exists.

import { sheetDialect, type Dialect } from '../../../../core/expr';
import type { Syntax } from './lexer';

/** The dialect for formulas written with this decimal mark and separator. */
export function formulaDialect(syntax: Syntax): Dialect {
  return sheetDialect(syntax);
}
