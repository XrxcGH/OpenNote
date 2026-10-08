// Turns the engine's error codes into the plain sentences a person sees under a formula, with the place of the
// problem in the formula text.

import type { ExprError } from '../../../../core/expr';

export interface FormulaProblem {
  message: string;
  /** Character offset in the formula text. */
  pos: number;
}

function near(error: ExprError): string {
  const atEnd = error.code === 'unexpected-end' || error.code === 'unclosed-paren' || error.detail === undefined;
  return atEnd ? 'the end' : `"${error.detail}"`;
}

/** The sentence for an engine error. Most mistakes say where to look, and a few say what to do. */
export function describeProblem(error: ExprError): FormulaProblem {
  const pos = error.position;
  switch (error.code) {
    case 'empty':
      return { message: 'Type a formula.', pos };
    case 'unclosed-quote':
      return { message: 'Close the quote that starts here.', pos };
    case 'unclosed-bracket':
      return { message: 'Close the bracket that starts here.', pos };
    case 'too-deep':
      return { message: 'This formula is nested too deeply.', pos };
    case 'too-long':
      return { message: 'This formula is too long.', pos };
    case 'bad-reference':
      return { message: `"${error.detail}" isn't a column or a function. Put column names in [ ].`, pos };
    case 'bad-row':
      return { message: 'Rows start at 1.', pos };
    default:
      return { message: `Check the formula near ${near(error)}.`, pos };
  }
}
