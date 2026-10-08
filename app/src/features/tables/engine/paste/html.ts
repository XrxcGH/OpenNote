// Reads a table from clipboard HTML. Patterns find the table, its rows, and its cells' attributes; the words in a
// cell and around the table are read with the browser's parser (markupText), so cell text is plain text, never
// markup. The app passes only HTML it has already made inert.
// Excel gives the raw number in `x:num` and its number format in a style block. Google Sheets gives both in
// `data-sheets-value`. LibreOffice gives `sdval` and `sdnum`. Anything else is a plain HTML table.

import { markupText } from '../../../../core/markupText';
import { hintFromFormat, type FormatHint } from './formatHints';

export interface PasteCell {
  text: string;
  /** The source's own number: 0.255 for a cell that shows 25.5%. For a date it is an Excel serial. */
  num?: number;
  hint?: FormatHint;
  bool?: boolean;
  /** A header cell: a th, or bold text. */
  header?: boolean;
  /** The source cell held a formula, which isn't kept. */
  formula?: boolean;
}

export type PasteSource = 'excel' | 'sheets' | 'calc' | 'html' | 'delimited';

export interface HtmlGrid {
  rows: PasteCell[][];
  source: PasteSource;
}

const HARD_ROWS = 100_000;
const HARD_COLUMNS = 1_000;
const BLANK: PasteCell = Object.freeze({ text: '' });
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? whole;
    const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function attributes(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of text.matchAll(/([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    map.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return map;
}

function msoFormat(css: string): string | null {
  const m = /mso-number-format\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^;}]*))/i.exec(css);
  return m ? (m[1] ?? m[2] ?? m[3]).trim() : null;
}

/** The hint for each style class that sets an Excel number format. */
function classHints(html: string): Map<string, FormatHint> {
  const hints = new Map<string, FormatHint>();
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of block[1].matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const code = msoFormat(rule[2]);
      const hint = code === null ? null : hintFromFormat(code);
      if (hint) hints.set(rule[1], hint);
    }
  }
  return hints;
}

function detectSource(html: string): PasteSource {
  if (/urn:schemas-microsoft-com:office:excel|Excel\.Sheet/i.test(html)) return 'excel';
  if (/google-sheets-html-origin|data-sheets-value/i.test(html)) return 'sheets';
  if (/\bsdval=|LibreOffice|OpenOffice/i.test(html)) return 'calc';
  return 'html';
}

/** A cell's words: each `<br>` starts a line, and any other run of white space is one space. */
function plainText(inner: string): string {
  return markupText(inner)
    .split('\n')
    .map((line) => line.replace(/[\s\u00a0]+/g, ' ').trim())
    .join('\n')
    .trim();
}

function sheetsValue(json: string): Pick<PasteCell, 'num' | 'bool'> {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    if (data['1'] === 3 && typeof data['3'] === 'number') return { num: data['3'] };
    if (data['1'] === 4 && typeof data['4'] === 'boolean') return { bool: data['4'] };
  } catch {
    // Not JSON: the cell keeps its shown text.
  }
  return {};
}

function sheetsHint(json: string | undefined): FormatHint | undefined {
  try {
    const pattern = (JSON.parse(json ?? '{}') as Record<string, unknown>)['2'];
    return typeof pattern === 'string' ? (hintFromFormat(pattern) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/** The source's own value and format for a cell, from whichever attributes its source writes. */
function sourceValue(attrs: Map<string, string>, classes: Map<string, FormatHint>): Partial<PasteCell> {
  const out: Partial<PasteCell> = {};
  const num = attrs.get('x:num') ?? attrs.get('sdval');
  if (num !== undefined && num !== '' && Number.isFinite(Number(num))) out.num = Number(num);
  if (attrs.has('x:bool')) out.bool = attrs.get('x:bool')?.toUpperCase() === 'TRUE';
  if (attrs.has('x:fmla')) out.formula = true;
  const sheets = attrs.get('data-sheets-value');
  if (sheets) Object.assign(out, sheetsValue(sheets));
  const code = msoFormat(attrs.get('style') ?? '') ?? attrs.get('sdnum')?.split(';')[2];
  const named = (attrs.get('class') ?? '').split(/\s+/).map((c) => classes.get(c));
  out.hint =
    (code ? hintFromFormat(code) : null) ?? named.find(Boolean) ?? sheetsHint(attrs.get('data-sheets-numberformat'));
  if (out.hint === undefined) delete out.hint;
  return out;
}

function readCell(tag: string, attrs: Map<string, string>, inner: string, classes: Map<string, FormatHint>): PasteCell {
  const bold = /<(b|strong)\b/i.test(inner) || /font-weight\s*:\s*(bold|[6-9]00)/i.test(attrs.get('style') ?? '');
  const cell: PasteCell = { text: plainText(inner), ...sourceValue(attrs, classes) };
  if (tag.toLowerCase() === 'th' || bold) cell.header = true;
  return cell;
}

function span(attrs: Map<string, string>, name: string, limit: number): number {
  const n = parseInt(attrs.get(name) ?? '1', 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, limit) : 1;
}

/** Puts the cells of one row in place, skipping columns that a cell above still covers with a row span. */
function placeRow(cells: { cell: PasteCell; cols: number; rows: number }[], spans: number[]): PasteCell[] {
  const row: PasteCell[] = [];
  let col = 0;
  const fillSpans = (): void => {
    while (spans[col] > 0) {
      row[col] = BLANK;
      spans[col]--;
      col++;
    }
  };
  for (const { cell, cols, rows } of cells) {
    fillSpans();
    if (col >= HARD_COLUMNS) break;
    row[col] = cell;
    for (let k = 1; k < cols; k++) row[col + k] = BLANK;
    if (rows > 1) for (let k = 0; k < cols; k++) spans[col + k] = rows - 1;
    col += cols;
  }
  fillSpans();
  return row;
}

function readRows(table: string, classes: Map<string, FormatHint>): PasteCell[][] {
  const spans: number[] = [];
  const rows: PasteCell[][] = [];
  for (const chunk of table.split(/<\/tr\s*>/i)) {
    const open = /<tr\b([^>]*)>/i.exec(chunk);
    if (!open || /display\s*:\s*none/i.test(open[1]) || rows.length >= HARD_ROWS) continue;
    const cells = [...chunk.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)].map((m) => {
      const attrs = attributes(m[2]);
      return {
        cell: readCell(m[1], attrs, m[3], classes),
        cols: span(attrs, 'colspan', 100),
        rows: span(attrs, 'rowspan', 10_000),
      };
    });
    rows.push(placeRow(cells, spans));
  }
  return rows;
}

/** True when nothing but whitespace, comments, and head content surrounds the table. */
function isOnlyTable(outside: string): boolean {
  return markupText(outside).replace(/[\s\u00a0]+/g, '') === '';
}

/**
 * Reads the one table in clipboard HTML, or returns null when the HTML holds no table, several, or text around
 * one. Windows clipboard headers ("Version:0.9 StartHTML:...") before the first tag are ignored.
 */
export function parseHtmlTable(input: string): HtmlGrid | null {
  const start = input.indexOf('<');
  if (start === -1) return null;
  const html = input.slice(start);
  const match = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/i.exec(html);
  if (!match || (html.match(/<table\b/gi) ?? []).length !== 1) return null;
  if (!isOnlyTable(html.replace(match[0], ''))) return null;
  const rows = readRows(match[1], classHints(html));
  return rows.length === 0 ? null : { rows, source: detectSource(html) };
}
