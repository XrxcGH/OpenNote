// What every cell, row, and table draws (ADR 0056, DESIGN 9). `drawTable` is pure: it resolves each cell's style,
// settles shared borders, and returns CSS custom properties and data attributes for the stylesheet (render.css)
// to use. The ProseMirror plugin turns the result into node decorations; tests read it directly. Sizes that need
// the browser's layout (overflow width, shrink, rotation height, sticky offsets) come from measure.ts.

import { resolve, type CellStyle, type ResolveHooks, type Sheet, type TableLike } from '../model';
import { own, ownObject } from '../model/json';
import { getConditionalLayer, getDrawnLayer, setLayerScheme, type DrawnDecoration } from '../model/rules';
import { kindOf, textAlign, verticalAlign, type ValueKind } from './align';
import { cssLine, resolvedSides, type Edge } from './borders';
import { automaticText, colorOf, drawFill, type Scheme } from './color';
import { namedLookFor } from './looks';
import { centerAcrossSpan, overflowCells, type RowCell } from './spill';
import { themeColor } from '../../../../ui/color/parse';

/** What a cell shows, when the engine knows better than the typed text. */
export interface Shown {
  text: string;
  kind?: ValueKind;
}

export interface DrawInput {
  sheet: Sheet;
  table: TableLike;
  scheme: Scheme;
  /** The shown value of a cell: a formula's result, for example. Without it the typed text is used. */
  shown?: (row: string, col: string) => Shown | undefined;
  /** Rows hidden by a filter, which Excel treats like hidden rows for banding. */
  hiddenRows?: ReadonlySet<string>;
  hooks?: ResolveHooks;
}

/** CSS custom properties and data attributes of one node. */
export interface Drawn {
  vars: Record<string, string>;
  data: Record<string, string>;
}

export interface DrawnTable {
  table: Drawn;
  /** By row position in the table (hidden rows too). */
  rows: Drawn[];
  /** By row and column position. */
  cells: Drawn[][];
  /** The rows whose cells were drawn anew when this came from an earlier drawing; unset when every row was. */
  changed?: ReadonlySet<number>;
}

const empty = (): Drawn => ({ vars: {}, data: {} });

const UNITS = { pad: 'pt', size: 'pt', height: 'px' } as const;

/** A `style` attribute value from custom properties. */
export function styleText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

function fontVars(style: CellStyle, vars: Record<string, string>, scheme: Scheme, under: string | undefined): void {
  const f = style.font ?? {};
  if (f.family && f.family !== '+body') {
    vars['--cell-font'] =
      f.family === '+heading' ? 'var(--font-ui)' : `${JSON.stringify(f.family)}, var(--font-reading)`;
  }
  if (typeof f.size === 'number') vars['--cell-size'] = `${f.size}${UNITS.size}`;
  const weight = typeof f.weight === 'number' ? f.weight : f.bold === true ? 700 : undefined;
  if (weight !== undefined) vars['--cell-weight'] = String(weight);
  if (f.italic === true) vars['--cell-style'] = 'italic';
  const lines: string[] = [];
  if (f.underline && f.underline !== 'none')
    lines.push(f.underline.startsWith('double') ? 'underline double' : 'underline');
  if (f.strike === 'single' || f.strike === 'double') lines.push('line-through');
  if (lines.length > 0) vars['--cell-deco'] = lines.join(' ');
  const color = f.color === undefined ? undefined : colorOf(f.color, scheme);
  if (color) vars['--cell-color'] = color;
  else if (under) vars['--cell-color'] = automaticText(under);
}

function borderVars(
  sides: Record<Edge, { style: string; color?: string; width?: number } | undefined>,
  grid: boolean,
  scheme: Scheme,
  vars: Record<string, string>,
  data: Record<string, string>,
): void {
  const ink = themeColor('text', scheme);
  for (const edge of ['t', 'r', 'b', 'l'] as const) {
    const side = sides[edge];
    if (side) {
      vars[`--cell-b${edge}`] = cssLine(side, colorOf(side.color, scheme) ?? ink);
      data[`data-b${edge}`] = side.style;
    } else if (grid) vars[`--cell-b${edge}`] = '1px solid var(--sheet-grid)';
  }
}

