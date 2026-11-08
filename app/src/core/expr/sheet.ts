// The spreadsheet dialect: cell references and ranges (A1, $B$3, B2:C9, B:B), [Column names], {column ids}, "text",
// TRUE and FALSE, comparisons, & to join text, the percent sign, and the square root sign. There is no side-by-side
// multiplication, so `2 3` and `2x` are mistakes, as they are in a spreadsheet. Any name followed by brackets is a
// call, and the host decides later whether the function exists. The syntax says which decimal mark and separator
// the text uses, because people type formulas in their region's form.
//
// Two sets of rules share this grammar. 'textbook' is the default: -2^2 is -4, 2^3^2 is 512, and E is the constant e.
// Table formulas use 'excel' (ADR 0058).
// - A leading sign binds tighter than "^", and "^" groups left to right. So -2^2 is 4 and 2^3^2 is 64.
// - E is a name, not a constant.
// - Typed numbers keep 15 significant digits.
// - The reference grammar adds array constants, A1#, "@", the space and union operators, Sheet!A1, structured
//   references, and whole rows.
// R1C1 references read when `r1c1` gives the cell they are relative to.

import { BASE_LEX, setOf, type Dialect } from './dialect';

export interface SheetSyntax {
  decimal: '.' | ',';
  separator: ',' | ';';
  /** Default 'textbook'. */
  rules?: 'excel' | 'textbook';
  /** The cell R1C1 references are relative to, zero-based. Only with the 'excel' rules. */
  r1c1?: { readonly row: number; readonly col: number };
}

const OPERATORS = ['+', '-', '*', '/', '^', '%', '&', '=', '<', '>', '<=', '>=', '<>', '√'];
const EXCEL_OPERATORS = [...OPERATORS, '@', '#', '!'];
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

/** Excel keeps 15 significant digits of a typed number. */
const EXCEL_DIGITS = 15;

const cache = new Map<string, Dialect>();

/** The dialect for text written with this decimal mark and separator. Built once per syntax. */
export function sheetDialect(syntax: SheetSyntax): Dialect {
  const excel = syntax.rules === 'excel';
  const key = `${syntax.decimal}${syntax.separator}${excel ? 'x' : 't'}`;
  if (syntax.r1c1 !== undefined) return { ...sheetDialect({ ...syntax, r1c1: undefined }), r1c1: syntax.r1c1 };
  let dialect = cache.get(key);
  if (dialect === undefined) {
    dialect = {
      lex: {
        ...BASE_LEX,
        decimal: syntax.decimal,
        // A semicolon always separates arguments, and so does the comma when it is not the decimal mark.
        separators: syntax.separator === ';' ? ';' : ';,',
        names: 'cell',
        operators: excel ? EXCEL_OPERATORS : OPERATORS,
        aliases: ALIASES,
        superscripts: false,
        maxLength: MAX_FORMULA_LENGTH,
        strings: true,
        brackets: true,
        colon: true,
        ...(excel ? { quotedNames: true, nestedBrackets: true, errorLiterals: true } : {}),
      },
      infix: setOf('+', '-', '*', '/', '^', '&', '=', '<>', '<', '>', '<=', '>='),
      prefix: excel ? setOf('-', '+', '√', '@') : setOf('-', '+', '√'),
      postfix: setOf('%'),
      implicit: 'none',
      calls: 'paren',
      unknownCalls: 'call',
      callName: (text) => text.toUpperCase(),
      checkArity: false,
      cells: true,
      keywords: excel
        ? { TRUE: true, FALSE: false, PI: Math.PI }
        : { TRUE: true, FALSE: false, PI: Math.PI, E: Math.E },
      strictNames: !excel,
      definitions: false,
      maxDepth: 200,
      ...(excel
        ? {
            signBindsTighter: true,
            powerAssociativity: 'left',
            inputDigits: EXCEL_DIGITS,
            excelRefs: true,
            emptyArguments: true,
          }
        : {}),
    };
    cache.set(key, dialect);
  }
  return dialect;
}
