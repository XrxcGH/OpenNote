// The tables on a page, as grids of cell text a data set can be read from. A table block stores its columns in
// order and each row's cells by column id; cell text is Markdown, so simple emphasis and escapes are removed.

export interface PageBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface PageTable {
  /** The block id, so the tool can read the same table again after it changes. */
  id: string;
  /** 1 for the first table on the page, 2 for the next, and so on. */
  number: number;
  /** The first row's cells, when the table marks its first row as a header; else null. */
  header: string[] | null;
  rows: string[][];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Cell Markdown as plain text: emphasis markers, code ticks, and backslash escapes removed. */
export function plainCell(markdown: string): string {
  return markdown
    .replace(/(?<!\\)(\*\*|__|\*|_|`)(.+?)\1/g, '$2')
    .replace(/\\(.)/g, '$1')
    .trim();
}

function cellText(cells: Record<string, unknown>, column: string): string {
  const cell = cells[column];
  if (isObject(cell) && typeof cell.markdown === 'string') return plainCell(cell.markdown);
  return typeof cell === 'string' ? plainCell(cell) : '';
}

function readTable(block: PageBlock, number: number): PageTable | null {
  const { columns, rows, header } = block.data;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null;
  const ids = columns.filter(isObject).map((c) => String(c.id ?? ''));
  const grid = rows
    .filter(isObject)
    .map((r) => (isObject(r.cells) ? r.cells : {}))
    .map((cells) => ids.map((id) => cellText(cells, id)));
  const hasHeader = header === true && grid.length > 0;
  return { id: block.id, number, header: hasHeader ? grid[0] : null, rows: hasHeader ? grid.slice(1) : grid };
}

/** Every table on the page, in block order. */
export function tablesOf(blocks: readonly PageBlock[]): PageTable[] {
  const out: PageTable[] = [];
  for (const block of blocks) {
    if (block.type !== 'table') continue;
    const table = readTable(block, out.length + 1);
    if (table) out.push(table);
  }
  return out;
}

/** The table as one grid, header first when it has one, ready for dataFromGrid. */
export const gridOf = (table: PageTable): string[][] => (table.header ? [table.header, ...table.rows] : table.rows);
