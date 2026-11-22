// The clipboard as cells (ADR 0067): what a paste into a table reads. Each cell keeps its shown text, its own value,
// its formula in R1C1 form, and its style; merged cells are spans, and column widths come along.
//
// Sources, best first:
// - OpenNote's own form: JSON in the table's `data-opennote-cells` attribute, exact between OpenNote tables.
// - Google Sheets: `data-sheets-value`, `data-sheets-formula` (already R1C1), `data-sheets-numberformat`, inline CSS.
// - Excel: `x:num`, `x:bool`, `x:fmla` (A1, read as if the copy began at A1), classes of a style block.
// - LibreOffice: `sdval`, `sdnum`, inline CSS.
// - Any other HTML table, and tab-separated text.
// Everything read here is data: text is plain text, styles go through the sheet model's validator, and formulas are
// text that the engine parses like typed text.

import type { CellStyle } from '../../sheet/model/types';
import { validStyle } from '../../sheet/model/styles';
import { cellDeclarations, cssPoints, dropShared, styleOf, styleRules } from './css';
import { parseDelimited } from './delimited';
import { a1ToR1C1 } from './formula';
import { attributes, detectSource, isOnlyTable, plainText, sheetsValue, type PasteSource } from './html';

export const CLIP_ROWS = 10_000;
export const CLIP_COLUMNS = 256;
/** The attribute that carries OpenNote's own form on the copied table. */
export const OWN_ATTRIBUTE = 'data-opennote-cells';

export interface ClipCell {
  /** The shown text, as plain text. */
  text: string;
  /** OpenNote's own form: the cell's Markdown, exact. */
  markdown?: string;
  num?: number;
  bool?: boolean;
  /** An error value such as #N/A that a formula showed. */
  error?: string;
  /** The formula in R1C1 form; absolute rows count spreadsheet rows (row 1 is the source's first row). */
  formula?: string;
  style?: CellStyle;
  /** A note on the cell, as Markdown (OpenNote's own form). */
  note?: string;
  /** A th cell, or bold text. */
  header?: boolean;
}

/** A merged block of the clip, by position. */
export interface ClipSpan {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

/** Where an OpenNote copy came from, for Paste link. */
export interface ClipLink {
  block: string;
  name?: string;
  /** The grid position of the copied block's first cell, header row included. */
  top: number;
  left: number;
  header: boolean;
}

export interface Clip {
  source: PasteSource | 'opennote';
  rows: ClipCell[][];
  spans: ClipSpan[];
  /** Column widths in CSS pixels, or null where the source gave none. */
  widths: (number | null)[];
  link?: ClipLink;
  /** Rows and columns past the limits, which are left out. */
  dropped?: { rows: number; cols: number };
}

const BLANK = (): ClipCell => ({ text: '' });

function sheetsJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The format code a source wrote outside CSS: Sheets' pattern or LibreOffice's `sdnum`. */
function attributeFormat(attrs: Map<string, string>): string | null {
  const pattern = sheetsJson(attrs.get('data-sheets-numberformat'))?.['2'];
  if (typeof pattern === 'string' && pattern !== '' && pattern !== 'General') return pattern;
  const sdnum = attrs.get('sdnum')?.split(';');
  const code = sdnum && sdnum.length >= 3 ? sdnum.slice(2).join(';') : null;
  return code && code !== 'General' && code !== 'Standard' ? code : null;
}

function readValue(cell: ClipCell, attrs: Map<string, string>): void {
  const raw = attrs.get('x:num') ?? attrs.get('sdval');
  if (raw !== undefined) {
    const n = Number(raw === '' ? cell.text.replace(/,/g, '') : raw);
    if (cell.text !== '' && Number.isFinite(n)) cell.num = n;
  }
  if (attrs.has('x:bool')) cell.bool = (attrs.get('x:bool') || cell.text).toUpperCase() === 'TRUE';
  if (attrs.has('x:err')) cell.error = attrs.get('x:err') || cell.text;
  const sheets = attrs.get('data-sheets-value');
  if (sheets) Object.assign(cell, sheetsValue(sheets));
  if (sheets && sheetsJson(sheets)?.['1'] === 5) cell.error = cell.text;
}

function readFormula(cell: ClipCell, attrs: Map<string, string>, row: number, col: number): void {
  const sheets = attrs.get('data-sheets-formula');
  const excel = attrs.get('x:fmla');
  if (sheets && sheets.startsWith('=')) cell.formula = sheets;
  else if (excel && excel.startsWith('=')) cell.formula = a1ToR1C1(excel, { row, col });
}

interface Raw {
  tag: string;
  attrs: Map<string, string>;
  inner: string;
  cols: number;
  rows: number;
}

function spanOf(attrs: Map<string, string>, name: string, limit: number): number {
  const n = parseInt(attrs.get(name) ?? '1', 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, limit) : 1;
}

/** The rows of the table as raw cells, hidden rows left out. */
function rawRows(table: string): Raw[][] {
  const rows: Raw[][] = [];
  for (const chunk of table.split(/<\/tr\s*>/i)) {
    const open = /<tr\b([^>]*)>/i.exec(chunk);
    if (!open || /display\s*:\s*none/i.test(open[1])) continue;
    if (rows.length > CLIP_ROWS) break;
    rows.push(
      [...chunk.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)].map((m) => {
        const attrs = attributes(m[2]);
        return {
          tag: m[1],
          attrs,
          inner: m[3],
          cols: spanOf(attrs, 'colspan', CLIP_COLUMNS),
          rows: spanOf(attrs, 'rowspan', CLIP_ROWS),
        };
      }),
    );
  }
  return rows;
}

