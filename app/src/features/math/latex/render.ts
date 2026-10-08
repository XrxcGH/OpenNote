// Renders LaTeX to markup a page can show. The markup has two parts: HTML for the eyes, hidden from assistive
// technology, and MathML for screen readers and braille displays, hidden from view. The page must load KaTeX's
// stylesheet and fonts (katex/dist/katex.min.css) for the HTML part to look right.

import { renderMarkup, toProblem, type LatexProblem } from './engine';

export interface RenderOptions {
  /** Display math is centered on its own line, and inline math sits in the text. */
  readonly displayMode?: boolean;
}

export type RenderResult =
  { readonly ok: true; readonly html: string } | { readonly ok: false; readonly error: LatexProblem };

/** LaTeX to markup with MathML for screen readers. A mistake comes back as `error`, never as a throw. */
export function renderLatex(latex: string, options: RenderOptions = {}): RenderResult {
  try {
    return { ok: true, html: renderMarkup(latex, options.displayMode ?? false, 'htmlAndMathml') };
  } catch (error) {
    return { ok: false, error: toProblem(error, latex) };
  }
}
