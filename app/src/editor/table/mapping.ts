// Between a table block's data and its editor document (ARCHITECTURE.md section 13; PLAN.md section 10.3). The
// data is SPEC 6.3's: columns with IDs and widths, and rows with IDs whose cells are keyed by column ID. The
// document is one table whose first row holds header cells when the table has a header row.
//
// Rows carry their ID in `rowId`, and cells their column's in `colId`. So a row moved in the document keeps its
// ID, and a pasted one gets a fresh one. Keys this version doesn't know are kept (SPEC 2.9).
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { newId } from '../ids';
import { parseCell, serializeCell } from '../markdown';
import type { MarkdownCache } from '../markdown';
import { tableSchema } from '../schema/schema';
import { DEFAULT_COLUMN_WIDTH } from '../schema/specs';
import type { CellSpan } from './spans';
import { TableMap } from '@tiptap/pm/tables';
import type { TableCellData, TableData } from '../schema/specs';

/** The narrowest and widest a column can be, in page units. */
export const MIN_COLUMN_WIDTH = 40;
export const MAX_COLUMN_WIDTH = 2000;

export type TableColumn = TableData['columns'][number];
export type TableRow = TableData['rows'][number];

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COLUMN_WIDTH;
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

function emptyCells(columns: readonly TableColumn[]): TableRow['cells'] {
  return Object.fromEntries(columns.map((column) => [column.id, { markdown: '' }]));
}

export function newColumn(width: number = DEFAULT_COLUMN_WIDTH): TableColumn {
  return { id: newId(), width: clampColumnWidth(width) };
}

export function newRow(columns: readonly TableColumn[]): TableRow {
  return { id: newId(), cells: emptyCells(columns) };
}

