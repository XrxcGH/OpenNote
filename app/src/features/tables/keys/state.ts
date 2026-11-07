// The state of a table's spreadsheet keys (ADR 0063): the plugin key, the entry in progress, the active cell inside
// a range, and the cells of the document. Grid mode is a cell selection; Edit mode is the caret in a cell's text.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import type { DecorationSet, EditorView } from '@tiptap/pm/view';
import type { DateOrder } from '../engine/locale';
import { boxOf, inBox } from './grid';
import type { Box, GridCell } from './grid';
import type { TableKeys } from './mode';

/** An entry in a cell: where, the cell's content before it, and whether arrows finish it (Enter mode). */
export interface Entry {
  row: number;
  column: number;
  before: Fragment | null;
  mode: 'enter' | 'edit';
}

export interface SheetState {
  spreadsheet: boolean;
  entry: Entry | null;
  /** The active cell inside a range, once Enter or Tab moved it; null means the range's anchor. */
  active: GridCell | null;
  /** aria-rowindex and aria-colindex on every cell, and the grid roles with spreadsheet keys. Mapped through a
   * change inside one cell; rebuilt when cells move or the keys change. */
  indexes: DecorationSet;
  /** Whether the editor has focus. A table selected as an object, or focus elsewhere, marks no cell selected. */
  focused: boolean;
}

export interface SheetMeta {
  spreadsheet?: boolean;
  entry?: Entry | null;
  active?: GridCell | null;
  focused?: boolean;
}

export interface SheetKeysOptions {
  spreadsheet: boolean;
  announce(text: string): void;
  /** Stores the table's choice of keys in its data. */
  setKeys?(keys: TableKeys): void;
  /** What a cell shows: a formula's result. Null means its text. The default reads the cell's data-shown. */
  shown?(view: EditorView, at: GridCell): string | null;
  /** The order of today's date. Default: month, day, year. */
  dateOrder?(): DateOrder;
  /** The language tag for the time. Default: en-US. */
  locale?(): string;
  /** Now, for tests. */
  now?(): Date;
}

export const sheetKeysKey = new PluginKey<SheetState>('opennote.sheetKeys');

// ---- The grid of the document

export interface Placed {
  pos: number;
  node: PMNode;
}

const layouts = new WeakMap<PMNode, Placed[][]>();

/**
 * Every grid slot's cell, row by row: its position (before the cell) and node. The slots come from the table's map,
 * so a merged cell fills each slot it covers. A table block's document is one table.
 */
export function cellsOf(doc: PMNode): Placed[][] {
  const known = layouts.get(doc);
  if (known) return known;
  const table = doc.firstChild;
  const rows: Placed[][] = [];
  layouts.set(doc, rows);
  if (!table || table.childCount === 0) return rows;
  const map = TableMap.get(table);
  for (let row = 0; row < map.height; row++) {
    const cells: Placed[] = [];
    for (let column = 0; column < map.width; column++) {
      const offset = map.map[row * map.width + column];
      const node = table.nodeAt(offset);
      if (node) cells.push({ pos: offset + 1, node });
    }
    rows.push(cells);
  }
  return rows;
}

const merges = new WeakMap<PMNode, boolean>();

/** Whether a cell spans more than one row or column. Spreadsheet keys step one slot at a time, so they wait. */
export function hasMerged(doc: PMNode): boolean {
  const known = merges.get(doc);
  if (known !== undefined) return known;
  let merged = false;
  doc.firstChild?.forEach((row) =>
    row.forEach((cell) => {
      if (Number(cell.attrs.colspan ?? 1) > 1 || Number(cell.attrs.rowspan ?? 1) > 1) merged = true;
    }),
  );
  merges.set(doc, merged);
  return merged;
}

/** Whether the table's keys are spreadsheet keys now: chosen, and no merged cells. Otherwise document keys work. */
export function keysOn(state: EditorState): boolean {
  return (sheetKeysKey.getState(state)?.spreadsheet ?? false) && !hasMerged(state.doc);
}

