// What Fit column width measures in the live table (DESIGN 13.2): the text each cell shows (rendered, not the markdown
// or the formula text), in the font the cell is drawn in. A canvas measures the lines with that font.

import { canvasMeasure } from '../../tables';

export interface FitInputs {
  texts: (column: number) => readonly string[];
  measure: (line: string) => number;
}

/** The font of an element as a CSS shorthand, or `fallback` when the browser gives none. */
function fontOf(element: Element): string {
  try {
    const style = getComputedStyle(element);
    if (style.font) return style.font;
    return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`.trim();
  } catch {
    return '';
  }
}

/** The shown text of the cells of each column and a measure in the first body cell's font. Null without cells. */
export function domFitInputs(
  root: ParentNode,
  measureFor: (font: string) => (line: string) => number = canvasMeasure,
): FitInputs | null {
  const rows = [...root.querySelectorAll('tr')];
  if (rows.length === 0) return null;
  const cell = root.querySelector('td, th');
  const font = (cell && fontOf(cell)) || '16px sans-serif';
  return {
    texts: (column) =>
      rows.map((row) => {
        const one = row.children[column];
        return one ? (one.textContent ?? '').replace(/\u200b/g, '').trim() : '';
      }),
    measure: measureFor(font),
  };
}
