// The formula bar's view of its table: the active cell and range (from the spreadsheet keys' state), the cell's text,
// whether it shows an error, and the table's names. It follows every transaction of the table's editor. Writing the
// entry back to the cell and selecting a range from the name box go through the same editor.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { TableExtraHost } from '../../../page';
import {
  cellOfPos,
  cellsOf,
  gridOf,
  hasHeader,
  placedAt,
  selectCells,
  setCellContent,
  sheetKeysKey,
  textRange,
} from '../../keys/state';
import type { GridCell } from '../../keys/grid';
import { isError } from '../../engine/values';
import { namesOf, readSheet } from '../../sheet/model';
import { bookFor } from '../../smart/book';
import type { BoxName, GridBox } from './nameBox';
import { formulaRefsKey } from './refsPlugin';

export interface Active {
  /** The active cell, in grid cells (the header row counted). */
  readonly at: GridCell;
  /** The selected range, or the active cell alone. */
  readonly box: GridBox;
  /** The cell's text: a formula with its "=", or what was typed. */
  readonly text: string;
  readonly header: boolean;
  readonly size: { rows: number; columns: number };
  /** The table's defined names, for the name box. */
  readonly names: readonly BoxName[];
  /** The error the cell shows (an engine code such as "NA"), or null. */
  readonly error: string | null;
}

/** A cell's text with line breaks as "\n". */
export function cellTextAt(doc: PMNode, at: GridCell): string {
  const placed = placedAt(doc, at);
  if (!placed) return '';
  const { from, to } = textRange(placed);
  return doc.textBetween(from, to, '\n', '\n');
}

/**
 * The error a formula cell's result is (an engine code), or null. The page's workbook keeps its last calculation, so
 * this reads it again without calculating while the cells have not changed.
 */
function errorAt(host: TableExtraHost, col: number, row: number): string | null {
  if (row < 0) return null;
  const book = bookFor(host.page);
  const member = book.ordered().find((one) => one.element === host.element);
  // A large page goes to the worker, so calculateNow has no answer for it: the worker's last results explain it.
  const table = member ? (book.calculateNow(member) ?? book.lastCalculated(member)) : null;
  const value = table?.rows[row]?.cells[col]?.value;
  return value !== undefined && isError(value) ? value.error : null;
}

function activeOf(state: EditorState, host: TableExtraHost): Active | null {
  const grid = gridOf(state);
  const at = grid?.active ?? cellOfPos(state.doc, state.selection.head);
  if (!at) return null;
  const box = grid
    ? { top: grid.box.top, left: grid.box.left, bottom: grid.box.bottom, right: grid.box.right }
    : { top: at.row, left: at.column, bottom: at.row, right: at.column };
  const cells = cellsOf(state.doc);
  const text = cellTextAt(state.doc, at);
  const header = hasHeader(state.doc);
  const names = namesOf(readSheet(host.data())).map((n) => ({ name: n.name, ref: n.ref }));
  return {
    at,
    box,
    text,
    header,
    size: { rows: cells.length, columns: Math.max(0, ...cells.map((row) => row.length)) },
    names,
    error: text.startsWith('=') ? errorAt(host, at.column, at.row - (header ? 1 : 0)) : null,
  };
}

/** The active cell as it is now. */
export function readActive(host: TableExtraHost): Active | null {
  return host.editor.isDestroyed ? null : activeOf(host.editor.state, host);
}

/** True for a transaction that only tells the table the bar's text, so the active cell cannot change. */
export function barTextOnly(tr: Transaction): boolean {
  const meta = tr.getMeta(formulaRefsKey) as { bar?: unknown } | undefined;
  return meta !== undefined && 'bar' in meta && !tr.docChanged && !tr.selectionSet && !tr.getMeta(sheetKeysKey);
}

/** The active cell, following the table's editor. */
export function useActive(host: TableExtraHost): Active | null {
  const cache = useRef<{ state: EditorState | null; value: Active | null }>({ state: null, value: null });
  const subscribe = useCallback(
    (changed: () => void) => {
      const onTransaction = ({ transaction }: { transaction: Transaction }) => {
        // Each key typed in the bar tells the table its text (showBarFormula). That changes no cell, selection, or
        // grid state, so the active cell stays as it was: keep it, as working it out again reads the whole grid.
        if (barTextOnly(transaction) && cache.current.state?.doc === transaction.before) {
          cache.current = { state: host.editor.state, value: cache.current.value };
          return;
        }
        changed();
      };
      host.editor.on('transaction', onTransaction);
      return () => void host.editor.off('transaction', onTransaction);
    },
    [host],
  );
  const snapshot = useCallback(() => {
    const state = host.editor.isDestroyed ? null : host.editor.state;
    if (cache.current.state !== state) cache.current = { state, value: state ? activeOf(state, host) : null };
    return cache.current.value;
  }, [host]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** The cell's new content: the text, with a line break for each "\n" when the schema has one. */
function contentFor(state: EditorState, text: string): Fragment | string {
  const hardBreak = state.schema.nodes.hardBreak;
  if (!text.includes('\n') || !hardBreak) return text.replace(/\n/g, ' ');
  const nodes: PMNode[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) nodes.push(hardBreak.create());
    if (line) nodes.push(state.schema.text(line));
  });
  return Fragment.from(nodes);
}

/** Writes the entry to the cell as one undo step, then selects the cell below, to the right, or the same one. */
export function commitEntry(view: EditorView, at: GridCell, text: string, move: 'down' | 'right' | 'stay'): void {
  if (view.isDestroyed) return;
  const state = view.state;
  const tr = cellTextAt(state.doc, at) === text ? state.tr : setCellContent(state.tr, at, contentFor(state, text));
  const cells = cellsOf(tr.doc);
  const next =
    move === 'down' && at.row + 1 < cells.length
      ? { row: at.row + 1, column: at.column }
      : move === 'right' && at.column + 1 < (cells[at.row]?.length ?? 0)
        ? { row: at.row, column: at.column + 1 }
        : at;
  const placed = placedAt(tr.doc, next);
  if (placed) tr.setSelection(CellSelection.create(tr.doc, placed.pos));
  view.dispatch(tr.setMeta(sheetKeysKey, { active: null, entry: null }).scrollIntoView());
}

/** Selects a range of grid cells, as typing it in the name box does. */
export function selectBox(view: EditorView, box: GridBox): void {
  const tr = selectCells(view.state, { row: box.top, column: box.left }, { row: box.bottom, column: box.right });
  if (tr) view.dispatch(tr);
  view.focus();
}
