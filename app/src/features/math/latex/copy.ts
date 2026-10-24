// What goes on the clipboard when someone copies an equation. LaTeX is the source, MathML pastes into Word and
// other math-aware apps, and Markdown math is what OpenNote's own note format stores (format spec section 7).

import { renderMarkup } from './engine';

export type CopyFormat = 'latex' | 'mathml' | 'markdown';

export interface CopyPayload {
  /** Plain text for the clipboard. */
  readonly text: string;
  /** HTML for the clipboard when the format is MathML, so apps that read only HTML still get the equation. */
  readonly html?: string;
}

/** The standalone `<math>` element for some LaTeX, with the LaTeX source in an annotation. Throws on bad LaTeX. */
export function toMathML(latex: string, displayMode = false): string {
  const markup = renderMarkup(latex, displayMode, 'mathml');
  const math = /<math[\s\S]*<\/math>/.exec(markup);
  if (math === null) throw new Error('KaTeX returned no MathML.');
  return math[0];
}

/** The equation as Markdown: `$x$` inline, or `$$` on its own lines around display math. */
export function toMarkdownMath(latex: string, displayMode = false): string {
  const body = latex.trim();
  if (displayMode) return `$$\n${body}\n$$`;
  return `$${body.replace(/\s*\n\s*/g, ' ')}$`;
}

/** The text, and for MathML the HTML, to put on the clipboard. Throws on bad LaTeX when the format is MathML. */
export function copyPayload(latex: string, format: CopyFormat, displayMode = false): CopyPayload {
  if (format === 'latex') return { text: latex.trim() };
  if (format === 'markdown') return { text: toMarkdownMath(latex, displayMode) };
  const mathml = toMathML(latex, displayMode);
  return { text: mathml, html: mathml };
}
