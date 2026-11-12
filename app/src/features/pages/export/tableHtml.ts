// A table block as HTML, with what the sheet adds: cached formula results, fills, borders, alignment, padding,
// fonts, and merged cells (format spec 6.3, ADR 0067). Without `data.sheet` the table is the plain one it always was.
// The Markdown export reads the same view, so both agree on what a cell shows.

import { MAX_HEIGHT, MIN_HEIGHT, renderNumberFormat, sheetModel } from '../../tables';
import { isObject, own as ownKey } from '../layout/json';
import type { JsonObject } from '../layout/json';
import { resolveColor } from '../../../ui/color';
import { escapeAttr, escapeHtml, parseInline, renderInlineHtml, voidEnd, type HtmlOptions } from './markdown';
import type { TableBlock } from './source';

/** The object under a key, or undefined. */
const sub = (o: JsonObject | undefined, key: string): JsonObject | undefined => {
  const v = ownKey(o, key);
  return isObject(v) ? v : undefined;
};

const px = (n: number): string => String(Math.round(n * 100) / 100);

/** What a table cell shows: its text with the result of a formula, or the cell's own Markdown. */
export interface CellView {
  /** Markdown to render, or null when `result` is the text. */
  readonly markdown: string | null;
  /** The cached result of a formula or spilled cell, as text. */
  readonly result: string | null;
}

export interface TableView {
  readonly like: sheetModel.TableLike;
  readonly sheet: Record<string, unknown> | undefined;
  /** True when formula cells had to keep their text because the cached results are stale. */
  stale: boolean;
  /** The merge whose top-left cell is at this row and column, as `row:col`. */
  readonly anchors: ReadonlyMap<string, sheetModel.Box>;
  /** The cells a merge covers, other than its anchor, as `row:col`. */
  readonly covered: ReadonlySet<string>;
  cell(row: number, col: number): CellView;
  style(row: number, col: number): sheetModel.CellStyle | null;
  /** The row height in page units, when the sheet sets one. */
  height(row: number): number | null;
}

function resultText(value: unknown, fmt?: string): string | null {
  const v = sheetModel.cachedValue(value as never);
  if (v === undefined || v === null) return v === null ? '' : null;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return v.e;
  // A number shows the way its cell's number format writes it, so 0.25 under `0%` is 25%.
  if (typeof v === 'number' && fmt !== undefined && fmt !== '') return renderNumberFormat(v, fmt);
  return String(v);
}

/** Reads the sheet of a table block once: cached results, merges, and the resolver of cell styles. */
export function tableView(block: TableBlock): TableView {
  const like: sheetModel.TableLike = {
    header: block.header,
    columns: block.columns,
    rows: block.rows.map((r) => ({
      id: r.id,
      cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, { markdown: v }])),
    })),
    smart: block.smart,
    sheet: block.sheet,
  };
  const sheet = block.sheet;
  const anchors = new Map<string, sheetModel.Box>();
  const covered = new Set<string>();
  const values = sub(sheet, 'values');
  const fresh = sheet !== undefined && ownKey(sheet, 'valuesOf') === sheetModel.fingerprint(like);
  const view: TableView = {
    like,
    sheet,
    stale: false,
    anchors,
    covered,
    cell(row, col) {
      const r = like.rows[row];
      const c = like.columns[col];
      const markdown = r && c ? (Object.hasOwn(r.cells, c.id) ? r.cells[c.id].markdown : '') : '';
      const stored = r && c ? ownKey(sub(values, r.id), c.id) : undefined;
      const formula = sheetModel.readableText(markdown).startsWith('=');
      if (formula) {
        const text = fresh ? resultText(stored === undefined ? null : stored, view.style(row, col)?.fmt) : null;
        if (text !== null) return { markdown: null, result: text };
        if (!fresh && sheet !== undefined) view.stale = true;
      } else if (markdown === '' && fresh && stored !== undefined) {
        const text = resultText(stored, view.style(row, col)?.fmt);
        if (text !== null) return { markdown: null, result: text };
      }
      return { markdown, result: null };
    },
    style(row, col) {
      if (!sheet || Object.keys(sheet).length === 0) return null;
      const r = like.rows[row];
      const c = like.columns[col];
      return r && c ? sheetModel.resolve(sheet as never, like, r.id, c.id).style : null;
    },
    height(row) {
      const r = like.rows[row];
      const h = r ? ownKey(sub(sub(sheet, 'rows'), r.id), 'height') : undefined;
      // The same bounds the structure commands keep (MIN_HEIGHT to MAX_HEIGHT).
      return typeof h === 'number' && Number.isFinite(h) && h > 0 ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)) : null;
    },
  };
  if (sheet) {
    for (const { box } of sheetModel.activeMerges(sheet as never, like)) {
      anchors.set(`${box.top}:${box.left}`, box);
      for (let r = box.top; r <= box.bottom; r++) {
        for (let c = box.left; c <= box.right; c++) if (r !== box.top || c !== box.left) covered.add(`${r}:${c}`);
      }
    }
  }
  return view;
}

