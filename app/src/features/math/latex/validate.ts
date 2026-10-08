// Checks LaTeX without showing it, so an editor can mark the exact spot that KaTeX can't read.

import { renderMarkup, toProblem, type LatexProblem } from './engine';

export type Validation = { readonly valid: true } | { readonly valid: false; readonly error: LatexProblem };

/** Whether `latex` renders, and where the first problem is when it does not. */
export function validateLatex(latex: string): Validation {
  try {
    renderMarkup(latex, false, 'mathml');
    return { valid: true };
  } catch (error) {
    return { valid: false, error: toProblem(error, latex) };
  }
}
