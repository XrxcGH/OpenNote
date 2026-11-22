// checks-disable-file brand-consistency: colors and sizes here are clipboard CSS for other apps or test inputs, not design values.
// Copying cells (ADR 0067). One copy writes three forms:
// - HTML with inline CSS that Excel, Google Sheets, and LibreOffice read: Excel's `x:num`, `x:bool`, and `x:fmla`
//   with `mso-number-format`, and Sheets' `data-sheets-value`, `data-sheets-formula` (R1C1), and
//   `data-sheets-numberformat`. Merged cells are `colspan` and `rowspan`.
// - Tab-separated text of the shown values.
// - OpenNote's own form, JSON on the table's `data-opennote-cells`, so a paste into another OpenNote table is exact.
//
// `x:fmla` counts relative references as if the copy began at A1, which is how the paste side reads it too.
// Absolute rows count spreadsheet rows, so they gain one when the table has a header row.

import type { TableData } from '../../../editor/schema/specs';
import type { Locale } from '../engine/locale';
import { generalText, render } from '../engine/numfmt';
import { OWN_ATTRIBUTE, type ClipSpan, type OwnCell, type OwnForm } from '../engine/paste/clip';
import { a1ToR1C1, isFormula, r1c1ToA1 } from '../engine/paste/formula';
import { activeMerges, gridOf, layer, readableText, resolve, valueAt } from '../sheet/model';
import type { Box, CachedValue, CellStyle, Sheet } from '../sheet/model';
import { own, ownObject } from '../sheet/model/json';
import { cssLine } from '../sheet/render/borders';
import { colorOf } from '../sheet/render/color';

export interface CopyInput {
  table: TableData;
  sheet: Sheet;
  /** The copied cells by grid position, the header row included. */
  box: Box;
  locale: Locale;
  /** This table block's ID and the table's name, for Paste link. */
  block?: string | undefined;
  name?: string | undefined;
  /** What a formula cell shows. Defaults to the sheet's cached values when they are fresh. */
  shownValue?(row: string, col: string): CachedValue | undefined;
}