/** Column widths from `<col>` elements, which may repeat with `span`. */
function widthsOf(table: string): (number | null)[] {
  const out: (number | null)[] = [];
  for (const m of table.matchAll(/<col\b([^>]*)>/gi)) {
    const attrs = attributes(m[1]);
    const css = /width\s*:\s*([\d.]+\s*(?:pt|px))/i.exec(attrs.get('style') ?? '')?.[1];
    const points = css ? cssPoints(css) : null;
    const px = points !== null ? points / 0.75 : Number(attrs.get('width'));
    const repeat = spanOf(attrs, 'span', CLIP_COLUMNS);
    for (let k = 0; k < repeat && out.length < CLIP_COLUMNS; k++) out.push(Number.isFinite(px) && px > 0 ? px : null);
  }
  return out;
}

/** Lays out raw rows on a grid: a cell takes the first free slot, and a span covers the slots it reaches. */
function layout(
  rows: Raw[][],
  read: (raw: Raw, row: number, col: number) => ClipCell,
): { cells: ClipCell[][]; spans: ClipSpan[]; width: number } {
  const taken: boolean[][] = [];
  const cells: ClipCell[][] = [];
  const spans: ClipSpan[] = [];
  let width = 0;
  rows.forEach((row, r) => {
    cells[r] ??= [];
    taken[r] ??= [];
    let c = 0;
    for (const raw of row) {
      while (taken[r][c]) c++;
      if (c >= CLIP_COLUMNS) break;
      cells[r][c] = read(raw, r, c);
      const h = Math.min(raw.rows, rows.length - r);
      const w = Math.min(raw.cols, CLIP_COLUMNS - c);
      for (let dr = 0; dr < h; dr++) {
        taken[r + dr] ??= [];
        for (let dc = 0; dc < w; dc++) taken[r + dr][c + dc] = true;
      }
      if (h > 1 || w > 1) spans.push({ row: r, col: c, rows: h, cols: w });
      c += w;
      width = Math.max(width, c);
    }
    width = Math.max(width, taken[r].length);
  });
  for (const row of cells) for (let c = 0; c < width; c++) row[c] ??= BLANK();
  return { cells, spans, width };
}

function fromHtmlTable(html: string, inner: string): Clip | null {
  const rules = styleRules(html);
  const raws = rawRows(inner);
  if (raws.length === 0) return null;
  const styles: CellStyle[] = [];
  const { cells, spans, width } = layout(raws, (raw, row, col) => {
    const cell: ClipCell = { text: plainText(raw.inner) };
    const decl = cellDeclarations(rules, raw.attrs.get('class') ?? '', raw.attrs.get('style') ?? '');
    const style = styleOf(decl, raw.attrs.get('align'));
    const code = attributeFormat(raw.attrs);
    if (code && !style.fmt) style.fmt = code;
    if (/<(b|strong)\b/i.test(raw.inner)) style.font = { ...style.font, bold: true };
    readValue(cell, raw.attrs);
    readFormula(cell, raw.attrs, row, col);
    if (raw.tag.toLowerCase() === 'th' || style.font?.bold) cell.header = true;
    cell.style = style;
    styles.push(style);
    return cell;
  });
  dropShared(styles);
  for (const row of cells) {
    for (const cell of row) {
      const style = cell.style ? validStyle(cell.style as never) : undefined;
      if (style && Object.keys(style).length > 0) cell.style = style;
      else delete cell.style;
    }
  }
  const widths = widthsOf(inner).slice(0, width);
  return { source: detectSource(html), rows: cells, spans, widths };
}

