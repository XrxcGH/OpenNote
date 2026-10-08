// The changes a person makes to a smart table (Phase 7): sort, filter, number formats, totals, fill, and charts.
// Each one reads the table fresh from the editor, builds the next data or the next `smart`, and sends it as one
// undo step through the table block, so Ctrl+Z puts everything back.
import { newId } from '../../../editor/ids';
import { parseCell, serializeCell } from '../../../editor/markdown';
import { tableSchema } from '../../../editor/schema/schema';
import type { TableData } from '../../../editor/schema/specs';
import { t } from '../../../strings/t';
import type { TableExtraHost } from '../../page';
import { chartConfigFor, checkFormulaInput, formatValue, sortedIndices, toCanonical } from '../engine';
import type { ChartKind, ColumnType, FilterOp, Locale, TotalKind } from '../engine';
import type { ChartSmart, SmartData, SortSmart, ViewSmart } from './data';
import { withColumn } from './data';
import { filledText } from './fill';
import type { SmartModel } from './model';

export interface Range {
  row0: number;
  row1: number;
  col0: number;
  col1: number;
}

export interface SmartInstance {
  readonly host: TableExtraHost;
  readonly locale: Locale;
  smart(): SmartData;
  /** The table as the editor holds it right now. */
  model(): SmartModel;
  /** The cell with the caret, by row (the header row is row 0 when there is one) and column. */
  caret(): { row: number; column: number } | null;
  /** The selected cells, or the caret's cell. */
  range(): Range | null;
  /** Keeps `next`. With `change`, the table's rows change in the same undo step. */
  commit(next: SmartData, change?: (data: TableData) => TableData | null): Promise<void>;
}

export type FilterMode = 'equal' | 'notEmpty' | 'greater' | 'less' | 'clear';

/** The data row (counted without the header) and column of the caret, or null in the header row. */
function caretCell(inst: SmartInstance): { row: number; column: number } | null {
  const caret = inst.caret();
  if (!caret) return null;
  const row = caret.row - inst.model().offset;
  return row < 0 ? null : { row, column: caret.column };
}

/** A change that stores the table's rows in the order the sort gives, or null when they already are. */
export function sortRows(
  model: SmartModel,
  locale: Locale,
  sort: SortSmart,
): ((data: TableData) => TableData | null) | null {
  const column = model.columnIds.indexOf(sort.column);
  if (column < 0) return null;
  const order = sortedIndices(model.table, [{ column, desc: sort.desc === true }], locale);
  if (order.every((from, to) => from === to)) return null;
  return (data) => {
    const rows = [...data.rows.slice(0, model.offset), ...order.map((from) => data.rows[from + model.offset])];
    return rows.some((row) => !row) ? null : { ...data, rows };
  };
}

export async function sortColumn(inst: SmartInstance, column: number, desc: boolean): Promise<boolean> {
  const model = inst.model();
  const sort: SortSmart = { column: model.columnIds[column], ...(desc ? { desc: true } : {}) };
  const change = sortRows(model, inst.locale, sort);
  const smart = inst.smart();
  const remembered = smart.sort?.column === sort.column && (smart.sort.desc === true) === desc;
  if (!change && remembered) return false;
  await inst.commit({ ...smart, sort }, change ?? undefined);
  const key = desc ? 'smart.table.sortedDescending' : 'smart.table.sortedAscending';
  inst.host.announce(t(key, { column: model.names[column] }));
  return change !== null;
}

export async function filterBy(inst: SmartInstance, mode: FilterMode): Promise<boolean> {
  const smart = inst.smart();
  if (mode === 'clear') {
    if (smart.filters.length === 0) return false;
    await inst.commit({ ...smart, filters: [] });
    inst.host.announce(t('smart.table.filterCleared'));
    return true;
  }
  const model = inst.model();
  const at = caretCell(inst);
  if (!at) return false;
  const column = model.table.columns[at.column];
  const columnId = model.columnIds[at.column];
  const value = model.table.rows[at.row]?.cells[at.column]?.value ?? null;
  const op: FilterOp = mode === 'equal' ? 'eq' : mode === 'notEmpty' ? 'notEmpty' : mode === 'greater' ? 'gt' : 'lt';
  const filter = { column: columnId, op, ...(op === 'notEmpty' ? {} : { value: toCanonical(column.type, value) }) };
  const others = smart.filters.filter((existing) => existing.column !== columnId);
  await inst.commit({ ...smart, filters: [...others, filter] });
  inst.host.announce(t('smart.table.filtered', { shown: inst.model().shown.length, total: model.table.rows.length }));
  return true;
}

export type FormatChange = { type: ColumnType | null } | { moreDecimals: 1 | -1 };

