// The spreadsheet dialect: cell references and ranges (A1, $B$3, B2:C9, B:B), [Column names], {column ids}, "text",
// TRUE and FALSE, comparisons, & to join text, the percent sign, and the square root sign. There is no side-by-side
// multiplication, so `2 3` and `2x` are mistakes, as they are in a spreadsheet. Any name followed by brackets is a
// call, and the host decides later whether the function exists. The syntax says which decimal mark and separator
// the text uses, because people type formulas in their region's form.

import { BASE_LEX, setOf, type Dialect } from './dialect';

export interface SheetSyntax {
  decimal: '.' | ',';
  separator: ',' | ';';
}

const OPERATORS = ['+', '-', '*', '/', '^', '%', '&', '=', '<', '>', '<=', '>=', '<>', '√'];
const ALIASES: Readonly<Record<string, string>> = {
  '−': '-',
  '×': '*',
  '÷': '/',
  '≤': '<=',
  '≥': '>=',
  '≠': '<>',
};

/** The longest formula, in characters. Generous for anything typed, and a bound on what a stored note holds. */
export const MAX_FORMULA_LENGTH = 10_000;

const cache = new Map<string, Dialect>();

/** The dialect for text written with this decimal mark and separator. Built once per syntax. */
export function sheetDialect(syntax: SheetSyntax): Dialect {
  const key = `${syntax.decimal}${syntax.separator}`;
  let dialect = cache.get(key);
  if (dialect === undefined) {
    dialect = {
      lex: {
        ...BASE_LEX,
        decimal: syntax.decimal,
        // A semicolon always separates arguments, and so does the comma when it is not the decimal mark.
        separators: syntax.separator === ';' ? ';' : ';,',
        names: 'cell',
        operators: OPERATORS,
        aliases: ALIASES,
        superscripts: false,
        maxLength: MAX_FORMULA_LENGTH,
        strings: true,
        brackets: true,
        colon: true,
      },
      infix: setOf('+', '-', '*', '/', '^', '&', '=', '<>', '<', '>', '<=', '>='),
      prefix: setOf('-', '+', '√'),
      postfix: setOf('%'),
      implicit: 'none',
      calls: 'paren',
      unknownCalls: 'call',
      callName: (text) => text.toUpperCase(),
      checkArity: false,
      cells: true,
      keywords: { TRUE: true, FALSE: false, PI: Math.PI, E: Math.E },
      strictNames: true,
      definitions: false,
      maxDepth: 200,
    };
    cache.set(key, dialect);
  }
  return dialect;
}
