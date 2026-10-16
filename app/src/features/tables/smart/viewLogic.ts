// Other ways to look at a smart table (Further features, Phase 7): a board that groups rows by a column, a calendar
// and a timeline that place them by date, and a gallery of cards. This is the plain data behind them: which rows
// are cards, which lane or day each is in, and the new cell text a move writes. Moving a card edits a cell, so the
// table is always the one source of truth, and a move is one undo step.
import { formatValue, isError } from '../engine';
import { daysToIso, daysToYmd, ymdToDays } from '../engine/dates';
import type { Locale } from '../engine';
import type { SmartModel } from './model';

export { VIEW_KINDS } from './data';
export type { ViewKind } from './data';

/** What the text of one cell is, as the table shows it. */
export function cellText(model: SmartModel, row: number, column: number, locale: Locale): string {
  const cell = model.table.rows[row]?.cells[column];
  const col = model.table.columns[column];
  if (!cell || !col) return '';
  if (cell.value === null || isError(cell.value)) return cell.raw.trim();
  return col.type === 'text' ? cell.raw.trim() : formatValue(cell.value, col, locale);
}

/** A date column's value for a row as a whole day number, or null. */
export function dayAt(model: SmartModel, row: number, column: number): number | null {
  const value = model.table.rows[row]?.cells[column]?.value;
  return typeof value === 'number' && model.table.columns[column]?.type === 'date' ? Math.floor(value) : null;
}

export interface Defaults {
  title: number;
  group: number | null;
  date: number | null;
  end: number | null;
}

/** Columns to start from: the first text column for titles, a few-valued text column for lanes, date columns for days. */
export function defaultColumns(model: SmartModel): Defaults {
  const { columns, rows } = model.table;
  const title = Math.max(
    0,
    columns.findIndex((column) => column.type === 'text'),
  );
  const dates = columns.flatMap((column, index) => (column.type === 'date' ? [index] : []));
  const group = columns.findIndex((column, index) => {
    if (index === title || column.type !== 'text') return false;
    const values = new Set(rows.map((row) => row.cells[index]?.raw.trim()).filter(Boolean));
    return values.size > 0 && values.size <= 12 && values.size < rows.length;
  });
  return { title, group: group < 0 ? null : group, date: dates[0] ?? null, end: dates[1] ?? null };
}

export interface Lane {
  /** The cell text that puts a card in this lane. Empty for the lane of cards with nothing. */
  value: string;
  rows: number[];
}

/** The lanes of a board, in the order their values first appear, with a last lane for rows with no value. */
export function lanesOf(model: SmartModel, group: number, locale: Locale): Lane[] {
  const lanes = new Map<string, number[]>();
  for (const row of model.shown) {
    const value = cellText(model, row, group, locale);
    lanes.set(value, [...(lanes.get(value) ?? []), row]);
  }
  const named = [...lanes.entries()].filter(([value]) => value !== '').map(([value, rows]) => ({ value, rows }));
  return [...named, { value: '', rows: lanes.get('') ?? [] }];
}

/** The lane a card moves to when it goes one lane left or right, or null at the edge. */
export function neighborLane(lanes: readonly Lane[], from: string, step: -1 | 1): Lane | null {
  const at = lanes.findIndex((lane) => lane.value === from);
  return lanes[at + step] ?? null;
}

export interface Month {
  year: number;
  /** 1 to 12. */
  month: number;
}

/** The weeks of a month as day numbers, Sunday first, with days of the neighboring months filling the first and last week. */
export function monthWeeks(at: Month): number[][] {
  const first = ymdToDays(at.year, at.month, 1) ?? 0;
  const offset = ((first % 7) + 4) % 7; // 1970-01-01 was a Thursday, so day 0 has weekday 4.
  const start = first - offset;
  const next = at.month === 12 ? { year: at.year + 1, month: 1 } : { year: at.year, month: at.month + 1 };
  const length = (ymdToDays(next.year, next.month, 1) ?? first) - first;
  const weeks = Math.ceil((offset + length) / 7);
  return Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, day) => start + week * 7 + day));
}

export function monthOf(day: number): Month {
  const { y, m } = daysToYmd(day);
  return { year: y, month: m };
}

export const shiftMonth = (at: Month, by: number): Month => {
  const index = at.year * 12 + (at.month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/** The rows on each day of a calendar, by day number. */
export function rowsByDay(model: SmartModel, column: number): Map<number, number[]> {
  const days = new Map<number, number[]>();
  for (const row of model.shown) {
    const day = dayAt(model, row, column);
    if (day !== null) days.set(day, [...(days.get(day) ?? []), row]);
  }
  return days;
}

export interface Bar {
  row: number;
  start: number;
  end: number;
}

/** The bars of a timeline: each row with a start date, ending at its end date or on its start day. Soonest first. */
export function barsOf(
  model: SmartModel,
  start: number,
  end: number | null,
): { bars: Bar[]; first: number; last: number } {
  const bars: Bar[] = [];
  for (const row of model.shown) {
    const from = dayAt(model, row, start);
    if (from === null) continue;
    const to = end === null ? null : dayAt(model, row, end);
    bars.push({ row, start: from, end: Math.max(from, to ?? from) });
  }
  bars.sort((a, b) => a.start - b.start || a.end - b.end || a.row - b.row);
  return {
    bars,
    first: Math.min(...bars.map((bar) => bar.start), Infinity),
    last: Math.max(...bars.map((bar) => bar.end), -Infinity),
  };
}

/** The cell text for a day: the canonical date, which every region reads. */
export const dayText = (day: number): string => daysToIso(day);