export async function setFormat(inst: SmartInstance, column: number, change: FormatChange): Promise<boolean> {
  const model = inst.model();
  const id = model.columnIds[column];
  const smart = inst.smart();
  const own = smart.columns[id] ?? {};
  let next: SmartData;
  if ('type' in change) {
    next = change.type
      ? withColumn(smart, id, {
          type: change.type,
          currency: change.type === 'currency' ? (own.currency ?? inst.locale.currency) : undefined,
        })
      : withColumn(smart, id, { type: undefined, decimals: undefined, currency: undefined });
  } else {
    const shown = own.decimals ?? 2;
    next = withColumn(smart, id, { decimals: Math.min(10, Math.max(0, shown + change.moreDecimals)) });
  }
  await inst.commit(next);
  return true;
}

export async function setTotal(inst: SmartInstance, column: number, total: TotalKind | null): Promise<boolean> {
  const id = inst.model().columnIds[column];
  await inst.commit(withColumn(inst.smart(), id, { total: total ?? undefined }));
  inst.host.announce(t(total ? 'smart.table.totalOn' : 'smart.table.totalOff'));
  return true;
}

type Direction = 'down' | 'right';

function fillData(
  inst: SmartInstance,
  data: TableData,
  direction: Direction,
  from: { row: number; column: number },
  to: Range,
): TableData | null {
  let changed = false;
  const rows = data.rows.map((row, r) => {
    if (r < to.row0 || r > to.row1) return row;
    const cells = { ...row.cells };
    for (let c = to.col0; c <= Math.min(to.col1, data.columns.length - 1); c += 1) {
      const sourceRow = direction === 'down' ? from.row : r;
      const sourceColumn = direction === 'down' ? c : from.column;
      const source = data.rows[sourceRow]?.cells[data.columns[sourceColumn]?.id]?.markdown;
      if (source === undefined) continue;
      // A formula is read from the text, whatever marks it has, and keeps its first mark when it moves.
      const paragraph = parseCell(source);
      const text = paragraph.textContent;
      const next = text.startsWith('=')
        ? serializeCell(
            tableSchema.nodes.paragraph.create(
              null,
              tableSchema.text(filledText(text, r - sourceRow, c - sourceColumn), paragraph.firstChild?.marks ?? []),
            ),
            inst.host.cache,
          )
        : source;
      const id = data.columns[c].id;
      if (cells[id]?.markdown !== next) {
        cells[id] = { markdown: next };
        changed = true;
      }
    }
    return { ...row, cells };
  });
  return changed ? { ...data, rows } : null;
}

/** Copies the first row (down) or first column (right) of the selection over the rest. One cell takes the cell
 *  above it (down) or to its left (right), like a spreadsheet. */
export async function fill(inst: SmartInstance, direction: Direction): Promise<boolean> {
  const range = inst.range();
  const offset = inst.model().offset;
  if (!range) return false;
  const single = range.row0 === range.row1 && range.col0 === range.col1;
  const down = direction === 'down';
  const from = {
    row: down ? (single ? range.row0 - 1 : range.row0) : range.row0,
    column: down ? range.col0 : single ? range.col0 - 1 : range.col0,
  };
  if (from.row < offset || from.column < 0) return false;
  const to: Range = single ? range : down ? { ...range, row0: range.row0 + 1 } : { ...range, col0: range.col0 + 1 };
  const changed = await inst.host.apply((data) => fillData(inst, data, direction, from, to));
  if (changed) inst.host.announce(t(down ? 'smart.table.filledDown' : 'smart.table.filledRight'));
  return changed;
}

const VALUE_TYPES = new Set<ColumnType>(['number', 'currency', 'percent']);

/** The chart a person gets from a table, or from the cells they selected. Null when there is nothing to chart. */
export function newChart(inst: SmartInstance, kind: ChartKind): ChartSmart | null {
  const model = inst.model();
  const range = inst.range();
  const defaults = chartConfigFor(model.table, kind);
  let x = defaults?.x ?? -1;
  let series = defaults ? [...defaults.series] : [];
  const wide = range !== null && range.col1 > range.col0;
  const tall = range !== null && range.row1 > range.row0;
  if (range && wide) {
    const wanted = Array.from({ length: range.col1 - range.col0 }, (_, i) => range.col0 + 1 + i).filter((c) =>
      VALUE_TYPES.has(model.table.columns[c]?.type ?? 'text'),
    );
    if (wanted.length > 0) {
      x = range.col0;
      series = wanted.slice(0, kind === 'pie' ? 1 : 7);
    }
  }
  if (x < 0 || series.length === 0) return null;
  const chart: ChartSmart = {
    id: newId(),
    kind,
    x: model.columnIds[x],
    series: series.map((c) => model.columnIds[c]),
    ...(defaults?.aggregate && defaults.aggregate !== 'none' ? { aggregate: defaults.aggregate } : {}),
  };
  if (range && tall) {
    const from = Math.max(0, range.row0 - model.offset);
    const to = range.row1 - model.offset;
    if (to >= from) chart.rows = { from, to };
  }
  return chart;
}

