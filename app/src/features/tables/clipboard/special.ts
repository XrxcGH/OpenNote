// Paste special (DESIGN 13.7): what to paste, an operation with the cells already there, skip blanks, transpose, and
// paste link. Ctrl+Alt+V asks; Ctrl+Shift+V pastes values only. Validation rules do not travel on the clipboard yet,
// so there is no Validation choice. A table has no text marker, so a pasted value that starts with "=" works as a
// formula, and the paste announces it.

import type { Clip, ClipCell, ClipSpan } from '../engine/paste/clip';

export type PasteWhat =
  | 'all'
  | 'formulas'
  | 'values'
  | 'formats'
  | 'notes'
  | 'widths'
  | 'noBorders'
  | 'valuesAndNumberFormats'
  | 'formulasAndNumberFormats';

export type PasteOperation = 'none' | 'add' | 'subtract' | 'multiply' | 'divide';

export interface PasteSpecial {
  what: PasteWhat;
  operation: PasteOperation;
  skipBlanks: boolean;
  transpose: boolean;
  /** Writes references to the copied cells instead of their content (an OpenNote copy only). */
  link: boolean;
}

export const PASTE_WHATS: readonly PasteWhat[] = [
  'all',
  'formulas',
  'values',
  'formats',
  'notes',
  'widths',
  'noBorders',
  'valuesAndNumberFormats',
  'formulasAndNumberFormats',
];

export const PASTE_OPERATIONS: readonly PasteOperation[] = ['none', 'add', 'subtract', 'multiply', 'divide'];

export const PASTE_ALL: PasteSpecial = Object.freeze({
  what: 'all',
  operation: 'none',
  skipBlanks: false,
  transpose: false,
  link: false,
});

/** Ctrl+Shift+V: the values, as text and numbers, with no formulas and no formats. */
export const PASTE_VALUES: PasteSpecial = Object.freeze({ ...PASTE_ALL, what: 'values' });

/** What a choice brings: the cell's content, its formula, its whole style, or only its number format. */
export interface Parts {
  content: boolean;
  formulas: boolean;
  style: 'all' | 'noBorders' | 'fmt' | 'none';
  merges: boolean;
  notes: boolean;
  widths: boolean;
}

export function partsOf(what: PasteWhat): Parts {
  const none: Parts = { content: false, formulas: false, style: 'none', merges: false, notes: false, widths: false };
  switch (what) {
    case 'all':
      return { ...none, content: true, formulas: true, style: 'all', merges: true, notes: true };
    case 'formulas':
      return { ...none, content: true, formulas: true };
    case 'values':
      return { ...none, content: true };
    case 'formats':
      return { ...none, style: 'all', merges: true };
    case 'notes':
      return { ...none, notes: true };
    case 'widths':
      return { ...none, widths: true };
    case 'noBorders':
      return { ...none, content: true, formulas: true, style: 'noBorders', merges: true, notes: true };
    case 'valuesAndNumberFormats':
      return { ...none, content: true, style: 'fmt' };
    case 'formulasAndNumberFormats':
      return { ...none, content: true, formulas: true, style: 'fmt' };
  }
}

/** Swaps the row and column steps of relative R1C1 references, as a transposed formula needs. */
export function transposeFormula(formula: string): string {
  return formula
    .split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /(?<![A-Za-z0-9_.$])R\[([+-]?\d+)\]C\[([+-]?\d+)\]/gi,
            (_whole, r: string, c: string) => `R[${c}]C[${r}]`,
          ),
    )
    .join('');
}

/** The clip turned so its rows become columns: cells, spans, and relative references swap. Widths do not travel. */
export function transposeClip(clip: Clip): Clip {
  const height = clip.rows.length;
  const width = clip.rows[0]?.length ?? 0;
  const rows: ClipCell[][] = Array.from({ length: width }, (_, c) =>
    Array.from({ length: height }, (_, r) => {
      const cell = clip.rows[r][c];
      return cell.formula ? { ...cell, formula: transposeFormula(cell.formula) } : cell;
    }),
  );
  const spans: ClipSpan[] = clip.spans.map((s) => ({ row: s.col, col: s.row, rows: s.cols, cols: s.rows }));
  const { link: _link, ...rest } = clip;
  return { ...rest, rows, spans, widths: [] };
}

/** The result of an operation, rounded to 15 significant digits as spreadsheets show. Divide by zero gives null. */
export function operate(operation: PasteOperation, before: number, pasted: number): number | null {
  let out: number;
  switch (operation) {
    case 'add':
      out = before + pasted;
      break;
    case 'subtract':
      out = before - pasted;
      break;
    case 'multiply':
      out = before * pasted;
      break;
    case 'divide':
      if (pasted === 0) return null;
      out = before / pasted;
      break;
    default:
      return pasted;
  }
  return Number.isFinite(out) ? Number(out.toPrecision(15)) : null;
}

export const OPERATOR: Readonly<Record<PasteOperation, string>> = {
  none: '',
  add: '+',
  subtract: '-',
  multiply: '*',
  divide: '/',
};