function diagonals(style: CellStyle, scheme: Scheme, vars: Record<string, string>): void {
  const ink = themeColor('text', scheme);
  const lines: string[] = [];
  for (const [key, dir] of [
    ['du', 'to top left'],
    ['dd', 'to bottom left'],
  ] as const) {
    const side = style.border?.[key];
    if (!side) continue;
    const c = colorOf(side.color, scheme) ?? ink;
    lines.push(
      `linear-gradient(${dir}, transparent calc(50% - 0.5px), ${c} calc(50% - 0.5px) calc(50% + 0.5px), transparent 0)`,
    );
  }
  if (lines.length > 0) vars['--cell-diag'] = lines.join(', ');
}

function alignVars(
  style: CellStyle,
  kind: ValueKind,
  vars: Record<string, string>,
  data: Record<string, string>,
): void {
  const a = style.align ?? {};
  vars['--cell-h'] = textAlign(a.h, kind);
  vars['--cell-v'] = verticalAlign(a.v);
  data['data-kind'] = kind;
  data['data-wrap'] = a.wrap ?? 'wrap';
  if (a.h === 'distributed') data['data-distributed'] = '';
  if (a.h === 'fill') data['data-fill-repeat'] = '';
  if (a.shrink === true) data['data-shrink'] = '';
  if (a.dir === 'rtl' || a.dir === 'ltr') vars['--cell-dir'] = a.dir;
  if (a.rotate === 'stacked') data['data-stacked'] = '';
  else if (typeof a.rotate === 'number' && a.rotate !== 0) {
    // Excel turns text counterclockwise for a positive angle; CSS turns clockwise.
    vars['--cell-rotate'] = `${-a.rotate}deg`;
    data['data-rotate'] = String(a.rotate);
  }
  if (typeof a.indent === 'number' && a.indent > 0) {
    const side = textAlign(a.h, kind) === 'right' ? 'r' : 'l';
    vars[`--cell-indent-${side}`] = `${a.indent * 3}ch`;
    if (a.h === 'distributed') vars['--cell-indent-r'] = `${a.indent * 3}ch`;
  }
}

function padVars(style: CellStyle, vars: Record<string, string>): void {
  for (const side of ['t', 'r', 'b', 'l'] as const) {
    const n = style.pad?.[side];
    if (typeof n === 'number') vars[`--cell-pad-${side}`] = `${n}${UNITS.pad}`;
  }
}

function hiddenOf(sheet: Sheet, kind: 'rows' | 'cols', id: string, extra?: ReadonlySet<string>): boolean {
  return own(ownObject(ownObject(sheet, kind), id), 'hidden') === true || extra?.has(id) === true;
}

/** Counts a freeze setting: an integer from 0 up to `max`. */
function freezeOf(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, max) : 0;
}

/** What `drawTable` works out once for a table: the view without hidden lines, and each visible cell's style and text. */
interface View {
  grid: boolean;
  frozenRows: number;
  frozenCols: number;
  /** The last shown frozen row and column (by table position), where the freeze line draws; -1 for none. */
  edgeRow: number;
  edgeCol: number;
  rowHidden: boolean[];
  colHidden: boolean[];
  visRows: number[];
  visCols: number[];
  styles: CellStyle[][];
  texts: RowCell[][];
  /** What the conditional lane draws in each shown cell besides its style: data bars and icons. */
  drawn: (DrawnDecoration | undefined)[][];
}

