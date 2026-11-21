// References in a formula being typed: their colors, F4's cycle of "$" marks, and the places a click on the grid may
// insert one. Each distinct reference takes the next of the reference colors in the order it first appears, and the
// grid outlines its cells in the same color, as spreadsheets do.
import type { CellRef, Token } from './scan';
import { cellText, refKey, scanFormula, solidBefore } from './scan';

/** How many reference colors there are. The seventh distinct reference takes the first color again. */
export const REF_COLORS = 6;

export interface ColoredRef {
  readonly token: Token;
  /** One-based: 1 is the first reference color. */
  readonly color: number;
}

/** Every reference of a formula with its color. The same cells written twice share a color. */
export function coloredRefs(tokens: readonly Token[]): ColoredRef[] {
  const colors = new Map<string, number>();
  return tokens
    .filter((token) => token.kind === 'ref')
    .map((token) => {
      const key = refKey(token);
      if (!colors.has(key)) colors.set(key, (colors.size % REF_COLORS) + 1);
      return { token, color: colors.get(key)! };
    });
}

/** F4's cycle: B2, then $B$2, then B$2, then $B2, then B2 again. */
export function nextAnchor(cell: CellRef): CellRef {
  if (!cell.colAbs && !cell.rowAbs) return { ...cell, colAbs: true, rowAbs: true };
  if (cell.colAbs && cell.rowAbs) return { ...cell, colAbs: false, rowAbs: true };
  if (!cell.colAbs && cell.rowAbs) return { ...cell, colAbs: true, rowAbs: false };
  return { ...cell, colAbs: false, rowAbs: false };
}

/** The reference F4 acts on: the one the caret is in or touches, else the last one before the caret. */
function refAtCaret(tokens: readonly Token[], caret: number): Token | undefined {
  const refs = tokens.filter((t) => t.kind === 'ref');
  return refs.find((t) => t.start <= caret && caret <= t.end) ?? refs.filter((t) => t.end <= caret).at(-1);
}

/** Writes a reference token with new cells, keeping its table prefix as written. */
function rewrite(text: string, token: Token, first: CellRef, last?: CellRef): string {
  const own = text.slice(token.start, token.end);
  const bang = token.sheet !== undefined ? own.lastIndexOf('!') + 1 : 0;
  return own.slice(0, bang) + cellText(first) + (last ? `:${cellText(last)}` : '');
}

export interface Edited {
  readonly text: string;
  /** Where the caret goes, and the selection's other end when the new part should be selected. */
  readonly caret: number;
  readonly anchor?: number;
}

/** F4: cycles the "$" marks of the reference at the caret. Null when the formula has no reference there. */
export function cycleAnchor(text: string, caret: number, separator: ',' | ';' = ','): Edited | null {
  const token = refAtCaret(scanFormula(text, { separator }), caret);
  if (!token?.first) return null;
  const first = nextAnchor(token.first);
  const last = token.last ? nextAnchor(token.last) : undefined;
  const written = rewrite(text, token, first, last);
  const next = text.slice(0, token.start) + written + text.slice(token.end);
  return { text: next, caret: token.start + written.length };
}

/**
 * True when a click on the grid should insert a reference at the caret: the text is a formula and the caret follows
 * "=", an operator, an opening bracket, or a separator.
 */
export function canPick(text: string, caret: number, separator: ',' | ';' = ','): boolean {
  if (!text.startsWith('=') || caret < 1) return false;
  const tokens = scanFormula(text, { separator });
  const before = solidBefore(tokens, caret);
  if (!before) return false;
  // The caret inside a token (not at its end) is not a place for a new reference.
  if (tokens.some((t) => t.start < caret && caret < t.end && t.kind !== 'space')) return false;
  return ['equals', 'op', 'open', 'sep'].includes(before.kind) && before.text !== '%';
}

/** Inserts (or, during one pick, replaces) a reference at the caret. `picked` is the span the last pick wrote. */
export function insertRef(
  text: string,
  caret: number,
  ref: string,
  picked?: { start: number; end: number },
): { text: string; caret: number; picked: { start: number; end: number } } {
  const start = picked?.start ?? caret;
  const end = picked?.end ?? caret;
  const next = text.slice(0, start) + ref + text.slice(end);
  return { text: next, caret: start + ref.length, picked: { start, end: start + ref.length } };
}

/** A zero-based grid cell (header row included) and the grid's header row, to the address formulas use. */
export function gridAddress(row: number, col: number, header: boolean): string | null {
  const dataRow = header ? row - 1 : row;
  if (dataRow < 0) return null;
  return cellText({ col, row: dataRow, colAbs: false, rowAbs: false });
}

/** A range between two grid cells as formulas write it: "C3", or "B2:C4" from either corner. */
export function gridRange(
  a: { row: number; column: number },
  b: { row: number; column: number },
  header: boolean,
): string | null {
  const top = Math.min(a.row, b.row);
  const left = Math.min(a.column, b.column);
  const bottom = Math.max(a.row, b.row);
  const right = Math.max(a.column, b.column);
  const first = gridAddress(top, left, header);
  if (!first) return null;
  if (top === bottom && left === right) return first;
  const last = gridAddress(bottom, right, header);
  return last ? `${first}:${last}` : null;
}

/** The grid cells a reference covers in its own table, by grid row (header row included) and column. */
export function refCells(
  token: Token,
  header: boolean,
): { top: number; left: number; bottom: number; right: number } | null {
  if (!token.first || token.sheet !== undefined) return null;
  const last = token.last ?? token.first;
  const shift = header ? 1 : 0;
  return {
    top: Math.min(token.first.row, last.row) + shift,
    left: Math.min(token.first.col, last.col),
    bottom: Math.max(token.first.row, last.row) + shift,
    right: Math.max(token.first.col, last.col),
  };
}
