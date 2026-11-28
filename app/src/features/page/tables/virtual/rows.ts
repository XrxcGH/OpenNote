// The arithmetic of row virtualization (DESIGN.md section 18): which tables are virtual, which rows a window keeps
// drawn, and the short table the static view shows before the editor mounts. No DOM and no editor here.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Tables with more rows than this draw only the rows near the view. Ordinary tables keep every row's DOM. */
export const VIRTUAL_ROW_THRESHOLD = 2000;

/** Rows the editor draws before it has measured anything: about two screens of ordinary rows. */
export const FIRST_WINDOW_ROWS = 60;

/** Whether a table of `rows` rows is virtual. */
export function isVirtualCount(rows: number): boolean {
  return rows > VIRTUAL_ROW_THRESHOLD;
}

/** The table of a table block's document, or null. */
export function tableOf(doc: PMNode): PMNode | null {
  const table = doc.firstChild;
  return table && table.type.name === 'table' ? table : null;
}

/** Whether a table block's document is virtual. */
export function isVirtualDoc(doc: PMNode): boolean {
  return isVirtualCount(tableOf(doc)?.childCount ?? 0);
}

/** The row index of a document position, or null outside the table's rows. */
export function rowAt(doc: PMNode, pos: number): number | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  return $pos.depth >= 2 ? $pos.index(1) : null;
}

export interface RowWindow {
  /** The first row drawn. */
  readonly from: number;
  /** One past the last row drawn. */
  readonly to: number;
}

/**
 * The first and last rows that touch the band from `top` to `bottom`, by binary search over `edges`, which gives a
 * row's top and bottom in the same coordinates. Rows are laid out top to bottom. Null for an empty table.
 */
export function visibleRows(
  count: number,
  edges: (row: number) => { top: number; bottom: number },
  top: number,
  bottom: number,
): { first: number; last: number } | null {
  if (count <= 0) return null;
  // The first row whose bottom is below the band's top.
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges(mid).bottom <= top) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  // The last row whose top is above the band's bottom.
  lo = first;
  hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges(mid).top >= bottom) hi = mid - 1;
    else lo = mid;
  }
  return { first, last: Math.max(first, lo) };
}

/**
 * The window to draw for the visible rows `first` to `last`. The window keeps `margin` rows on each side. It moves
 * once the visible rows have less than three quarters of a margin beyond its edge, so it moves about a quarter of a
 * margin at a time. So a slow scroll redraws now and then, not on every frame.
 *
 * A move's cost grows with the rows it changes: ProseMirror looks up each of the table's rows in each mark, and the
 * rows that come are drawn and numbered. Moving half a margin at a time made each move twice as costly, and those
 * frames were the scroll's slowest. Returns `current` itself when it still covers what is needed.
 */
export function nextWindow(current: RowWindow, first: number, last: number, count: number, margin: number): RowWindow {
  const keep = margin - Math.floor(margin / 4);
  const needFrom = Math.max(0, first - keep);
  const needTo = Math.min(count, last + 1 + keep);
  if (current.from <= needFrom && current.to >= needTo && current.to <= count) return current;
  return { from: Math.max(0, first - margin), to: Math.min(count, last + 1 + margin) };
}

/**
 * The document the static view shows while the editor mounts in the same task. For a virtual table, that is its
 * first rows only: the page never builds DOM for thousands of rows that the editor replaces at once. Other
 * documents pass through.
 */
export function staticDocOf(doc: PMNode, rows = FIRST_WINDOW_ROWS): PMNode {
  const table = tableOf(doc);
  if (!table || !isVirtualCount(table.childCount)) return doc;
  const kept: PMNode[] = [];
  for (let i = 0; i < Math.min(rows, table.childCount); i++) kept.push(table.child(i));
  return doc.copy(Fragment.from(table.copy(Fragment.from(kept))));
}