export interface CopyOutput {
  html: string;
  text: string;
  own: OwnForm;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

function numberOf(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The style that draws on a cell, without the theme defaults: table, column, row, and cell layers. */
function styleAt(sheet: Sheet, table: TableData, row: string, col: string): CellStyle {
  const layers = resolve(sheet, table, row, col).layers.filter((l) => l.name !== 'defaults' && l.name !== 'look');
  return layers.reduce<CellStyle>((out, l) => layer(out, l.style), {});
}

const ALIGN_CSS: Readonly<Record<string, string>> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
};
const VALIGN_CSS: Readonly<Record<string, string>> = { top: 'top', middle: 'middle', bottom: 'bottom' };

/** The style as CSS declarations that Excel, Sheets, and LibreOffice read. Palette colors resolve in light mode. */
export function styleCss(style: CellStyle): string[] {
  const out: string[] = [];
  const color = (value: string | undefined) => colorOf(value, 'light');
  const f = style.font;
  if (f?.bold || (f?.weight ?? 0) >= 600) out.push('font-weight:700');
  if (f?.italic) out.push('font-style:italic');
  const lines = [
    f?.underline && f.underline !== 'none' ? 'underline' : '',
    f?.strike && f.strike !== 'none' ? 'line-through' : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (lines) out.push(`text-decoration:${lines}`);
  if (f?.underline && /double/i.test(f.underline)) out.push('text-underline-style:double');
  const ink = color(f?.color);
  if (ink) out.push(`color:${ink}`);
  if (f?.size) out.push(`font-size:${f.size}pt`);
  if (f?.family && !f.family.startsWith('+')) out.push(`font-family:"${f.family.replace(/["\\]/g, '')}"`);
  if (f?.script === 'super' || f?.script === 'sub') out.push(`vertical-align:${f.script}`);
  const fill = style.fill;
  const back =
    typeof fill === 'string' ? color(fill) : fill && 'pattern' in fill ? color(fill.color ?? fill.back) : undefined;
  if (back) out.push(`background-color:${back}`);
  for (const [key, edge] of [
    ['t', 'top'],
    ['r', 'right'],
    ['b', 'bottom'],
    ['l', 'left'],
  ] as const) {
    const side = style.border?.[key];
    if (side && side.style !== 'none') out.push(`border-${edge}:${cssLine(side, color(side.color) ?? '#000000')}`);
  }
  const h = ALIGN_CSS[style.align?.h ?? ''];
  if (h) out.push(`text-align:${h}`);
  const v = VALIGN_CSS[style.align?.v ?? ''];
  if (v && f?.script === undefined) out.push(`vertical-align:${v}`);
  if (style.align?.wrap === 'wrap') out.push('white-space:normal');
  else if (style.align?.wrap) out.push('white-space:nowrap');
  if (style.fmt) out.push(`mso-number-format:"${style.fmt.replace(/\\/g, '\\\\').replace(/"/g, '\\0022')}"`);
  return out;
}

interface Copied {
  text: string;
  shown: string;
  value: number | string | boolean | { e: string } | null;
  r1c1?: string;
  style: CellStyle;
}

function readCell(input: CopyInput, gr: number, gc: number): Copied {
  const { table, sheet } = input;
  const grid = gridOf(table);
  const row = grid.rows[gr];
  const col = grid.cols[gc];
  const markdown = table.rows[gr].cells[col]?.markdown ?? '';
  const text = readableText(markdown);
  const style = styleAt(sheet, table, row, col);
  const header = table.header ? 1 : 0;
  const formula = gr >= header && isFormula(text);
  let value: Copied['value'];
  if (formula) {
    const cached = input.shownValue ? input.shownValue(row, col) : valueAt(sheet, table, row, col);
    value = cached === undefined ? null : cached;
  } else {
    const n = numberOf(text);
    value = n !== null ? n : /^(TRUE|FALSE)$/i.test(text.trim()) ? text.trim().toUpperCase() === 'TRUE' : text;
  }
  let shown: string;
  if (typeof value === 'number') {
    shown = style.fmt ? render(value, style.fmt, input.locale).text : formula ? generalText(value) : text;
  } else if (typeof value === 'boolean') shown = value ? 'TRUE' : 'FALSE';
  else if (value && typeof value === 'object') shown = value.e;
  else if (value === null) shown = formula ? text : '';
  else shown = value;
  const out: Copied = { text: markdown, shown, value, style };
  if (formula) out.r1c1 = a1ToR1C1(text, { row: gr - header, col: gc }, header);
  return out;
}

/** The merges inside the box, cut to it, as spans by position in the box. */
function spansIn(input: CopyInput): ClipSpan[] {
  const { box } = input;
  const out: ClipSpan[] = [];
  for (const merge of activeMerges(input.sheet, input.table)) {
    const top = Math.max(merge.box.top, box.top);
    const left = Math.max(merge.box.left, box.left);
    const bottom = Math.min(merge.box.bottom, box.bottom);
    const right = Math.min(merge.box.right, box.right);
    if (top > bottom || left > right || (top === bottom && left === right)) continue;
    out.push({ row: top - box.top, col: left - box.left, rows: bottom - top + 1, cols: right - left + 1 });
  }
  return out;
}

function sheetsValue(value: Copied['value'], shown: string): string | null {
  if (typeof value === 'number') return JSON.stringify({ 1: 3, 3: value });
  if (typeof value === 'boolean') return JSON.stringify({ 1: 4, 4: value });
  if (value && typeof value === 'object') return JSON.stringify({ 1: 2, 2: shown });
  return shown === '' ? null : JSON.stringify({ 1: 2, 2: shown });
}

function cellHtml(cell: Copied, at: { row: number; col: number }, span: ClipSpan | undefined): string {
  const attrs: string[] = [];
  if (span && span.cols > 1) attrs.push(`colspan="${span.cols}"`);
  if (span && span.rows > 1) attrs.push(`rowspan="${span.rows}"`);
  const css = styleCss(cell.style);
  if (css.length > 0) attrs.push(`style="${escapeHtml(css.join(';'))}"`);
  if (typeof cell.value === 'number') attrs.push(`x:num="${cell.value}"`);
  if (typeof cell.value === 'boolean') attrs.push(`x:bool="${cell.value ? 'TRUE' : 'FALSE'}"`);
  if (cell.r1c1) {
    attrs.push(`x:fmla="${escapeHtml(r1c1ToA1(cell.r1c1, at, 0))}"`);
    attrs.push(`data-sheets-formula="${escapeHtml(cell.r1c1)}"`);
  }
  const value = sheetsValue(cell.value, cell.shown);
  if (value) attrs.push(`data-sheets-value="${escapeHtml(value)}"`);
  if (cell.style.fmt) {
    attrs.push(`data-sheets-numberformat="${escapeHtml(JSON.stringify({ 1: 2, 2: cell.style.fmt, 3: 1 }))}"`);
  }
  const body = escapeHtml(cell.shown).replace(/\n/g, '<br>');
  return `<td${attrs.length > 0 ? ' ' + attrs.join(' ') : ''}>${body}</td>`;
}

/** A field of tab-separated text, quoted when it holds a tab, a line break, or a quote. */
function tsvField(text: string): string {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function ownCell(cell: Copied, note: string | undefined): OwnCell {
  const out: OwnCell = { m: cell.text, t: cell.shown };
  if (cell.r1c1) out.f = cell.r1c1;
  if (Object.keys(cell.style).length > 0) out.s = cell.style;
  if (cell.value !== null && typeof cell.value !== 'string') out.v = cell.value;
  if (note) out.n = note;
  return out;
}

/** The three clipboard forms of the cells in the box. */
export function copyCells(input: CopyInput): CopyOutput {
  const { box, table, sheet } = input;
  const grid = gridOf(table);
  const spans = spansIn(input);
  const covered = new Set<string>();
  const anchors = new Map<string, ClipSpan>();
  for (const s of spans) {
    anchors.set(`${s.row}:${s.col}`, s);
    for (let r = 0; r < s.rows; r++)
      for (let c = 0; c < s.cols; c++) if (r || c) covered.add(`${s.row + r}:${s.col + c}`);
  }
  const rowsHtml: string[] = [];
  const lines: string[] = [];
  const ownRows: OwnCell[][] = [];
  for (let gr = box.top; gr <= box.bottom; gr++) {
    const tds: string[] = [];
    const fields: string[] = [];
    const ownRow: OwnCell[] = [];
    for (let gc = box.left; gc <= box.right; gc++) {
      const at = { row: gr - box.top, col: gc - box.left };
      const cell = readCell(input, gr, gc);
      const note = own(ownObject(ownObject(ownObject(sheet, 'notes'), grid.rows[gr]), grid.cols[gc]), 'markdown');
      ownRow.push(ownCell(cell, typeof note === 'string' ? note : undefined));
      fields.push(tsvField(cell.shown));
      if (!covered.has(`${at.row}:${at.col}`)) tds.push(cellHtml(cell, at, anchors.get(`${at.row}:${at.col}`)));
    }
    rowsHtml.push(`<tr>${tds.join('')}</tr>`);
    lines.push(fields.join('\t'));
    ownRows.push(ownRow);
  }
  const widths = table.columns
    .slice(box.left, box.right + 1)
    .map((c) => (typeof c.width === 'number' ? c.width : null));
  const ownForm: OwnForm = {
    v: 1,
    header: table.header,
    top: box.top,
    left: box.left,
    rows: ownRows,
    spans,
    widths,
    ...(input.block ? { block: input.block } : {}),
    ...(input.name ? { name: input.name } : {}),
  };
  const cols = widths.map((w) => (w === null ? '<col>' : `<col width="${Math.round(w)}">`)).join('');
  const html =
    '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">' +
    '<style>br{mso-data-placement:same-cell}</style></head><body>' +
    `<table ${OWN_ATTRIBUTE}="${escapeHtml(JSON.stringify(ownForm))}" style="border-collapse:collapse">` +
    `<colgroup>${cols}</colgroup><tbody>${rowsHtml.join('')}</tbody></table></body></html>`;
  return { html, text: lines.join('\r\n') + '\r\n', own: ownForm };
}
