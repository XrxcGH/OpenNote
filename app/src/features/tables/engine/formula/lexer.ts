// Formulas are stored in one form (period decimal mark, comma separator). People type them in their region's form
// (comma decimal mark, semicolon separator). A Syntax says which form a piece of text is in. convertFormula moves
// text between the two without changing anything else. The tokenizer is the shared engine's (core/expr).

import { ExprError, tokenize } from '../../../../core/expr';
import type { Locale } from '../locale';
import { formulaDialect } from './dialect';
import { describeProblem, type FormulaProblem } from './problems';

export type { FormulaProblem };

export interface Syntax {
  decimal: '.' | ',';
  separator: ',' | ';';
}

export const STORED: Syntax = { decimal: '.', separator: ',' };

export function syntaxOf(locale: Locale): Syntax {
  return { decimal: locale.decimal, separator: locale.list };
}

/** Rewrites numbers and separators from one syntax to another. Returns a problem when the text can't be read. */
export function convertFormula(src: string, from: Syntax, to: Syntax): string | FormulaProblem {
  try {
    let out = '';
    let last = 0;
    for (const token of tokenize(src, formulaDialect(from).lex)) {
      out += src.slice(last, token.start);
      if (token.kind === 'num') out += token.text.replace(from.decimal, to.decimal);
      else if (token.kind === 'sep') out += to.separator;
      else out += src.slice(token.start, token.end);
      last = token.end;
    }
    return out;
  } catch (e) {
    if (e instanceof ExprError) return describeProblem(e);
    throw e;
  }
}
