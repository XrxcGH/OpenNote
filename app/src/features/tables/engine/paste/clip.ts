// The clipboard as cells (ADR 0067): what a paste into a table reads. Each cell keeps its shown text, its own value,
// its formula in R1C1 form, and its style; merged cells are spans, and column widths come along.
//
// Sources, best first:
// - OpenNote's own form: JSON in the table's `data-opennote-cells` attribute, exact between OpenNote tables.
// - Google Sheets: `data-sheets-value`, `data-sheets-formula` (already R1C1), `data-sheets-numberformat`, inline CSS.
// - Excel: `x:num`, `x:bool`, `x:fmla`, classes of a style block. Excel's HTML does not say where the copy began, so
//   an `x:fmla` is kept only when, read from A1, it stays inside the copied box; any other pastes as its value.
// - LibreOffice: `sdval`, `sdnum`, inline CSS.
// - Any other HTML table, and tab-separated text.
// Everything read here is data: text is plain text, styles go through the sheet model's validator, and formulas are
// text that the engine parses like typed text.

import type { CellStyle } from '../../sheet/model/types';
import type { JsonObject } from '../../sheet/model/json';
import { validStyle } from '../../sheet/model/styles';
import { cellDeclarations, cssPoints, dropShared, styleOf, styleRules } from './css';
import { parseDelimited } from './delimited';
import { a1ToR1C1, staysInBox } from './formula';
import { attributes, detectSource, isOnlyTable, plainText, sheetsValue, type PasteSource } from './html';
import { MAX_COLUMNS, MAX_ROWS } from './infer';

/** The same limits as a pasted table (infer.ts). */
export const CLIP_ROWS = MAX_ROWS;
export const CLIP_COLUMNS = MAX_COLUMNS;
/** Clipboard HTML past this length is not read as cells; the plain text stands in, so hostile input stays fast. */
export const CLIP_HTML_LIMIT = 2_000_000;
/** An inline style longer than this is not read. */
const STYLE_LIMIT = 4_096;
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
  /** The source marks the cell as text (a Sheets string value), so text that starts with "=" stays text. */
  textOnly?: boolean;
  /** The index of the cell's validation rule in `Clip.rules` (OpenNote's own form). */
  rule?: number;
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
  /** The page the copied table is on. */
  page?: string;
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
  /** Formulas that could not be translated (an Excel copy that did not begin at A1), so their values came instead. */
  asValues?: boolean;
  /** The validation rules of the copied cells, without their ranges (OpenNote's own form). */
  rules?: JsonObject[];
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
  const kind = sheets ? sheetsJson(sheets)?.['1'] : undefined;
  if (kind === 5) cell.error = cell.text;
  // Type 2 is a string value: the cell holds text, even text that starts with "=".
  if (kind === 2) cell.textOnly = true;
}

