// What a smart table keeps beside its cells (Phase 7). It lives in the table block's `data.smart`, a key the file
// format passes through untouched, so older readers still see an ordinary table. Cells keep their text as typed,
// so a formula is the cell's text ("=B2*C2") and every other reader sees it. Columns, filters, and charts name
// columns by ID, so adding or moving a column never changes what they mean.
import type { Aggregate, ChartKind, ColumnType, FilterOp, TotalKind } from '../engine';

export interface ColumnSmart {
  /** A type picked by the person. Without one, the table reads the cells and decides. */
  type?: ColumnType;
  /** Digits after the decimal mark. */
  decimals?: number;
  /** An ISO 4217 code for a currency column. */
  currency?: string;
  total?: TotalKind;
}

export interface FilterSmart {
  /** A column ID. */
  column: string;
  op: FilterOp;
  value?: string;
  to?: string;
}

export interface ChartSmart {
  id: string;
  kind: ChartKind;
  /** The column IDs: categories along the axis, and the values drawn. */
  x: string;
  series: string[];
  aggregate?: Aggregate;
  stacked?: boolean;
  patterns?: boolean;
  title?: string;
  /** The words that describe the chart, when the person wrote their own instead of the automatic summary. */
  summary?: string;
  /** Data rows (counted from 0 without the header) the chart reads, or all of them. */
  rows?: { from: number; to: number };
}

export type ViewKind = 'board' | 'calendar' | 'gallery' | 'timeline';
export const VIEW_KINDS: readonly ViewKind[] = ['board', 'calendar', 'gallery', 'timeline'];

/** Another way to look at the table: which view, and the columns it reads, by ID. Without one, the table shows. */
export interface ViewSmart {
  kind: ViewKind;
  /** The column that sorts cards into lanes on a board. */
  group?: string;
  /** The column of dates for a calendar, or the start of a timeline. */
  date?: string;
  /** The end date of a timeline. */
  end?: string;
  /** The column whose text names each card. */
  title?: string;
}

/** The column a table was last sorted by, by ID. */
export interface SortSmart {
  column: string;
  desc?: boolean;
}

/** A named set of filters and a sort the person saved to come back to. Each table keeps up to MAX_SAVED_VIEWS. */
export interface SavedViewSmart {
  id: string;
  name: string;
  filters: FilterSmart[];
  sort?: SortSmart;
}

export const MAX_SAVED_VIEWS = 24;
export const MAX_VIEW_NAME = 60;

export interface SmartData {
  columns: Record<string, ColumnSmart>;
  filters: FilterSmart[];
  charts: ChartSmart[];
  view?: ViewSmart;
  /** The sort the table was last given, so a saved view can keep it. */
  sort?: SortSmart;
  /** The saved views, each with its own filters and sort. */
  saved?: SavedViewSmart[];
  /** The saved view that was applied last. */
  savedActive?: string;
}

export const EMPTY_SMART: SmartData = Object.freeze({ columns: {}, filters: [], charts: [] }) as SmartData;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const TYPES: readonly ColumnType[] = ['text', 'number', 'currency', 'percent', 'date', 'checkbox'];
const TOTALS: readonly TotalKind[] = ['sum', 'average', 'count', 'min', 'max', 'checked'];
const KINDS: readonly ChartKind[] = ['bar', 'line', 'area', 'pie', 'scatter'];
const AGGREGATES: readonly Aggregate[] = ['none', 'sum', 'average', 'count', 'min', 'max'];

function readColumn(raw: unknown): ColumnSmart {
  const fields = isRecord(raw) ? raw : {};
  const out: ColumnSmart = {};
  if (TYPES.includes(fields.type as ColumnType)) out.type = fields.type as ColumnType;
  if (typeof fields.decimals === 'number' && Number.isInteger(fields.decimals)) {
    out.decimals = Math.min(10, Math.max(0, fields.decimals));
  }
  if (typeof fields.currency === 'string' && /^[A-Z]{3}$/.test(fields.currency)) out.currency = fields.currency;
  if (TOTALS.includes(fields.total as TotalKind)) out.total = fields.total as TotalKind;
  return out;
}

function readChart(raw: unknown): ChartSmart | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const x = text(raw.x);
  if (!id || !x || !KINDS.includes(raw.kind as ChartKind) || !Array.isArray(raw.series)) return null;
  const series = raw.series.filter((value): value is string => typeof value === 'string').slice(0, 7);
  const chart: ChartSmart = { id, kind: raw.kind as ChartKind, x, series };
  if (AGGREGATES.includes(raw.aggregate as Aggregate)) chart.aggregate = raw.aggregate as Aggregate;
  if (typeof raw.stacked === 'boolean') chart.stacked = raw.stacked;
  if (typeof raw.patterns === 'boolean') chart.patterns = raw.patterns;
  if (typeof raw.title === 'string') chart.title = raw.title.slice(0, 200);
  if (typeof raw.summary === 'string' && raw.summary.trim() !== '') chart.summary = raw.summary.slice(0, 1000);
  const rows = raw.rows;
  if (isRecord(rows) && Number.isInteger(rows.from) && Number.isInteger(rows.to)) {
    chart.rows = { from: rows.from as number, to: rows.to as number };
  }
  return chart;
}

