// Where a cell's look comes from (format spec R-SHT-8, R-SHT-9, DESIGN 3.3). Layers, lowest first: the defaults,
// the look's element for the cell's place, the table's style, the column's, the row's, the cell's, and the
// conditional formats that match. The run marks in the cell's Markdown draw on top of the result.

import { gridOf } from './grid';
import { own, ownObject } from './json';
import { getConditionalLayer, rulesAt, type ConditionalLayer } from './rules';
import { LOOK_ELEMENTS } from './enums';
import { styleById, validStyle } from './styles';
import type { CellStyle, Sheet, TableLike } from './types';

/** The defaults of R-SHT-8: the theme body font, no fill, general and top alignment, wrapping, and padding. */
export const DEFAULT_STYLE: CellStyle = {
  font: { family: '+body' },
  align: { h: 'general', v: 'top', wrap: 'wrap' },
  pad: { t: 2, r: 4, b: 2, l: 4 },
};

export type LookElement = (typeof LOOK_ELEMENTS)[number];

/** The keys whose objects merge key by key; `fill` and `fmt` replace whole, and so does each border side. */
const MERGED = ['font', 'align', 'pad', 'protect', 'border'] as const;

/** Lays `upper` over `lower` (R-SHT-9). Neither is changed. */
export function layer(lower: CellStyle, upper: CellStyle): CellStyle {
  const out: Record<string, unknown> = { ...lower };
  for (const [key, value] of Object.entries(upper)) {
    if (value === undefined) continue;
    const below = out[key];
    const merges = (MERGED as readonly string[]).includes(key) && typeof below === 'object' && below !== null;
    // A data property even for `__proto__`, which a hook's style may hold, so the result's prototype never changes.
    Object.defineProperty(out, key, {
      value: merges ? { ...below, ...(value as object) } : value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out as CellStyle;
}

/**
 * The look elements that apply to a cell, lowest first: the whole table, banded columns, banded rows, the first
 * and last column, then the header and total rows. Banded rows count from the first row under the header.
 */
export function lookElements(sheet: Sheet, table: TableLike, row: number, col: number): LookElement[] {
  const settings = ownObject(sheet, 'table');
  const band = ownObject(settings, 'band');
  const emphasis = ownObject(settings, 'emphasis');
  const header = table.header === true;
  const lastRow = table.rows.length - 1;
  const lastCol = table.columns.length - 1;
  const isHeader = header && row === 0;
  const isTotal = own(emphasis, 'totalRow') === true && row === lastRow && !isHeader;
  const elements: LookElement[] = ['whole'];
  if (own(band, 'cols') === true) elements.push(col % 2 === 0 ? 'colBand1' : 'colBand2');
  if (own(band, 'rows') === true && !isHeader && !isTotal) {
    elements.push((row - (header ? 1 : 0)) % 2 === 0 ? 'band1' : 'band2');
  }
  if (own(emphasis, 'firstCol') === true && col === 0) elements.push('firstCol');
  if (own(emphasis, 'lastCol') === true && col === lastCol) elements.push('lastCol');
  if (isHeader) elements.push('header');
  if (isTotal) elements.push('total');
  return elements;
}

/** The style a named look (a built-in table style the theme draws) gives an element. The render lane sets it. */
export type NamedLook = (look: string, element: LookElement) => CellStyle | undefined;

export interface ResolveHooks {
  /** Styles of the built-in looks, by name. Without it, a look name draws as no look. */
  namedLook?: NamedLook;
  /** The conditional formats' layer. Defaults to the one the conditional lane registered. */
  conditional?: ConditionalLayer | null;
  /** The format of a column's `data.smart` type, used where no layer sets `fmt` (R-SHT-9). */
  columnFormat?: (col: string) => string | undefined;
}

export type LayerName = 'defaults' | 'look' | 'table' | 'column' | 'row' | 'cell' | 'conditional';

export interface Resolved {
  style: CellStyle;
  /** The layers that set something, lowest first, for the Format Cells dialog and tests. */
  layers: { name: LayerName; style: CellStyle }[];
}

/** The effective style of the cell at a row and column ID, with every layer that took part. */
export function resolve(sheet: Sheet, table: TableLike, row: string, col: string, hooks: ResolveHooks = {}): Resolved {
  const grid = gridOf(table);
  const r = grid.rowAt.get(row);
  const c = grid.colAt.get(col);
  const settings = ownObject(sheet, 'table');
  const pad = validStyle({ pad: own(settings, 'pad') ?? {} }).pad;
  const defaults = pad ? layer(DEFAULT_STYLE, { pad }) : DEFAULT_STYLE;
  const layers: Resolved['layers'] = [{ name: 'defaults', style: defaults }];
  const add = (name: LayerName, style: CellStyle | undefined) => {
    if (style && Object.keys(style).length > 0) layers.push({ name, style });
  };
  if (r !== undefined && c !== undefined) {
    const look = own(settings, 'look');
    for (const element of lookElements(sheet, table, r, c)) {
      if (typeof look === 'string') add('look', hooks.namedLook?.(look, element));
      else add('look', styleById(sheet, own(look, element)));
    }
  }
  add('table', styleById(sheet, own(settings, 'style')));
  add('column', styleById(sheet, own(ownObject(ownObject(sheet, 'cols'), col), 'style')));
  add('row', styleById(sheet, own(ownObject(ownObject(sheet, 'rows'), row), 'style')));
  add('cell', styleById(sheet, own(ownObject(ownObject(sheet, 'cells'), row), col)));
  const conditional = hooks.conditional === undefined ? getConditionalLayer() : hooks.conditional;
  if (conditional && r !== undefined && c !== undefined) {
    const rules = rulesAt(sheet, table, 'conditional', r, c);
    if (rules.length > 0)
      for (const style of conditional(rules, { row: r, col: c }, sheet, table)) add('conditional', style);
  }
  let style = layers.reduce<CellStyle>((acc, l) => layer(acc, l.style), {});
  if (style.fmt === undefined) {
    const fmt = hooks.columnFormat?.(col);
    if (fmt) style = { ...style, fmt };
  }
  return { style, layers };
}