/** A table with fresh IDs and empty cells. */
export function newTableData(columns: number, rows: number, header: boolean): TableData {
  const made = Array.from({ length: Math.max(1, columns) }, () => newColumn());
  return { header, columns: made, rows: Array.from({ length: Math.max(1, rows) }, () => newRow(made)) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A unique ID: the given one when it is a new, non-empty string, else a fresh one. */
function uniqueId(id: unknown, seen: Set<string>): string {
  const next = typeof id === 'string' && id !== '' && !seen.has(id) ? id : newId();
  seen.add(next);
  return next;
}

/** A cell's data: its Markdown, and the keys this version doesn't know, as they were. */
function normalCell(cell: unknown): TableCellData {
  if (!isRecord(cell)) return { markdown: '' };
  return { ...cell, markdown: typeof cell.markdown === 'string' ? cell.markdown : '' };
}

/**
 * The ID normalizer: block data as the core holds it, made safe to show. IDs are unique and present, widths are
 * clamped, every row has a cell for every column and none for unknown columns, and a table has at least one row
 * and one column. Keys it doesn't know are kept. Data that is already normal comes back equal.
 */
export function normalizeTableData(data: unknown): TableData {
  const source = isRecord(data) ? data : {};
  const seen = new Set<string>();
  const columns = (Array.isArray(source.columns) ? source.columns : []).map((column): TableColumn => {
    const fields = isRecord(column) ? column : {};
    const width = typeof fields.width === 'number' ? fields.width : DEFAULT_COLUMN_WIDTH;
    return { ...fields, id: uniqueId(fields.id, seen), width: clampColumnWidth(width) };
  });
  if (columns.length === 0) columns.push(newColumn());
  const rows = (Array.isArray(source.rows) ? source.rows : []).map((row): TableRow => {
    const fields = isRecord(row) ? row : {};
    const cells = isRecord(fields.cells) ? fields.cells : {};
    const id = uniqueId(fields.id, seen);
    return {
      ...fields,
      id,
      cells: Object.fromEntries(columns.map((column) => [column.id, normalCell(cells[column.id])])),
    };
  });
  if (rows.length === 0) rows.push(newRow(columns));
  return { header: source.header === true, columns, rows };
}

/** Whether two JSON values are equal. Object keys may come in any order. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(b, key);
  return keys.length === Object.keys(b).length && keys.every((key) => has(key) && sameJson(a[key], b[key]));
}

/** Whether two tables hold the same data. Keys may come in any order. */
export function sameTableData(a: TableData, b: TableData): boolean {
  if (a === b) return true;
  if (a.header !== b.header || a.columns.length !== b.columns.length || a.rows.length !== b.rows.length) return false;
  return sameJson(a.columns, b.columns) && sameJson(a.rows, b.rows);
}

/**
 * The table's document in `schema`'s types: the table schema's by default, or an editor's own schema. `spans` are the
 * merged cells (spans.ts spansOf): the anchor gets `colspan` and `rowspan`, the covered cells are left out, and the
 * table declares the spans so the normalizer keeps them.
 */
export function tableDataToDoc(data: TableData, schema: Schema = tableSchema, spans: readonly CellSpan[] = []): PMNode {
  const { nodes } = schema;
  const sameSchema = schema === tableSchema;
  const paragraph = (markdown: string) => {
    const parsed = parseCell(markdown);
    return sameSchema ? parsed : schema.nodeFromJSON(parsed.toJSON());
  };
  const anchors = new Map<number, CellSpan>();
  const covered = new Set<number>();
  const width = data.columns.length;
  for (const span of spans) {
    if (span.row + span.rows > data.rows.length || span.column + span.columns > width) continue;
    anchors.set(span.row * width + span.column, span);
    for (let r = span.row; r < span.row + span.rows; r++)
      for (let c = span.column; c < span.column + span.columns; c++)
        if (r !== span.row || c !== span.column) covered.add(r * width + c);
  }
  const rows = data.rows.map((row, r) => {
    const type = data.header && r === 0 ? nodes.tableHeader : nodes.tableCell;
    const cells: PMNode[] = [];
    data.columns.forEach((column, c) => {
      if (covered.has(r * width + c)) return;
      const span = anchors.get(r * width + c);
      const widths = span ? data.columns.slice(c, c + span.columns).map((one) => one.width) : [column.width];
      const attrs = {
        colwidth: widths,
        colId: column.id,
        ...(span ? { colspan: span.columns, rowspan: span.rows } : {}),
      };
      cells.push(type.create(attrs, paragraph(row.cells[column.id]?.markdown ?? '')));
    });
    return nodes.tableRow.create({ rowId: row.id }, cells);
  });
  const merges = anchors.size > 0 ? [...anchors.values()] : null;
  return nodes.doc.create(null, nodes.table.create(merges ? { merges } : null, rows));
}

/** Each cell paragraph's Markdown, kept while ProseMirror keeps the node, so a flush serializes only edited cells. */
const serialized = new WeakMap<PMNode, string>();

function cellMarkdown(paragraph: PMNode | null, cache: MarkdownCache): string {
  if (!paragraph || paragraph.content.size === 0) return '';
  let markdown = serialized.get(paragraph);
  if (markdown === undefined) {
    markdown = serializeCell(paragraph, cache);
    serialized.set(paragraph, markdown);
  }
  return markdown;
}

/** The table node of a table document, or the node itself when it is a table. */
export function tableOf(doc: PMNode): PMNode | null {
  if (doc.type.name === 'table') return doc;
  const first = doc.firstChild;
  return first && first.type.name === 'table' ? first : null;
}

/** A node's `rowId` or `colId`, when it holds one. */
function idOf(node: PMNode | null | undefined, name: 'rowId' | 'colId'): string | null {
  const id = node?.attrs[name] as unknown;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** A cell of the grid: the node, and the top-left slot it covers. */
interface Slot {
  cell: PMNode;
  left: number;
  top: number;
}

/**
 * Reads the cell at a grid slot. A table with no merged cell is read by index, as a ragged table needs. One with merged
 * cells goes through ProseMirror's table map, so a slot a merged cell covers gives that cell.
 */
function slotReader(table: PMNode): { map: TableMap | null; at(row: number, column: number): Slot | null } {
  let merged = false;
  table.forEach((row) =>
    row.forEach((cell) => {
      if (Number(cell.attrs.colspan ?? 1) > 1 || Number(cell.attrs.rowspan ?? 1) > 1) merged = true;
    }),
  );
  if (!merged) {
    return {
      map: null,
      at(row, column) {
        const line = row < table.childCount ? table.child(row) : null;
        return line && column < line.childCount ? { cell: line.child(column), left: column, top: row } : null;
      },
    };
  }
  const map = TableMap.get(table);
  // One pass builds each cell by offset and its top-left slot, so every read is O(1).
  const cells = new Map<number, PMNode>();
  table.forEach((row, rowOffset) => row.forEach((cell, cellOffset) => cells.set(rowOffset + 1 + cellOffset, cell)));
  const corners = new Map<number, { left: number; top: number }>();
  map.map.forEach((offset, i) => {
    if (!corners.has(offset)) corners.set(offset, { left: i % map.width, top: Math.floor(i / map.width) });
  });
  return {
    map,
    at(row, column) {
      if (row >= map.height || column >= map.width) return null;
      const offset = map.map[row * map.width + column];
      const cell = cells.get(offset);
      const corner = corners.get(offset);
      return cell && corner ? { cell, left: corner.left, top: corner.top } : null;
    },
  };
}

/**
 * The data a table document shows. Rows and columns take the IDs their nodes carry. A node without a free ID
 * takes `previous`'s ID at its position, unless another node carries it. Else it gets a fresh one. So pasted rows
 * get fresh IDs, and the rows beside them keep theirs.
 *
 * Unknown keys come from `previous`'s row, column, and cell of the same ID. Widths come from the first row's
 * cells. A row shorter than the widest row reads as empty cells.
 */
export function docToTableData(doc: PMNode, previous: TableData, cache: MarkdownCache): TableData {
  const table = tableOf(doc);
  if (!table || table.childCount === 0) return normalizeTableData(previous);
  const slots = slotReader(table);
  let width = slots.map ? slots.map.width : 0;
  const carried = new Set<string>();
  table.forEach((row) => {
    if (!slots.map) width = Math.max(width, row.childCount);
    const rowId = idOf(row, 'rowId');
    if (rowId) carried.add(rowId);
    row.forEach((cell) => {
      const colId = idOf(cell, 'colId');
      if (colId) carried.add(colId);
    });
  });
  const seen = new Set<string>();
  const pick = (own: string | null, before: string | undefined): string => {
    if (own !== null && !seen.has(own)) return uniqueId(own, seen);
    return uniqueId(before !== undefined && !carried.has(before) ? before : undefined, seen);
  };
  const columnsBefore = new Map(previous.columns.map((column) => [column.id, column]));
  const rowsBefore = new Map(previous.rows.map((row) => [row.id, row]));
  const firstRow = table.child(0);
  const columns = Array.from({ length: Math.max(1, width) }, (_, c): TableColumn => {
    const found = slots.at(0, c);
    const cell = found?.cell ?? null;
    let own: string | null = null;
    table.forEach((_row, _offset, r) => {
      // Only a cell anchored in this column names it: a slot a horizontal merge covers holds the anchor's ID.
      const here = slots.at(r, c);
      if (here && here.left === c) own ??= idOf(here.cell, 'colId');
    });
    const id = pick(own, previous.columns[c]?.id);
    const before = columnsBefore.get(id);
    const colwidth = cell?.attrs.colwidth as unknown;
    const here = Array.isArray(colwidth) ? colwidth[c - (found?.left ?? c)] : null;
    const fromDoc = typeof here === 'number' ? here : null;
    return { ...before, id, width: clampColumnWidth(fromDoc ?? before?.width ?? DEFAULT_COLUMN_WIDTH) };
  });
  let header = firstRow.childCount > 0;
  firstRow.forEach((cell) => (header &&= cell.type.name === 'tableHeader'));
  const rows: TableRow[] = [];
  table.forEach((row, _offset, r) => {
    const id = pick(idOf(row, 'rowId'), previous.rows[r]?.id);
    const before = rowsBefore.get(id);
    const cells: TableRow['cells'] = {};
    columns.forEach((column, c) => {
      const found = slots.at(r, c);
      const cell = found && found.left === c && found.top === r ? found.cell : null;
      // A covered slot keeps the Markdown it has: it is hidden, not erased (ADR 0064).
      const kept = found && !cell ? (before?.cells[column.id]?.markdown ?? '') : null;
      cells[column.id] = {
        ...before?.cells[column.id],
        markdown: kept ?? cellMarkdown(cell?.firstChild ?? null, cache),
      };
    });
    rows.push({ ...before, id, cells });
  });
  return { header, columns, rows };
}

/** The header row's cell text, for the table's accessible name. Empty when there is no header row. */
export function headerNames(doc: PMNode, limit = 4): string[] {
  const table = tableOf(doc);
  const first = table?.firstChild;
  if (!first || first.firstChild?.type.name !== 'tableHeader') return [];
  const names: string[] = [];
  first.forEach((cell) => {
    const text = cell.textContent.trim();
    if (text && names.length < limit) names.push(text);
  });
  return names;
}
