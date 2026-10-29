// The quick LaTeX palette: common pieces of an equation. `latex` is what goes in the field. A `▢` marks a gap to fill
// in; the field selects the first one after a snippet goes in, so typing replaces it.

export type SnippetGroup = 'basics' | 'calculus' | 'matrices' | 'greek' | 'symbols';

export interface Snippet {
  id: string;
  group: SnippetGroup;
  latex: string;
  /** What the button shows. Defaults to the LaTeX itself. */
  face?: string;
}

/** The mark for a gap in a snippet. */
export const GAP = '▢';

const s = (id: string, group: SnippetGroup, latex: string, face?: string): Snippet =>
  face === undefined ? { id, group, latex } : { id, group, latex, face };

/** Greek letters: the snippet id, the LaTeX command (without its backslash), and the letter for the button. */
const GREEK: readonly (readonly [string, string, string])[] = [
  ['alpha', 'alpha', 'α'],
  ['beta', 'beta', 'β'],
  ['gamma', 'gamma', 'γ'],
  ['delta', 'delta', 'δ'],
  ['epsilon', 'varepsilon', 'ε'],
  ['theta', 'theta', 'θ'],
  ['lambda', 'lambda', 'λ'],
  ['mu', 'mu', 'μ'],
  ['pi', 'pi', 'π'],
  ['rho', 'rho', 'ρ'],
  ['sigma', 'sigma', 'σ'],
  ['phi', 'varphi', 'φ'],
  ['omega', 'omega', 'ω'],
  ['bigDelta', 'Delta', 'Δ'],
  ['bigSigma', 'Sigma', 'Σ'],
  ['bigOmega', 'Omega', 'Ω'],
];

export const SNIPPETS: readonly Snippet[] = [
  s('fraction', 'basics', String.raw`\frac{${GAP}}{${GAP}}`, 'a/b'),
  s('sqrt', 'basics', String.raw`\sqrt{${GAP}}`, '√'),
  s('nthRoot', 'basics', String.raw`\sqrt[${GAP}]{${GAP}}`, 'ⁿ√'),
  s('power', 'basics', `${GAP}^{${GAP}}`, 'xⁿ'),
  s('subscript', 'basics', `${GAP}_{${GAP}}`, 'xᵢ'),
  s('sum', 'calculus', String.raw`\sum_{i=1}^{n} ${GAP}`, 'Σ'),
  s('product', 'calculus', String.raw`\prod_{i=1}^{n} ${GAP}`, 'Π'),
  s('integral', 'calculus', String.raw`\int_{a}^{b} ${GAP} \, dx`, '∫'),
  s('doubleIntegral', 'calculus', String.raw`\iint_{D} ${GAP} \, dA`, '∬'),
  s('limit', 'calculus', String.raw`\lim_{x \to ${GAP}} ${GAP}`, 'lim'),
  s('derivative', 'calculus', String.raw`\frac{d}{dx} ${GAP}`, 'd/dx'),
  s('partial', 'calculus', String.raw`\frac{\partial ${GAP}}{\partial x}`, '∂/∂x'),
  s('matrix', 'matrices', String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, '( )'),
  s('determinant', 'matrices', String.raw`\begin{vmatrix} a & b \\ c & d \end{vmatrix}`, '| |'),
  s(
    'cases',
    'matrices',
    String.raw`\begin{cases} ${GAP} & \text{if } ${GAP} \\ ${GAP} & \text{otherwise} \end{cases}`,
    '{',
  ),
  s('vector', 'matrices', String.raw`\vec{${GAP}}`, 'v⃗'),
  s('hat', 'matrices', String.raw`\hat{${GAP}}`, 'x̂'),
  s('bar', 'matrices', String.raw`\bar{${GAP}}`, 'x̄'),
  ...GREEK.map(([id, command, face]) => s(id, 'greek', `\\${command}`, face)),
  s('plusMinus', 'symbols', String.raw`\pm`, '±'),
  s('infinity', 'symbols', String.raw`\infty`, '∞'),
  s('approx', 'symbols', String.raw`\approx`, '≈'),
  s('notEqual', 'symbols', String.raw`\neq`, '≠'),
  s('lessEqual', 'symbols', String.raw`\leq`, '≤'),
  s('greaterEqual', 'symbols', String.raw`\geq`, '≥'),
  s('arrow', 'symbols', String.raw`\to`, '→'),
  s('times', 'symbols', String.raw`\times`, '×'),
  s('cdot', 'symbols', String.raw`\cdot`, '·'),
  s('degree', 'symbols', String.raw`^{\circ}`, '°'),
];

export const SNIPPET_GROUPS: readonly SnippetGroup[] = ['basics', 'calculus', 'matrices', 'greek', 'symbols'];

/** The text with a snippet put in place of the selection, and the range to select afterward (the first gap, else the end). */
export function applySnippet(
  text: string,
  start: number,
  end: number,
  snippet: Snippet,
): { text: string; from: number; to: number } {
  const next = text.slice(0, start) + snippet.latex + text.slice(end);
  const gap = snippet.latex.indexOf(GAP);
  if (gap < 0) return { text: next, from: start + snippet.latex.length, to: start + snippet.latex.length };
  return { text: next, from: start + gap, to: start + gap + GAP.length };
}

/** LaTeX for the preview and for the page: gaps that were never filled are taken out. */
export function withoutGaps(latex: string): string {
  return latex.replaceAll(GAP, '');
}