/** The text and kind of each shown cell of one shown row. */
function textRow(input: DrawInput, v: Pick<View, 'visCols' | 'styles'>, r: number, vr: number): RowCell[] {
  const row = input.table.rows[r];
  return v.visCols.map((c, vc) => {
    const col = input.table.columns[c];
    const typed = row.cells[col.id]?.markdown ?? '';
    const shown = input.shown?.(row.id, col.id);
    const text = shown?.text ?? typed;
    const kind = shown?.kind ?? (typed.startsWith('=') && !shown ? 'text' : kindOf(text));
    return { text, kind, align: v.styles[vr][vc].align ?? {} };
  });
}

function viewOf(input: DrawInput): View {
  const { sheet, table, scheme } = input;
  setLayerScheme(scheme);
  const settings = ownObject(sheet, 'table');
  const freeze = ownObject(settings, 'freeze');
  const rowHidden = table.rows.map((r) => hiddenOf(sheet, 'rows', r.id, input.hiddenRows));
  const colHidden = table.columns.map((c) => hiddenOf(sheet, 'cols', c.id));
  const visRows = table.rows.map((_, i) => i).filter((i) => !rowHidden[i]);
  const visCols = table.columns.map((_, i) => i).filter((i) => !colHidden[i]);
  // Looks, banding, and the first, last, and total elements count by position in the view (R-SHT-10), so a table
  // with the hidden rows and columns taken out is what the model resolves.
  const view: TableLike = {
    header: table.header === true && visRows[0] === 0,
    columns: visCols.map((i) => table.columns[i]),
    rows: visRows.map((i) => table.rows[i]),
  };
  const hooks: ResolveHooks = { namedLook: namedLookFor(scheme), ...input.hooks };
  const styles = visRows.map((r) =>
    visCols.map((c) => resolve(sheet, view, table.rows[r].id, table.columns[c].id, hooks).style),
  );
  const frozenRows = freezeOf(own(freeze, 'rows'), table.rows.length);
  const frozenCols = freezeOf(own(freeze, 'cols'), table.columns.length);
  const v: View = {
    grid: own(settings, 'grid') !== false,
    frozenRows,
    frozenCols,
    // The edge is the last frozen line that shows: a hidden last row or column hands it to the one before.
    edgeRow: visRows.filter((i) => i < frozenRows).at(-1) ?? -1,
    edgeCol: visCols.filter((i) => i < frozenCols).at(-1) ?? -1,
    rowHidden,
    colHidden,
    visRows,
    visCols,
    styles,
    texts: [],
    drawn: [],
  };
  const drawn = ownObject(sheet, 'conditional') === undefined ? null : getDrawnLayer();
  if (drawn) v.drawn = visRows.map((r) => visCols.map((c) => drawn({ row: r, col: c }, sheet, table, scheme)));
  v.texts = visRows.map((r, vr) => textRow(input, v, r, vr));
  return v;
}

/** True when `next` has the same rows and columns, sheet, and scheme as `last`: only the text can differ. */
function sameShape(last: DrawInput, next: DrawInput): boolean {
  if (
    last.sheet !== next.sheet ||
    last.scheme !== next.scheme ||
    last.hooks !== next.hooks ||
    last.hiddenRows !== next.hiddenRows ||
    last.table.header !== next.table.header ||
    last.table.rows.length !== next.table.rows.length ||
    last.table.columns.length !== next.table.columns.length
  )
    return false;
  return (
    last.table.rows.every((r, i) => r.id === next.table.rows[i].id) &&
    last.table.columns.every((c, i) => c.id === next.table.columns[i].id)
  );
}

/** The view of `input` from the view of `last`, working out again only the rows whose text changed. */
function updatedView(last: View, lastInput: DrawInput, input: DrawInput, changed: Set<number>): View {
  const sameShown = lastInput.shown === input.shown;
  const texts = last.texts.map((old, vr) => {
    const r = last.visRows[vr];
    const a = lastInput.table.rows[r];
    const b = input.table.rows[r];
    if (a === b && sameShown) return old;
    const typedSame = last.visCols.every((c) => {
      const id = input.table.columns[c].id;
      return a.cells[id]?.markdown === b.cells[id]?.markdown;
    });
    if (typedSame && sameShown) return old;
    const next = textRow(input, last, r, vr);
    if (next.every((t, vc) => t.text === old[vc].text && t.kind === old[vc].kind)) return old;
    changed.add(r);
    return next;
  });
  return { ...last, texts };
}

