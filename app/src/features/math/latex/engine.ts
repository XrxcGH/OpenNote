// The one place that talks to KaTeX, so the settings that keep rendering safe live together. KaTeX turns LaTeX into
// HTML for the screen plus MathML behind it for screen readers and braille displays.

import katex, { type KatexOptions } from 'katex';

/** A problem in some LaTeX, with where it is. `position` counts UTF-16 code units from the start of the input. */
export interface LatexProblem {
  readonly message: string;
  readonly position: number;
  readonly length: number;
}

/** The most macro expansions one equation may use. It stops a macro that calls itself from stalling the page. */
const MAX_EXPANSIONS = 1000;

/** The largest size a user-written length, such as \rule{500em}{500em}, may have, in ems. */
const MAX_SIZE_EMS = 50;

export type MathOutput = 'htmlAndMathml' | 'mathml';

/** Settings for every render. `trust` stays off, so links, images, and raw HTML attributes in LaTeX do nothing. */
export function katexOptions(displayMode: boolean, output: MathOutput): KatexOptions {
  return {
    displayMode,
    output,
    throwOnError: true,
    trust: false,
    strict: 'ignore',
    maxExpand: MAX_EXPANSIONS,
    maxSize: MAX_SIZE_EMS,
  };
}

/** Turns anything KaTeX throws into a problem with a position. KaTeX's own errors know where they happened. */
export function toProblem(error: unknown, latex: string): LatexProblem {
  if (error instanceof katex.ParseError) {
    const position = Number.isInteger(error.position) ? error.position : latex.length;
    const length = Number.isInteger(error.length) && error.length > 0 ? error.length : 1;
    // KaTeX counts the spaces after a command such as "\foo " as part of it. A marker should not cover them.
    const trimmed = latex.slice(position, position + length).trimEnd().length;
    return { message: error.rawMessage, position, length: Math.max(1, trimmed) };
  }
  return { message: 'This equation is too complex to draw.', position: 0, length: Math.max(1, latex.length) };
}

/** Renders LaTeX to markup, or throws. The callers in this folder catch and report with `toProblem`. */
export function renderMarkup(latex: string, displayMode: boolean, output: MathOutput): string {
  return katex.renderToString(latex, katexOptions(displayMode, output));
}
