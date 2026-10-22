// The formula sheet builder (flag doc.formulaSheet): the display equations of the chosen pages, gathered into one page
// laid out in columns so that it fits on a single sheet. This file is the pure part: finding the equations, dropping
// repeats, choosing the number of columns, and writing the sheet as Markdown. The window is in FormulaSheetTool.tsx.
import { stripLabels } from '../../editor/equations';

export interface Formula {
  /** The LaTeX, without any equation label. */
  readonly latex: string;
  /** The nearest heading above it on its page, for the group it belongs to. Empty when there is none. */
  readonly topic: string;
}

export interface SheetPage {
  readonly title: string;
  /** The Markdown of each text block of the page, in reading order. */
  readonly texts: readonly string[];
}

/** One line of LaTeX in a canonical form, so the same equation written twice counts once. */
export const canonical = (latex: string): string => latex.replace(/\s+/g, ' ').trim();

/** The display equations of some pages, in order, each with its nearest heading, and without repeats. */
export function collectFormulas(pages: readonly SheetPage[]): Formula[] {
  const seen = new Set<string>();
  const out: Formula[] = [];
  for (const page of pages) {
    let topic = page.title.trim();
    for (const text of page.texts) {
      // Walk the text line by line so that headings set the topic for the equations after them.
      const lines = text.split('\n');
      let math: string[] | null = null;
      for (const line of lines) {
        const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
        if (math === null && heading) topic = heading[1];
        if (line.trim() === '$$') {
          if (math === null) math = [];
          else {
            const latex = canonical(stripLabels(math.join('\n')));
            math = null;
            if (latex !== '' && !seen.has(latex)) {
              seen.add(latex);
              out.push({ latex, topic });
            }
          }
        } else if (math !== null) math.push(line);
      }
    }
  }
  return out;
}

/** What a sheet holds on one page: rows of formulas per column at the standard size. */
export const ROWS_PER_COLUMN = 16;
export const MAX_COLUMNS = 4;

export interface Layout {
  readonly columns: number;
  /** How many formulas do not fit even at the most columns. */
  readonly overflow: number;
}

/** The fewest columns (up to four) that hold every formula on one sheet. */
export function chooseColumns(count: number, preferred?: number): Layout {
  const wanted = preferred && preferred >= 1 ? Math.min(preferred, MAX_COLUMNS) : 1;
  for (let columns = wanted; columns <= MAX_COLUMNS; columns += 1) {
    if (count <= columns * ROWS_PER_COLUMN) return { columns, overflow: 0 };
  }
  return { columns: MAX_COLUMNS, overflow: count - MAX_COLUMNS * ROWS_PER_COLUMN };
}

export interface Sheet {
  /** The cells of a table without a header, row by row: Markdown with inline math. */
  readonly rows: readonly (readonly string[])[];
  readonly columns: number;
  /** Formulas left off because the sheet is full. */
  readonly overflow: number;
  readonly count: number;
}

/**
 * The sheet as table cells: one column per layout column, formulas filled down each column in order. Groups follow the
 * topics of the formulas: a topic's name heads its first formula in italics.
 */
export function buildSheet(formulas: readonly Formula[], preferred?: number): Sheet {
  const layout = chooseColumns(formulas.length, preferred);
  const kept = formulas.slice(0, layout.columns * ROWS_PER_COLUMN);
  const rows = Math.max(1, Math.ceil(kept.length / layout.columns));
  const cell = (index: number): string => {
    const f = kept[index];
    if (!f) return '';
    const previous = kept[index - 1];
    const label = f.topic !== '' && (index === 0 || previous?.topic !== f.topic) ? `*${f.topic.replace(/[*_`$]/g, '')}* ` : '';
    return `${label}$${f.latex}$`;
  };
  return {
    rows: Array.from({ length: rows }, (_row, r) => Array.from({ length: layout.columns }, (_col, c) => cell(c * rows + r))),
    columns: layout.columns,
    overflow: layout.overflow,
    count: kept.length,
  };
}