/**
 * True when a cell's style can depend on cell values: a conditional layer is set and the sheet has rules. Rules
 * read other cells too (top 10, above average, duplicates), so a text edit can restyle any row.
 */
function dependsOnValues(input: DrawInput): boolean {
  const layer = input.hooks?.conditional === undefined ? getConditionalLayer() : input.hooks.conditional;
  return !!layer && ownObject(input.sheet, 'conditional') !== undefined;
}

/** The view worked out in full; `changed` gets the rows whose style or text differs, and their neighbors (borders). */
function revisedView(last: View, input: DrawInput, changed: Set<number>): View {
  const v = viewOf(input);
  v.styles.forEach((row, vr) => {
    const same =
      JSON.stringify(row) === JSON.stringify(last.styles[vr]) &&
      JSON.stringify(v.drawn[vr]) === JSON.stringify(last.drawn[vr]) &&
      v.texts[vr].every((t, vc) => t.text === last.texts[vr][vc].text && t.kind === last.texts[vr][vc].kind);
    if (same) return;
    for (const k of [vr - 1, vr, vr + 1]) if (v.visRows[k] !== undefined) changed.add(v.visRows[k]);
  });
  return v;
}

/** The data attributes of the cell that centers or spills text across its empty neighbors. */
function spanData(row: readonly RowCell[], vc: number, data: Record<string, string>): void {
  const spill = overflowCells(row, vc);
  if (spill.before > 0) data['data-spill-before'] = String(spill.before);
  if (spill.after > 0) data['data-spill-after'] = String(spill.after);
  const across = centerAcrossSpan(row, vc);
  if (across > 0) {
    data['data-across'] = String(across);
    return;
  }
  if (row[vc].align.h !== 'centerAcross' || vc === 0 || row[vc].text.trim() !== '') return;
  // Covered when an earlier centered cell reaches here.
  let k = vc - 1;
  while (k > 0 && row[k].text.trim() === '' && row[k].align.h === 'centerAcross') k -= 1;
  if (centerAcrossSpan(row, k) >= vc - k) data['data-across-covered'] = '';
}

/** Freeze panes and the markers beside hidden lines, which depend on the cell's place in the table. */
function placeData(v: View, r: number, c: number, vr: number, vc: number, data: Record<string, string>): void {
  if (r < v.frozenRows) data['data-frozen-row'] = r === v.edgeRow ? 'edge' : '';
  if (c < v.frozenCols) data['data-frozen-col'] = c === v.edgeCol ? 'edge' : '';
  // A double line on the edge next to hidden rows and columns.
  if (v.visRows[vr + 1] !== undefined && v.visRows[vr + 1] > r + 1) data['data-hidden-below'] = '';
  if (vr === 0 && r > 0) data['data-hidden-above'] = '';
  if (v.visCols[vc + 1] !== undefined && v.visCols[vc + 1] > c + 1) data['data-hidden-right'] = '';
  if (vc === 0 && c > 0) data['data-hidden-left'] = '';
}

