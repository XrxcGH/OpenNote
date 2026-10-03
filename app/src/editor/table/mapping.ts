// Between a table block's data and its editor document (ARCHITECTURE.md section 13; PLAN.md section 10.3). The
// data is SPEC 6.3's: columns with IDs and widths, and rows with IDs whose cells are keyed by column ID. The
// document is one table whose first row holds header cells when the table has a header row. IDs aren't in the
// document: they follow positions, and the table commands change the data first, so a moved row keeps its ID.
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { newId } from '../ids';
import { parseCell, serializeCell } from '../markdown';
import type { MarkdownCache } from '../markdown';
import { tableSchema } from '../schema/schema';
import { DEFAULT_COLUMN_WIDTH } from '../schema/specs';
import type { TableData } from '../schema/specs';

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

/**
 * The ID normalizer: block data as the core holds it, made safe to show. IDs are unique and present, widths are
 * clamped, every row has a cell for every column and none for unknown columns, and a table has at least one row
 * and one column. Data that is already normal comes back equal.
 */
export function normalizeTableData(data: unknown): TableData {
  const source = isRecord(data) ? data : {};
  const seen = new Set<string>();
  const columns = (Array.isArray(source.columns) ? source.columns : []).map((column): TableColumn => {
    const fields = isRecord(column) ? column : {};
    const width = typeof fields.width === 'number' ? fields.width : DEFAULT_COLUMN_WIDTH;
    return { id: uniqueId(fields.id, seen), width: clampColumnWidth(width) };
  });
  if (columns.length === 0) columns.push(newColumn());
  const rows = (Array.isArray(source.rows) ? source.rows : []).map((row): TableRow => {
    const fields = isRecord(row) ? row : {};
    const cells = isRecord(fields.cells) ? fields.cells : {};
    const id = uniqueId(fields.id, seen);
    return {
      id,
      cells: Object.fromEntries(
        columns.map((column) => {
          const cell = cells[column.id];
          const markdown = isRecord(cell) && typeof cell.markdown === 'string' ? cell.markdown : '';
          return [column.id, { markdown }];
        }),
      ),
    };
  });
  if (rows.length === 0) rows.push(newRow(columns));
  return { header: source.header === true, columns, rows };
}

/** Whether two tables hold the same data. Cell keys may come in any order. */
export function sameTableData(a: TableData, b: TableData): boolean {
  if (a === b) return true;
  if (a.header !== b.header || a.columns.length !== b.columns.length || a.rows.length !== b.rows.length) return false;
  const columnsSame = a.columns.every(
    (column, i) => column.id === b.columns[i].id && column.width === b.columns[i].width,
  );
  return (
    columnsSame &&
    a.rows.every(
      (row, i) =>
        row.id === b.rows[i].id &&
        a.columns.every((column) => row.cells[column.id]?.markdown === b.rows[i].cells[column.id]?.markdown),
    )
  );
}

/** The table's document in `schema`'s types: the table schema's by default, or an editor's own schema. */
export function tableDataToDoc(data: TableData, schema: Schema = tableSchema): PMNode {
  const { nodes } = schema;
  const sameSchema = schema === tableSchema;
  const paragraph = (markdown: string) => {
    const parsed = parseCell(markdown);
    return sameSchema ? parsed : schema.nodeFromJSON(parsed.toJSON());
  };
  const rows = data.rows.map((row, r) => {
    const type = data.header && r === 0 ? nodes.tableHeader : nodes.tableCell;
    const cells = data.columns.map((column) =>
      type.create({ colwidth: [column.width] }, paragraph(row.cells[column.id]?.markdown ?? '')),
    );
    return nodes.tableRow.create(null, cells);
  });
  return nodes.doc.create(null, nodes.table.create(null, rows));
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

/**
 * The data a table document shows. Rows and columns take `previous`'s IDs by position, and new ones get fresh
 * IDs. Widths come from the first row's cells. A row shorter than the widest row reads as empty cells.
 */
export function docToTableData(doc: PMNode, previous: TableData, cache: MarkdownCache): TableData {
  const table = tableOf(doc);
  if (!table || table.childCount === 0) return normalizeTableData(previous);
  let width = 0;
  table.forEach((row) => (width = Math.max(width, row.childCount)));
  const firstRow = table.child(0);
  const seen = new Set<string>();
  const columns = Array.from({ length: Math.max(1, width) }, (_, c): TableColumn => {
    const before = previous.columns[c];
    const cell = c < firstRow.childCount ? firstRow.child(c) : null;
    const colwidth = cell?.attrs.colwidth as unknown;
    const fromDoc = Array.isArray(colwidth) && typeof colwidth[0] === 'number' ? colwidth[0] : null;
    return {
      id: uniqueId(before?.id, seen),
      width: clampColumnWidth(fromDoc ?? before?.width ?? DEFAULT_COLUMN_WIDTH),
    };
  });
  let header = firstRow.childCount > 0;
  firstRow.forEach((cell) => (header &&= cell.type.name === 'tableHeader'));
  const rows: TableRow[] = [];
  table.forEach((row, _offset, r) => {
    const cells: TableRow['cells'] = {};
    columns.forEach((column, c) => {
      const cell = c < row.childCount ? row.child(c) : null;
      cells[column.id] = { markdown: cellMarkdown(cell?.firstChild ?? null, cache) };
    });
    rows.push({ id: uniqueId(previous.rows[r]?.id, seen), cells });
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
