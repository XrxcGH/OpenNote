// Tables in pasted HTML become table blocks (SPEC 6.3), and the rest of the paste stays text. A table is swapped for a
// marker paragraph before the text is parsed, so its place among the other blocks is kept.
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TITLE } from '../../../editor/markdown/escape';
import { serializeInline } from '../../../editor/markdown/inline';
import { textSchema } from '../../../editor/schema/schema';
import { DEFAULT_COLUMN_WIDTH } from './types';
import type { TableData } from './types';

const { nodes } = textSchema;
const MARK = String.fromCharCode(0xe001);
const MARKER = new RegExp(`^${MARK}table:(\\d+)${MARK}$`);

/**
 * A cell's Markdown: inline content only, with the cell's paragraphs joined by hard breaks (SPEC 6.3). A cell is not a
 * paragraph line, so a number such as 12.5 is not escaped as if it began a numbered list.
 */
export function cellMarkdown(cell: HTMLElement): string {
  const parsed = PMDOMParser.fromSchema(textSchema).parse(cell);
  const inline: PMNode[] = [];
  parsed.descendants((node) => {
    if (!node.isTextblock) return true;
    if (inline.length > 0) inline.push(nodes.hardBreak.create());
    node.forEach((child) =>
      inline.push(child.type.name === 'image' ? textSchema.text(String(child.attrs.alt) || ' ') : child),
    );
    return false;
  });
  return serializeInline(nodes.paragraph.create(null, inline), TITLE).trim();
}

function cellSpan(cell: HTMLTableCellElement): number {
  return Math.max(1, Math.min(cell.colSpan, 64));
}

/** Table data from a `table` element, or null when it is too small to be a table. */
export function tableData(table: HTMLTableElement, newId: () => string): TableData | null {
  const rows = Array.from(table.rows);
  const widths = rows.map((row) => Array.from(row.cells).reduce((sum, cell) => sum + cellSpan(cell), 0));
  const count = Math.max(0, ...widths);
  if (rows.length * count < 2) return null;
  const columns = Array.from({ length: count }, () => ({ id: newId(), width: DEFAULT_COLUMN_WIDTH }));
  const header = table.tHead !== null || Array.from(rows[0].cells).every((cell) => cell.tagName === 'TH');
  return {
    header,
    columns,
    rows: rows.map((row) => {
      const cells = Object.fromEntries(columns.map((column) => [column.id, { markdown: '' }]));
      let at = 0;
      for (const cell of Array.from(row.cells)) {
        if (at < count) cells[columns[at].id] = { markdown: cellMarkdown(cell) };
        at += cellSpan(cell);
      }
      return { id: newId(), cells };
    }),
  };
}

/**
 * Table data from text whose lines are rows and whose tabs separate cells, which is how a spreadsheet copies as text.
 * Null unless it has two rows or more with the same number of cells (two or more) and no row begins with a tab, so
 * indented code and a lone line with a tab in it stay text.
 */
export function tabTableData(text: string, newId: () => string): TableData | null {
  const rows = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => line.split('\t'));
  const count = rows[0].length;
  if (rows.length < 2 || count < 2 || rows.length > 5000 || count > 64) return null;
  if (rows.some((row) => row.length !== count || row[0] === '' || row.every((cell) => cell.trim() === ''))) return null;
  const columns = Array.from({ length: count }, () => ({ id: newId(), width: DEFAULT_COLUMN_WIDTH }));
  return {
    header: false,
    columns,
    rows: rows.map((row) => ({
      id: newId(),
      cells: Object.fromEntries(
        columns.map((column, at) => {
          const cell = row[at].replace(/\0/g, '�').trim();
          const paragraph = nodes.paragraph.create(null, cell === '' ? [] : textSchema.text(cell));
          return [column.id, { markdown: serializeInline(paragraph, TITLE).trim() }];
        }),
      ),
    })),
  };
}

/** Swaps each table that stands among the blocks for a marker paragraph, and returns the tables in order. */
export function extractTables(body: HTMLElement, newId: () => string): TableData[] {
  const found: TableData[] = [];
  body.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.closest('table, ul, ol, li, blockquote, pre')) return;
    const data = tableData(table, newId);
    if (!data) return;
    const marker = table.ownerDocument.createElement('p');
    marker.textContent = `${MARK}table:${found.length}${MARK}`;
    table.replaceWith(marker);
    found.push(data);
  });
  return found;
}

/** The index of the table that a top-level marker paragraph stands for, or null for any other block. */
export function tableMarker(node: PMNode): number | null {
  const match = node.type.name === 'paragraph' ? MARKER.exec(node.textContent) : null;
  return match ? Number(match[1]) : null;
}