function drawCell(input: DrawInput, v: View, vr: number, vc: number, d: Drawn): void {
  const { scheme } = input;
  const style = v.styles[vr][vc];
  const fill = drawFill(style.fill, scheme);
  if (fill.color) d.vars['--cell-fill'] = fill.color;
  if (fill.image) d.vars['--cell-fill-image'] = fill.image;
  if (fill.color || fill.image) d.data['data-filled'] = '';
  fontVars(style, d.vars, scheme, fill.under);
  alignVars(style, v.texts[vr][vc].kind, d.vars, d.data);
  padVars(style, d.vars);
  const extra = v.drawn[vr]?.[vc];
  if (extra) {
    Object.assign(d.vars, extra.vars);
    Object.assign(d.data, extra.data);
  }
  const near = {
    above: vr > 0 ? v.styles[vr - 1][vc].border : undefined,
    below: vr < v.visRows.length - 1 ? v.styles[vr + 1][vc].border : undefined,
    left: vc > 0 ? v.styles[vr][vc - 1].border : undefined,
    right: vc < v.visCols.length - 1 ? v.styles[vr][vc + 1].border : undefined,
  };
  borderVars(resolvedSides(style.border, near), v.grid, scheme, d.vars, d.data);
  diagonals(style, scheme, d.vars);
  spanData(v.texts[vr], vc, d.data);
  placeData(v, v.visRows[vr], v.visCols[vc], vr, vc, d.data);
}

/** What a drawing remembers, so the next one can reuse what did not change. */
const MEMOS = new WeakMap<DrawnTable, { input: DrawInput; view: View }>();

/** One shown row's cells, drawn; the cells of hidden columns draw nothing. */
function drawRowCells(input: DrawInput, v: View, vr: number): Drawn[] {
  const cells = input.table.columns.map(() => empty());
  v.visCols.forEach((c, vc) => drawCell(input, v, vr, vc, cells[c]));
  cells.forEach((d, c) => v.colHidden[c] && (d.data['data-col-hidden'] = ''));
  return cells;
}

/**
 * Everything the stylesheet needs to draw a table: one `Drawn` per table, row, and cell. Give the result of the
 * last drawing as `previous` and, when only text changed, just the rows with changed text are drawn again (their
 * numbers are in `changed`); the other rows share their `Drawn` objects with `previous`.
 */
export function drawTable(input: DrawInput, previous?: DrawnTable): DrawnTable {
  const { sheet, table, scheme } = input;
  const memo = previous ? MEMOS.get(previous) : undefined;
  if (previous && memo && sameShape(memo.input, input)) {
    const changed = new Set<number>();
    const v = dependsOnValues(input)
      ? revisedView(memo.view, input, changed)
      : updatedView(memo.view, memo.input, input, changed);
    const cells = previous.cells.map((row, r) => (changed.has(r) ? drawRowCells(input, v, v.visRows.indexOf(r)) : row));
    const out: DrawnTable = { table: previous.table, rows: previous.rows, cells, changed };
    MEMOS.set(out, { input, view: v });
    return out;
  }
  const v = viewOf(input);
  const out: DrawnTable = {
    table: empty(),
    rows: table.rows.map(() => empty()),
    cells: table.rows.map(() => table.columns.map(() => empty())),
  };
  out.table.vars['--sheet-ink'] = themeColor('text', scheme);
  out.table.data['data-sheet'] = '';
  if (!v.grid) out.table.data['data-no-grid'] = '';
  // The table's scroller reads these (tables.module.css): frozen rows need a box that scrolls up and down.
  if (v.edgeRow >= 0) out.table.data['data-frozen-rows'] = '';
  if (v.edgeCol >= 0) out.table.data['data-frozen-cols'] = '';

  table.rows.forEach((row, r) => {
    const d = out.rows[r];
    const settingsOfRow = ownObject(ownObject(sheet, 'rows'), row.id);
    if (v.rowHidden[r]) d.data['data-row-hidden'] = '';
    // The header row repeats on each printed page (render.css).
    else if (r === 0 && table.header === true) d.data['data-header-row'] = '';
    const height = own(settingsOfRow, 'height');
    if (typeof height === 'number' && height > 0) {
      d.vars['--row-h'] = `${height}${UNITS.height}`;
      d.data[own(settingsOfRow, 'exact') === true ? 'data-row-exact' : 'data-row-min'] = '';
    }
  });
  v.visRows.forEach((r, vr) => (out.cells[r] = drawRowCells(input, v, vr)));
  MEMOS.set(out, { input, view: v });
  return out;
}