/** Reads a Sheets formula (already R1C1), or returns an Excel A1 formula for the box check after layout. */
function readFormula(cell: ClipCell, attrs: Map<string, string>): string | null {
  const sheets = attrs.get('data-sheets-formula');
  const excel = attrs.get('x:fmla');
  if (sheets && sheets.startsWith('=')) cell.formula = sheets;
  else if (excel && excel.startsWith('=')) return excel;
  return null;
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

/**
 * A cell: its tag, its attributes, and its content up to its end tag or the next cell, as an HTML parser closes an
 * unclosed cell. Neither part runs past the next cell, so the scan stays linear on hostile input.
 */
const CELL = /<(td|th)\b([^<>]*)>((?:(?!<\/?t[dh]\b)[\s\S])*)(?:<\/\1\s*>)?/gi;

/** The rows of the table as raw cells, hidden rows left out, and how many rows were past the limit. */
function rawRows(table: string): { rows: Raw[][]; dropped: number } {
  const rows: Raw[][] = [];
  let dropped = 0;
  for (const chunk of table.split(/<\/tr\s*>/i)) {
    const open = /<tr\b([^<>]*)>/i.exec(chunk);
    if (!open || /display\s*:\s*none/i.test(open[1])) continue;
    if (rows.length >= CLIP_ROWS) {
      dropped++;
      continue;
    }
    rows.push(
      [...chunk.matchAll(CELL)].map((m) => {
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
  return { rows, dropped };
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
): { cells: ClipCell[][]; spans: ClipSpan[]; width: number; droppedCols: number } {
  const taken: boolean[][] = [];
  const cells: ClipCell[][] = [];
  const spans: ClipSpan[] = [];
  let width = 0;
  let droppedCols = 0;
  rows.forEach((row, r) => {
    cells[r] ??= [];
    taken[r] ??= [];
    let c = 0;
    for (const [i, raw] of row.entries()) {
      while (taken[r][c]) c++;
      if (c >= CLIP_COLUMNS) {
        droppedCols = Math.max(droppedCols, row.length - i);
        break;
      }
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
  return { cells, spans, width, droppedCols };
}

function fromHtmlTable(html: string, inner: string): Clip | null {
  const rules = styleRules(html);
  const { rows: raws, dropped } = rawRows(inner);
  if (raws.length === 0) return null;
  const styles: CellStyle[] = [];
  const excel: { cell: ClipCell; formula: string; row: number; col: number }[] = [];
  const { cells, spans, width, droppedCols } = layout(raws, (raw, row, col) => {
    const cell: ClipCell = { text: plainText(raw.inner) };
    const inline = raw.attrs.get('style') ?? '';
    const decl = cellDeclarations(rules, raw.attrs.get('class') ?? '', inline.length > STYLE_LIMIT ? '' : inline);
    const style = styleOf(decl, raw.attrs.get('align'));
    const code = attributeFormat(raw.attrs);
    if (code && !style.fmt) style.fmt = code;
    if (/<(b|strong)\b/i.test(raw.inner)) style.font = { ...style.font, bold: true };
    readValue(cell, raw.attrs);
    const formula = readFormula(cell, raw.attrs);
    if (formula) excel.push({ cell, formula, row, col });
    if (raw.tag.toLowerCase() === 'th' || style.font?.bold) cell.header = true;
    cell.style = style;
    styles.push(style);
    return cell;
  });
  let asValues = false;
  for (const { cell, formula, row, col } of excel) {
    if (staysInBox(formula, cells.length, width)) cell.formula = a1ToR1C1(formula, { row, col });
    else asValues = true;
  }
  dropShared(styles);
  for (const row of cells) {
    for (const cell of row) {
      const style = cell.style ? validStyle(cell.style as never) : undefined;
      if (style && Object.keys(style).length > 0) cell.style = style;
      else delete cell.style;
    }
  }
  const widths = widthsOf(inner).slice(0, width);
  const clip: Clip = { source: detectSource(html), rows: cells, spans, widths };
  if (dropped > 0 || droppedCols > 0) clip.dropped = { rows: dropped, cols: droppedCols };
  if (asValues) clip.asValues = true;
  return clip;
}

/** Reads the first table of clipboard HTML when nothing but the table is there. */
export function clipFromHtml(input: string): Clip | null {
  const start = input.indexOf('<');
  if (start === -1) return null;
  const html = input.slice(start);
  // Counted first, so the table pattern below runs once and stays linear.
  if ((html.match(/<table\b/gi) ?? []).length !== 1) return null;
  const match = /<table\b([^<>]*)>([\s\S]*?)<\/table\s*>/i.exec(html);
  if (!match) return null;
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
  const all = parseDelimited(body, '\t');
  let widest = 0;
  for (const fields of all) widest = Math.max(widest, fields.length);
  const rows = all
    .slice(0, CLIP_ROWS)
    .map((fields) => fields.slice(0, CLIP_COLUMNS).map((field): ClipCell => ({ text: field })));
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((row) => row.length));
  for (const row of rows) while (row.length < width) row.push(BLANK());
  const clip: Clip = { source: 'delimited', rows, spans: [], widths: [] };
  const dropped = { rows: all.length - rows.length, cols: Math.max(0, widest - CLIP_COLUMNS) };
  if (dropped.rows > 0 || dropped.cols > 0) clip.dropped = dropped;
  return clip;
}

/** The clipboard as cells: its HTML table when it has one, else its tab-separated text. */
export function readClip(input: { html?: string | null; text?: string | null }): Clip | null {
  const html = input.html && input.html.length <= CLIP_HTML_LIMIT ? input.html : null;
  return (html ? clipFromHtml(html) : null) ?? (input.text ? clipFromText(input.text) : null);
}

// OpenNote's own form, version 1, is this JSON object
// {"v":1, "block", "name", "header", "top", "left",
//  "rows": [[{"m": markdown, "f": R1C1, "s": style, "v": value, "n": note, "r": rule}]], "spans": [...],
//  "widths": [...], "rules": [validation rule without its ranges]}.
// The keys "r" and "rules" are optional, so a reader that does not know them still reads the cells.

export interface OwnCell {
  m: string;
  f?: string;
  s?: CellStyle;
  v?: number | string | boolean | { e: string };
  n?: string;
  t?: string;
  /** The index of the cell's validation rule in `OwnForm.rules`. */
  r?: number;
}

export interface OwnForm {
  v: 1;
  block?: string;
  name?: string;
  /** The page the copied table is on, so Paste link across tables stays on one page. */
  page?: string;
  header: boolean;
  top: number;
  left: number;
  rows: OwnCell[][];
  spans: ClipSpan[];
  widths: (number | null)[];
  rules?: JsonObject[];
}

/** The most validation rules, and the longest rule, that a paste reads from OpenNote's own form. */
export const CLIP_RULES = 64;
const RULE_TEXT_LIMIT = 4_096;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function ownCell(value: unknown, rules: number): ClipCell {
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
  if (whole(value.r, 0, rules - 1)) cell.rule = value.r;
  return cell;
}

const whole = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/** The validation rules of an own form: objects of bounded size, without ranges. A bad rule becomes an empty one. */
function ownRules(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, CLIP_RULES).map((rule): JsonObject => {
    if (!isRecord(rule) || JSON.stringify(rule).length > RULE_TEXT_LIMIT) return {};
    const { ranges: _ranges, ...rest } = rule;
    return rest as JsonObject;
  });
}

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
  const rules = ownRules(data.rules);
  const cells = rows.map((row) => Array.from({ length: width }, (_, c) => ownCell(row[c], rules.length)));
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
  if (rules.length > 0) clip.rules = rules;
  if (typeof data.block === 'string' && whole(data.top, 0, 1e6) && whole(data.left, 0, 1e6)) {
    clip.link = {
      block: data.block,
      top: data.top,
      left: data.left,
      header: data.header === true,
      ...(typeof data.name === 'string' ? { name: data.name } : {}),
      ...(typeof data.page === 'string' ? { page: data.page } : {}),
    };
  }
  let widest = 0;
  for (const row of data.rows) if (Array.isArray(row)) widest = Math.max(widest, row.length);
  const dropped = { rows: data.rows.length - rows.length, cols: Math.max(0, widest - CLIP_COLUMNS) };
  if (dropped.rows > 0 || dropped.cols > 0) clip.dropped = dropped;
  return clip;
}
