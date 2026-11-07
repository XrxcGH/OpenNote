// Grid mode's moves (ADR 0063). Arrows move one cell, and Ctrl+arrows jump to the data's edges. Enter and Tab
// go through a range, and Tab in the last cell adds a row. Ctrl+Space, Shift+Space, and Ctrl+A select.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { boxSize, cycle, jump, region, step } from './grid';
import type { Box, GridCell, Texts } from './grid';
import { activeCell, cellsOf, gridOf, placedAt, selectCells, sheetKeysKey } from './state';
import type { Dispatch, SheetKeysOptions, SheetMeta } from './state';

export interface Ctx {
  view: EditorView;
  state: EditorState;
  dispatch: Dispatch;
  options: SheetKeysOptions;
  texts: Texts;
}

export function move(ctx: Ctx, to: GridCell): boolean {
  const tr = selectCells(ctx.state, to);
  if (tr) ctx.dispatch(tr);
  return true;
}

export function extend(ctx: Ctx, head: GridCell): boolean {
  const grid = gridOf(ctx.state);
  if (!grid) return false;
  const tr = selectCells(ctx.state, grid.active, head, grid.active);
  if (tr) ctx.dispatch(tr);
  return true;
}

/** Arrow: one cell from the active cell, the range collapsed. */
export function moveBy(ctx: Ctx, rows: number, columns: number): boolean {
  const from = activeCell(ctx.state);
  return from ? move(ctx, step(ctx.texts, from, rows, columns)) : false;
}

export function extendBy(ctx: Ctx, rows: number, columns: number): boolean {
  const grid = gridOf(ctx.state);
  return grid ? extend(ctx, step(ctx.texts, grid.head, rows, columns)) : false;
}

export function jumpBy(ctx: Ctx, rows: -1 | 0 | 1, columns: -1 | 0 | 1, extending: boolean): boolean {
  const grid = gridOf(ctx.state);
  if (!grid) return false;
  if (extending) return extend(ctx, jump(ctx.texts, grid.head, rows, columns));
  return move(ctx, jump(ctx.texts, grid.active, rows, columns));
}

/** Enter, Shift+Enter, Tab, and Shift+Tab in Grid mode: through a range's cells, or on to the next cell. */
export function advance(ctx: Ctx, by: 'column' | 'row', back: boolean): boolean {
  const grid = gridOf(ctx.state);
  if (!grid) return false;
  if (boxSize(grid.box) > 1) {
    const next = cycle(grid.box, grid.active, by, back);
    const tr = selectCells(ctx.state, grid.anchor, grid.head, next);
    if (tr) ctx.dispatch(tr);
    return true;
  }
  return by === 'column' ? moveBy(ctx, back ? -1 : 1, 0) : nextInRow(ctx, grid.active, back);
}

/** Tab: the next cell along the row, then the next row's first cell. Tab in the last cell adds a row, as today. */
export function nextInRow(ctx: Ctx, from: GridCell, back: boolean): boolean {
  const cells = cellsOf(ctx.state.doc);
  const width = cells[from.row]?.length ?? 0;
  const index = from.row * width + from.column + (back ? -1 : 1);
  if (index < 0) return move(ctx, from);
  if (index < cells.length * width) return move(ctx, { row: Math.floor(index / width), column: index % width });
  return addRow(ctx);
}

/** A new empty row under the table, with its first cell active. The normalizer gives it its IDs. */
export function addRow(ctx: Ctx): boolean {
  const { state } = ctx;
  const table = state.doc.firstChild;
  const last = table?.lastChild;
  if (!table || !last) return false;
  const { nodes } = state.schema;
  const cells: PMNode[] = [];
  last.forEach((cell) => {
    const attrs = { colwidth: cell.attrs.colwidth as unknown, colId: cell.attrs.colId as unknown };
    cells.push(nodes.tableCell.create(attrs, nodes.paragraph.create()));
  });
  const tr = state.tr.insert(1 + table.content.size, nodes.tableRow.create(null, cells));
  const first = placedAt(tr.doc, { row: table.childCount, column: 0 });
  if (first) tr.setSelection(CellSelection.create(tr.doc, first.pos));
  ctx.dispatch(tr.setMeta(sheetKeysKey, { active: null, entry: null } satisfies SheetMeta).scrollIntoView());
  return true;
}

/** Leaves Edit mode keeping the text, and goes to a cell in Grid mode. */
export function commitTo(ctx: Ctx, to: GridCell): boolean {
  return move(ctx, to);
}

export function commitBy(ctx: Ctx, rows: number, columns: number): boolean {
  const from = activeCell(ctx.state);
  return from ? commitTo(ctx, step(ctx.texts, from, rows, columns)) : false;
}

export function selectBox(ctx: Ctx, box: Box, active?: GridCell): boolean {
  const tr = selectCells(ctx.state, { row: box.top, column: box.left }, { row: box.bottom, column: box.right }, active);
  if (tr) ctx.dispatch(tr);
  return true;
}

export function wholeBox(texts: Texts): Box {
  return { top: 0, left: 0, bottom: texts.length - 1, right: Math.max(0, ...texts.map((row) => row.length)) - 1 };
}

/** Ctrl+A: the data around the active cell, then the whole table. */
export function selectRegion(ctx: Ctx): boolean {
  const grid = gridOf(ctx.state);
  if (!grid) return false;
  const around = region(ctx.texts, grid.active);
  const same = (a: Box, b: Box) => a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
  const next = same(around, grid.box) || boxSize(around) === 1 ? wholeBox(ctx.texts) : around;
  return selectBox(ctx, next, grid.active);
}

/** About a screen of rows, or of columns, from the size the table shows at. */
export function pageOf(view: EditorView, rows: boolean): number {
  const cell = view.dom.querySelector('td, th');
  const rect = cell?.getBoundingClientRect();
  const size = rows ? rect?.height : rect?.width;
  const room = rows ? window.innerHeight : (view.dom.parentElement?.clientWidth ?? 0);
  return size && room ? Math.max(1, Math.floor(room / size) - 1) : rows ? 10 : 5;
}
