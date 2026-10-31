// A timeline's rows, scale, and drawing. Rows come from text or a table (label, start, end, track, kind, notes).
// The axis is linear, logarithmic in years before present for deep time, or linear with one break. Labels are packed
// into sub-rows greedily: each item takes the first row where it clears the last item by a gap. Errors are codes
// under kitHumanities.timeline.errors.
import '../text';
import { beforePresent, parseDate } from './dates';
import type { TimeDate } from './dates';

export type Kind = 'event' | 'period' | 'era';

export interface Row {
  label: string;
  start: TimeDate;
  end: TimeDate | null;
  track: string;
  kind: Kind;
  notes: string;
  /** The start and end as typed, for the steps. */
  startText: string;
  endText: string;
  /** The line it came from, counting the header, for messages. */
  line: number;
}

export const MAX_ROWS = 2000;
const HEADER = /^(label|title|event|name)\b/i;

function cells(line: string): string[] {
  return line.split(line.includes('\t') ? '\t' : ',').map((cell) => cell.trim());
}

export class RowError extends Error {
  constructor(
    readonly code: string,
    readonly line: number,
  ) {
    super(code);
  }
}

/** Reads rows: label, start, end, track, kind, notes. A first line that starts with Label is a header. */
export function parseRows(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const rows: Row[] = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || (rows.length === 0 && index === 0 && HEADER.test(line))) return;
    const [label = '', start = '', end = '', track = '', kind = '', notes = ''] = cells(line);
    const number = index + 1;
    if (label === '') throw new RowError('label', number);
    let startDate: TimeDate;
    let endDate: TimeDate | null;
    try {
      startDate = parseDate(start);
      endDate = end === '' ? null : parseDate(end);
    } catch (error) {
      throw new RowError(error instanceof Error ? error.message : 'date', number);
    }
    if (endDate && endDate.mid < startDate.mid) throw new RowError('order', number);
    const lowered = kind.toLowerCase();
    const chosen: Kind = lowered === 'era' ? 'era' : endDate ? 'period' : 'event';
    if (chosen === 'era' && !endDate) throw new RowError('eraEnd', number);
    rows.push({
      label,
      start: startDate,
      end: endDate,
      track,
      kind: chosen,
      notes,
      startText: start,
      endText: end,
      line: number,
    });
  });
  if (rows.length === 0) throw new Error('noRows');
  if (rows.length > MAX_ROWS) throw new Error('tooMany');
  return rows;
}

/** The row each item goes in: the first whose last item ends at least `gap` before this one starts. */
export function packLanes(items: readonly { start: number; end: number }[], gap = 0): number[] {
  const order = items.map((_, index) => index).sort((a, b) => items[a]!.start - items[b]!.start || a - b);
  const ends: number[] = [];
  const lanes = new Array<number>(items.length);
  for (const index of order) {
    const item = items[index]!;
    let lane = ends.findIndex((end) => end + gap <= item.start);
    if (lane < 0) lane = ends.push(item.end) - 1;
    else ends[lane] = item.end;
    lanes[index] = lane;
  }
  return lanes;
}

export type Scale =
  | { kind: 'linear'; from: number; to: number }
  | { kind: 'log'; oldest: number; youngest: number }
  | { kind: 'broken'; from: number; to: number; gapFrom: number; gapTo: number };

/** The share of the axis width for a gap in a broken axis. */
export const BREAK_SHARE = 0.04;

/** Where a year falls on the axis, from 0 at the left to 1 at the right. */
export function position(scale: Scale, year: number): number {
  if (scale.kind === 'linear') return (year - scale.from) / (scale.to - scale.from);
  if (scale.kind === 'log') {
    // In years before present: older is further left, and each power of ten takes the same width.
    const bp = Math.max(beforePresent(year), scale.youngest);
    const top = Math.log10(scale.oldest);
    const bottom = Math.log10(scale.youngest);
    return (top - Math.log10(bp)) / (top - bottom);
  }
  const first = scale.gapFrom - scale.from;
  const second = scale.to - scale.gapTo;
  const share = (1 - BREAK_SHARE) / (first + second);
  if (year <= scale.gapFrom) return (year - scale.from) * share;
  if (year >= scale.gapTo) return first * share + BREAK_SHARE + (year - scale.gapTo) * share;
  return first * share + (BREAK_SHARE * (year - scale.gapFrom)) / (scale.gapTo - scale.gapFrom);
}

export function checkScale(scale: Scale): void {
  if (scale.kind === 'log') {
    if (!(scale.youngest > 0) || !(scale.oldest > scale.youngest)) throw new Error('logRange');
    return;
  }
  if (!(scale.to > scale.from)) throw new Error('range');
  if (scale.kind === 'broken' && !(scale.from < scale.gapFrom && scale.gapFrom < scale.gapTo && scale.gapTo < scale.to))
    throw new Error('gap');
}

/** Round steps for a linear axis: 1, 2, or 5 times a power of ten, with at most about eight ticks. */
export function linearTicks(from: number, to: number, most = 8): number[] {
  const raw = (to - from) / most;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = Math.ceil(from / step) * step; value <= to + step * 1e-9; value += step)
    ticks.push(Math.round(value / step) * step);
  return ticks;
}

/** Powers of ten of years before present inside the axis, oldest first. */
export function logTicks(oldest: number, youngest: number): number[] {
  const ticks: number[] = [];
  for (let power = Math.floor(Math.log10(oldest)); power >= Math.ceil(Math.log10(youngest)); power--)
    ticks.push(10 ** power);
  return ticks;
}

/** The scale that fits every date, with a little room at each end. */
export function fitScale(rows: readonly Row[], kind: Scale['kind']): Scale {
  const years = rows.flatMap((row) => [row.start.low, row.start.high, ...(row.end ? [row.end.low, row.end.high] : [])]);
  const low = Math.min(...years);
  const high = Math.max(...years);
  if (kind === 'log') {
    const oldest = Math.max(beforePresent(low), 10);
    const youngest = Math.max(1, Math.min(beforePresent(high), oldest / 10));
    return {
      kind: 'log',
      oldest: 10 ** Math.ceil(Math.log10(oldest)),
      youngest: 10 ** Math.floor(Math.log10(youngest)),
    };
  }
  const pad = Math.max((high - low) * 0.04, 1);
  const from = Math.floor(low - pad);
  const to = Math.ceil(high + pad);
  if (kind === 'linear') return { kind, from, to };
  // The widest empty stretch between dates becomes the break.
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  let gapFrom = from + (to - from) / 3;
  let gapTo = from + (2 * (to - from)) / 3;
  let widest = 0;
  for (let i = 1; i < sorted.length; i++) {
    const width = sorted[i]! - sorted[i - 1]!;
    if (width > widest) {
      widest = width;
      gapFrom = sorted[i - 1]! + pad / 2;
      gapTo = sorted[i]! - pad / 2;
    }
  }
  if (!(gapTo > gapFrom)) [gapFrom, gapTo] = [from + (to - from) / 3, from + (2 * (to - from)) / 3];
  return { kind, from, to, gapFrom, gapTo };
}