function readFilter(value: unknown): FilterSmart[] {
  if (!isRecord(value) || !text(value.column) || !text(value.op)) return [];
  const filter: FilterSmart = { column: value.column as string, op: value.op as FilterOp };
  if (text(value.value) !== undefined) filter.value = value.value as string;
  if (text(value.to) !== undefined) filter.to = value.to as string;
  return [filter];
}

function readSort(raw: unknown): SortSmart | null {
  if (!isRecord(raw) || !text(raw.column)) return null;
  return { column: raw.column as string, ...(raw.desc === true ? { desc: true } : {}) };
}

function readSaved(raw: unknown): SavedViewSmart[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedViewSmart[] = [];
  for (const value of raw) {
    if (!isRecord(value) || !text(value.id) || seen.has(value.id as string)) continue;
    const name = (text(value.name) ?? '').trim().slice(0, MAX_VIEW_NAME);
    if (name === '') continue;
    seen.add(value.id as string);
    const sort = readSort(value.sort);
    out.push({
      id: value.id as string,
      name,
      filters: (Array.isArray(value.filters) ? value.filters : []).flatMap(readFilter),
      ...(sort ? { sort } : {}),
    });
    if (out.length >= MAX_SAVED_VIEWS) break;
  }
  return out;
}

function readView(raw: unknown): ViewSmart | null {
  if (!isRecord(raw) || !VIEW_KINDS.includes(raw.kind as ViewKind)) return null;
  const view: ViewSmart = { kind: raw.kind as ViewKind };
  for (const key of ['group', 'date', 'end', 'title'] as const) {
    if (typeof raw[key] === 'string' && raw[key] !== '') view[key] = raw[key];
  }
  return view;
}

/** Reads `data.smart`, ignoring whatever it cannot understand and keeping the rest. */
export function readSmart(data: Record<string, unknown> | undefined): SmartData {
  const raw = data?.smart;
  if (!isRecord(raw)) return EMPTY_SMART;
  const columns: Record<string, ColumnSmart> = {};
  if (isRecord(raw.columns)) {
    for (const [id, value] of Object.entries(raw.columns)) {
      const column = readColumn(value);
      if (Object.keys(column).length > 0) columns[id] = column;
    }
  }
  const filters = (Array.isArray(raw.filters) ? raw.filters : []).flatMap(readFilter);
  const charts = (Array.isArray(raw.charts) ? raw.charts : []).flatMap((value) => readChart(value) ?? []);
  const view = readView(raw.view);
  const sort = readSort(raw.sort);
  const saved = readSaved(raw.saved);
  const active = saved.some((one) => one.id === raw.savedActive) ? (raw.savedActive as string) : undefined;
  return {
    columns,
    filters,
    charts,
    ...(view ? { view } : {}),
    ...(sort ? { sort } : {}),
    ...(saved.length > 0 ? { saved } : {}),
    ...(active ? { savedActive: active } : {}),
  };
}

/** The merge patch that stores `smart`: the whole object, or null when nothing is left. */
export function smartPatch(smart: SmartData): Record<string, unknown> {
  const empty =
    Object.keys(smart.columns).length === 0 &&
    smart.filters.length === 0 &&
    smart.charts.length === 0 &&
    smart.view === undefined &&
    smart.sort === undefined &&
    (smart.saved ?? []).length === 0;
  return { smart: empty ? null : smart };
}

/** `smart` with the columns that are no longer in the table dropped from it. */
export function pruneSmart(smart: SmartData, columnIds: readonly string[]): SmartData {
  const keep = new Set(columnIds);
  const saved = (smart.saved ?? []).map(({ sort, filters, ...rest }) => ({
    ...rest,
    filters: filters.filter((filter) => keep.has(filter.column)),
    ...(sort && keep.has(sort.column) ? { sort } : {}),
  }));
  return {
    columns: Object.fromEntries(Object.entries(smart.columns).filter(([id]) => keep.has(id))),
    filters: smart.filters.filter((filter) => keep.has(filter.column)),
    charts: smart.charts,
    ...(smart.view ? { view: smart.view } : {}),
    ...(smart.sort && keep.has(smart.sort.column) ? { sort: smart.sort } : {}),
    ...(saved.length > 0 ? { saved } : {}),
    ...(smart.savedActive ? { savedActive: smart.savedActive } : {}),
  };
}

export function withColumn(smart: SmartData, id: string, change: Partial<ColumnSmart> | null): SmartData {
  const next = { ...smart.columns };
  const merged: ColumnSmart = { ...next[id], ...change };
  for (const key of Object.keys(merged) as (keyof ColumnSmart)[]) if (merged[key] === undefined) delete merged[key];
  if (change === null || Object.keys(merged).length === 0) delete next[id];
  else next[id] = merged;
  return { ...smart, columns: next };
}

export const sameSmart = (a: SmartData, b: SmartData): boolean => JSON.stringify(a) === JSON.stringify(b);