// The 13 border styles of Excel's grammar, as CSS width, line, and the name.
const BORDERS: Record<string, [number, string]> = {
  thin: [1, 'solid'],
  hair: [1, 'solid'],
  dotted: [1, 'dotted'],
  dashed: [1, 'dashed'],
  dashDot: [1, 'dashed'],
  dashDotDot: [1, 'dashed'],
  mediumDashed: [2, 'dashed'],
  mediumDashDot: [2, 'dashed'],
  mediumDashDotDot: [2, 'dashed'],
  slantDashDot: [2, 'dashed'],
  medium: [2, 'solid'],
  thick: [3, 'solid'],
  double: [3, 'double'],
};

/** A stored color as `#rrggbb`, or null when it is outside the grammar. */
function color(value: string | undefined): string | null {
  return value === undefined ? null : resolveColor(value);
}

/** The CSS of one cell's resolved style, leaving out what the defaults of R-SHT-8 already give. */
export function cellCss(style: sheetModel.CellStyle): string {
  const css: string[] = [];
  const font = style.font ?? {};
  if (font.family && !font.family.startsWith('+') && !font.family.startsWith('theme:')) {
    // Only letters, digits, spaces, and a few marks stay, so no escape, function, or quote reaches the style.
    css.push(`font-family:${font.family.replace(/[^\p{L}\p{N} ,._-]/gu, '')}`);
  }
  if (font.size !== undefined) css.push(`font-size:${px(font.size)}pt`);
  const weight = font.weight ?? (font.bold === true ? 700 : font.bold === false ? 400 : undefined);
  if (weight !== undefined) css.push(`font-weight:${weight}`);
  if (font.italic !== undefined) css.push(`font-style:${font.italic ? 'italic' : 'normal'}`);
  const lines: string[] = [];
  if (font.underline && font.underline !== 'none') lines.push('underline');
  if (font.strike && font.strike !== 'none') lines.push('line-through');
  if (lines.length > 0) css.push(`text-decoration:${lines.join(' ')}`);
  const text = color(font.color);
  if (text) css.push(`color:${text}`);
  if (font.script === 'super') css.push('vertical-align:super;font-size:smaller');
  if (font.script === 'sub') css.push('vertical-align:sub;font-size:smaller');
  const fill = style.fill;
  if (typeof fill === 'string' && fill !== 'none') {
    const c = color(fill);
    if (c) css.push(`background-color:${c}`);
  } else if (fill && typeof fill === 'object' && 'pattern' in fill) {
    const c = color(fill.back) ?? color(fill.color);
    if (c) css.push(`background-color:${c}`);
  } else if (fill && typeof fill === 'object' && 'gradient' in fill) {
    const stops = fill.gradient.stops
      .map((s) => ({ at: s.at, c: color(s.color) }))
      .filter((s): s is { at: number; c: string } => s.c !== null)
      .map((s) => `${s.c} ${px(s.at * 100)}%`);
    if (stops.length >= 2)
      css.push(`background-image:linear-gradient(${fill.gradient.angle ?? 0}deg,${stops.join(',')})`);
  }
  const sides = { t: 'top', r: 'right', b: 'bottom', l: 'left' } as const;
  for (const [key, name] of Object.entries(sides)) {
    const side = style.border?.[key as keyof typeof sides];
    if (!side) continue;
    if (side.style === 'none') {
      css.push(`border-${name}:none`);
      continue;
    }
    const [width, line] = BORDERS[side.style] ?? [1, 'solid'];
    const w = side.width === undefined ? `${width}px` : `${px(side.width)}pt`;
    css.push(`border-${name}:${w} ${line} ${color(side.color) ?? 'currentcolor'}`);
  }
  const align = style.align ?? {};
  if (align.h === 'left' || align.h === 'center' || align.h === 'right' || align.h === 'justify') {
    css.push(`text-align:${align.h}`);
  }
  if (align.v === 'middle' || align.v === 'bottom') css.push(`vertical-align:${align.v}`);
  if (align.wrap === 'clip' || align.wrap === 'overflow') css.push('white-space:nowrap');
  const pad = { t: style.pad?.t ?? 2, r: style.pad?.r ?? 4, b: style.pad?.b ?? 2, l: style.pad?.l ?? 4 };
  pad.l += (align.indent ?? 0) * 9;
  if (pad.t !== 2 || pad.r !== 4 || pad.b !== 2 || pad.l !== 4) {
    css.push(`padding:${px(pad.t)}pt ${px(pad.r)}pt ${px(pad.b)}pt ${px(pad.l)}pt`);
  }
  return css.join(';');
}