/** Reads the first table of clipboard HTML when nothing but the table is there. */
export function clipFromHtml(input: string): Clip | null {
  const start = input.indexOf('<');
  if (start === -1) return null;
  const html = input.slice(start);
  const match = /<table\b([^>]*)>([\s\S]*?)<\/table\s*>/i.exec(html);
  if (!match || (html.match(/<table\b/gi) ?? []).length !== 1) return null;
  const own = attributes(match[1]).get(OWN_ATTRIBUTE);
  if (own) {
    const clip = readOwn(own);
    if (clip) return clip;
  }
  if (!isOnlyTable(html.replace(match[0], ''))) return null;
  return fromHtmlTable(html, match[2]);
}

/** Tab-separated text as cells, or null when it is one value with no tab or line break. */
export function clipFromText(text: string): Clip | null {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (!body.includes('\t') && !body.includes('\n')) return null;
  const rows = parseDelimited(body, '\t')
    .slice(0, CLIP_ROWS)
    .map((fields) => fields.slice(0, CLIP_COLUMNS).map((field): ClipCell => ({ text: field })));
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((row) => row.length));
  for (const row of rows) while (row.length < width) row.push(BLANK());
  return { source: 'delimited', rows, spans: [], widths: [] };
}

/** The clipboard as cells: its HTML table when it has one, else its tab-separated text. */
export function readClip(input: { html?: string | null; text?: string | null }): Clip | null {
  return (input.html ? clipFromHtml(input.html) : null) ?? (input.text ? clipFromText(input.text) : null);
}

// OpenNote's own form. Version 1:
// {"v":1, "block", "name", "header", "top", "left",
//  "rows": [[{"m": markdown, "f": R1C1, "s": style, "v": value, "n": note}]], "spans": [...], "widths": [...]}

export interface OwnCell {
  m: string;
  f?: string;
  s?: CellStyle;
  v?: number | string | boolean | { e: string };
  n?: string;
  t?: string;
}

export interface OwnForm {
  v: 1;
  block?: string;
  name?: string;
  header: boolean;
  top: number;
  left: number;
  rows: OwnCell[][];
  spans: ClipSpan[];
  widths: (number | null)[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function ownCell(value: unknown): ClipCell {
  if (!isRecord(value) || typeof value.m !== 'string') return BLANK();
  const cell: ClipCell = { text: typeof value.t === 'string' ? value.t : value.m, markdown: value.m };
  if (typeof value.f === 'string' && value.f.startsWith('=')) cell.formula = value.f;
  const v = value.v;
  if (typeof v === 'number' && Number.isFinite(v)) cell.num = v;
  else if (typeof v === 'boolean') cell.bool = v;
  else if (isRecord(v) && typeof v.e === 'string') cell.error = v.e;
  if (isRecord(value.s)) {
    const style = validStyle(value.s as never);
    if (Object.keys(style).length > 0) cell.style = style;
  }
  if (typeof value.n === 'string' && value.n !== '') cell.note = value.n;
  return cell;
}

const whole = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/** Reads OpenNote's own form, or null when it is not one this version knows. */
export function readOwn(json: string): Clip | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== 1 || !Array.isArray(data.rows) || data.rows.length === 0) return null;
  const rows = data.rows.slice(0, CLIP_ROWS).map((row) => (Array.isArray(row) ? row.slice(0, CLIP_COLUMNS) : []));
  const width = Math.max(...rows.map((row) => row.length));
  if (width === 0) return null;
  const cells = rows.map((row) => Array.from({ length: width }, (_, c) => ownCell(row[c])));
  const spans = (Array.isArray(data.spans) ? data.spans : []).filter(
    (s): s is ClipSpan =>
      isRecord(s) &&
      whole(s.row, 0, cells.length - 1) &&
      whole(s.col, 0, width - 1) &&
      whole(s.rows, 1, cells.length - (s.row as number)) &&
      whole(s.cols, 1, width - (s.col as number)),
  );
  const widths = (Array.isArray(data.widths) ? data.widths : [])
    .slice(0, width)
    .map((w) => (typeof w === 'number' && w > 0 && w < 10_000 ? w : null));
  const clip: Clip = { source: 'opennote', rows: cells, spans, widths };
  if (typeof data.block === 'string' && whole(data.top, 0, 1e6) && whole(data.left, 0, 1e6)) {
    clip.link = {
      block: data.block,
      top: data.top,
      left: data.left,
      header: data.header === true,
      ...(typeof data.name === 'string' ? { name: data.name } : {}),
    };
  }
  return clip;
}