export function textsOf(doc: PMNode): string[][] {
  return cellsOf(doc).map((row) => row.map((cell) => cell.node.textContent));
}

export const hasHeader = (doc: PMNode) => doc.firstChild?.firstChild?.firstChild?.type.name === 'tableHeader';

/** The grid cell of a position inside or before a cell. A merged cell's is its top left slot. */
export function cellOfPos(doc: PMNode, pos: number): GridCell | null {
  const cells = cellsOf(doc);
  for (let row = 0; row < cells.length; row++)
    for (let column = 0; column < cells[row].length; column++) {
      const { pos: start, node } = cells[row][column];
      if (pos >= start && pos < start + node.nodeSize) return { row, column };
    }
  return null;
}

export const placedAt = (doc: PMNode, at: GridCell): Placed | undefined => cellsOf(doc)[at.row]?.[at.column];

/** The range of the paragraph's content inside a cell: cells hold one paragraph. */
export function textRange(cell: Placed): { from: number; to: number } {
  const from = cell.pos + 2;
  return { from, to: from + (cell.node.firstChild?.content.size ?? 0) };
}

// ---- Modes

export type SheetMode = 'grid' | 'edit';

export function modeOf(state: EditorState): SheetMode | null {
  if (!keysOn(state)) return null;
  if (state.selection instanceof CellSelection) return 'grid';
  return cellOfPos(state.doc, state.selection.head) ? 'edit' : null;
}

/** Grid mode's range and active cell, or null outside Grid mode. */
export function gridOf(state: EditorState): { box: Box; anchor: GridCell; head: GridCell; active: GridCell } | null {
  const selection = state.selection;
  if (!(selection instanceof CellSelection)) return null;
  const anchor = cellOfPos(state.doc, selection.$anchorCell.pos);
  const head = cellOfPos(state.doc, selection.$headCell.pos);
  if (!anchor || !head) return null;
  const box = boxOf(anchor, head);
  const kept = sheetKeysKey.getState(state)?.active;
  const active = kept && inBox(box, kept) ? kept : anchor;
  return { box, anchor, head, active };
}

/** The cell keys act on: Grid mode's active cell, or the cell with the caret. */
export function activeCell(state: EditorState): GridCell | null {
  return gridOf(state)?.active ?? cellOfPos(state.doc, state.selection.head);
}

// ---- Transactions

export function selectCells(
  state: EditorState,
  anchor: GridCell,
  head: GridCell = anchor,
  active?: GridCell,
): Transaction | null {
  const a = placedAt(state.doc, anchor);
  const h = placedAt(state.doc, head);
  if (!a || !h) return null;
  const tr = state.tr.setSelection(CellSelection.create(state.doc, a.pos, h.pos));
  return tr.setMeta(sheetKeysKey, { active: active ?? null, entry: null } satisfies SheetMeta).scrollIntoView();
}

/** The caret at the end of a cell's text, in Edit mode. */
export function caretAtEnd(tr: Transaction, at: GridCell): Transaction {
  const cell = placedAt(tr.doc, at);
  if (cell) tr.setSelection(TextSelection.create(tr.doc, textRange(cell).to));
  return tr.scrollIntoView();
}

/** Replaces a cell's content with text, or with the given content. */
export function setCellContent(tr: Transaction, at: GridCell, content: Fragment | string): Transaction {
  const cell = placedAt(tr.doc, at);
  if (!cell) return tr;
  const { from, to } = textRange(cell);
  const nodes = typeof content === 'string' ? (content ? tr.doc.type.schema.text(content) : Fragment.empty) : content;
  return tr.replaceWith(from, to, nodes);
}

/** The content of a cell's paragraph. */
export const contentOf = (doc: PMNode, at: GridCell): Fragment =>
  placedAt(doc, at)?.node.firstChild?.content ?? Fragment.empty;

export type Dispatch = (tr: Transaction) => void;