/** The HTML of a table block. `onStale` hears of a table whose formulas could not show their results. */
export function tableHtml(
  block: TableBlock,
  options: HtmlOptions,
  xml?: boolean,
  onStale?: (id: string) => void,
): string {
  const view = tableView(block);
  const renderCell = (c: CellView) =>
    c.markdown === null ? escapeHtml(c.result ?? '') : renderInlineHtml(parseInline(c.markdown), options);
  const cell = (tag: 'th' | 'td', r: number, c: number): string => {
    if (view.covered.has(`${r}:${c}`)) return '';
    const box = view.anchors.get(`${r}:${c}`);
    const style = view.style(r, c);
    const css = style ? cellCss(style) : '';
    const spans =
      (box && box.right > box.left ? ` colspan="${box.right - box.left + 1}"` : '') +
      (box && box.bottom > box.top ? ` rowspan="${box.bottom - box.top + 1}"` : '');
    const scope = tag === 'th' ? ` scope="${box && box.right > box.left ? 'colgroup' : 'col'}"` : '';
    const styleAttr = css === '' ? '' : ` style="${escapeAttr(css)}"`;
    return `<${tag}${scope}${spans}${styleAttr}>${renderCell(view.cell(r, c))}</${tag}>`;
  };
  const row = (r: number, tag: 'th' | 'td') => {
    const h = view.height(r);
    const open = h === null ? '<tr>' : `<tr style="height:${px(h)}px">`;
    return `${open}${block.columns.map((_, c) => cell(tag, r, c)).join('')}</tr>`;
  };
  const indexes = block.rows.map((_, i) => i);
  // A merge from the header row into the body would be cut at the end of <thead>, which shifts the body cells. So the
  // header row stays a row of header cells in <tbody>, where the span can reach the rows below it.
  const crosses = [...view.anchors.values()].some((box) => box.top === 0 && box.bottom > 0);
  const inHead = block.header && indexes.length > 0 && !crosses;
  const head = inHead ? `<thead>${row(0, 'th')}</thead>\n` : '';
  const body = (inHead ? indexes.slice(1) : indexes)
    .map((r) => row(r, block.header && r === 0 ? 'th' : 'td'))
    .join('\n');
  const cols = block.columns.map((c) => `<col style="width:${px(c.width)}px"${voidEnd(xml)}`).join('');
  const html = `<table><colgroup>${cols}</colgroup>\n${head}<tbody>\n${body}\n</tbody></table>`;
  if (view.stale) onStale?.(block.id);
  return html;
}