export async function addChart(inst: SmartInstance, kind: ChartKind): Promise<boolean> {
  const chart = newChart(inst, kind);
  if (!chart) {
    inst.host.announce(t('smart.chart.nothing'));
    return false;
  }
  const smart = inst.smart();
  await inst.commit({ ...smart, charts: [...smart.charts, chart] });
  inst.host.announce(t('smart.chart.added'));
  return true;
}

export async function removeChart(inst: SmartInstance, id: string): Promise<void> {
  const smart = inst.smart();
  await inst.commit({ ...smart, charts: smart.charts.filter((chart) => chart.id !== id) });
  inst.host.announce(t('smart.chart.removed'));
}

export async function changeChart(inst: SmartInstance, id: string, change: Partial<ChartSmart>): Promise<void> {
  const smart = inst.smart();
  const charts = smart.charts.map((chart) => (chart.id === id ? { ...chart, ...change } : chart));
  await inst.commit({ ...smart, charts });
}

/** The problem with a formula typed for a whole column, in words, or null when it reads. */
export function calculatedProblem(text: string, locale: Locale): string | null {
  const typed = text.trim().replace(/^=/, '').trim();
  if (typed === '') return t('smart.calculated.empty');
  const checked = checkFormulaInput(typed, locale);
  return typeof checked === 'string' ? null : t('smart.calculated.problem', { message: checked.message });
}

/** Puts one formula in every data cell of a column, so each row calculates from its own values. */
export async function setCalculated(inst: SmartInstance, column: number, text: string): Promise<boolean> {
  if (calculatedProblem(text, inst.locale) !== null) return false;
  const formula = `=${text.trim().replace(/^=/, '').trim()}`;
  const model = inst.model();
  const markdown = serializeCell(tableSchema.nodes.paragraph.create(null, tableSchema.text(formula)), inst.host.cache);
  const done = await inst.host.apply((data) => {
    const id = data.columns[column]?.id;
    if (!id || data.rows.length <= model.offset) return null;
    const rows = data.rows.map((row, r) =>
      r < model.offset ? row : { ...row, cells: { ...row.cells, [id]: { markdown } } },
    );
    return { ...data, rows };
  });
  if (done) inst.host.announce(t('smart.calculated.done', { column: model.names[column] }));
  return done;
}

/** Turns a calculated column back into plain values: each formula cell keeps the number or text it showed. */
export async function clearCalculated(inst: SmartInstance, column: number): Promise<boolean> {
  const model = inst.model();
  const done = await inst.host.apply((data) => {
    const id = data.columns[column]?.id;
    if (!id) return null;
    let changed = false;
    const rows = data.rows.map((row, r) => {
      if (r < model.offset) return row;
      const source = row.cells[id]?.markdown ?? '';
      if (!parseCell(source).textContent.startsWith('=')) return row;
      const cell = model.table.rows[r - model.offset]?.cells[column];
      const shown = cell ? formatValue(cell.value, model.table.columns[column], inst.locale) : '';
      changed = true;
      const markdown =
        shown === ''
          ? ''
          : serializeCell(tableSchema.nodes.paragraph.create(null, tableSchema.text(shown)), inst.host.cache);
      return { ...row, cells: { ...row.cells, [id]: { markdown } } };
    });
    return changed ? { ...data, rows } : null;
  });
  if (done) inst.host.announce(t('smart.calculated.cleared', { column: model.names[column] }));
  return done;
}

/** Writes new text in one cell, by engine row and column, as one undo step. Used when a card moves. */
export async function setCellText(inst: SmartInstance, row: number, column: number, text: string): Promise<boolean> {
  const model = inst.model();
  return inst.host.apply((data) => {
    const id = data.columns[column]?.id;
    const target = data.rows[row + model.offset];
    if (!id || !target) return null;
    const markdown =
      text === ''
        ? ''
        : serializeCell(tableSchema.nodes.paragraph.create(null, tableSchema.text(text)), inst.host.cache);
    if (target.cells[id]?.markdown === markdown) return null;
    const rows = data.rows.map((one) =>
      one === target ? { ...one, cells: { ...one.cells, [id]: { markdown } } } : one,
    );
    return { ...data, rows };
  });
}

/** Chooses a view of the table, or with null goes back to the table alone. */
export async function chooseView(inst: SmartInstance, view: ViewSmart | null): Promise<void> {
  const { view: _old, ...rest } = inst.smart();
  await inst.commit(view ? { ...rest, view } : rest);
}
