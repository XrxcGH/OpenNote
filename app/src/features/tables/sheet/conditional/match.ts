// Which cells a rule that gives a style matches (R-SHT-15): cell value, text, dates, blanks, errors, top and
// bottom, average, duplicates, and custom formulas. Each is worked from its documented behavior.

import { daysToIso, todayDays, weekdayOf } from '../../engine/dates';
import { own, type JsonObject } from '../model/json';
import type { Rule } from '../model/rules';
import type { Sheet, TableLike } from '../model/types';
import { evaluateFormula, isTrue, compareValues, type FormulaContext } from './formula';
import { statsOf } from './stats';
import { numberOf, readText, textOf, valueOfCell, type CellValue } from './value';

let today: () => number = () => todayDays();

/** Sets what "today" means, as a spreadsheet serial day: tests fix it, and a page can follow the clock. */
export function setToday(next: (() => number) | null): void {
  today = next ?? (() => todayDays());
}

export function todaySerial(): number {
  return today();
}

export interface RuleContext {
  sheet: Sheet;
  table: TableLike;
  rule: Rule;
  row: number;
  col: number;
}

/** The context a formula in a rule is read in: the cell asked about, and the first range's top-left cell. */
export function formulaContext(c: RuleContext): FormulaContext {
  const box = c.rule.boxes[0];
  return {
    sheet: c.sheet,
    table: c.table,
    at: { row: c.row, col: c.col },
    anchor: { row: box?.top ?? 0, col: box?.left ?? 0 },
    today: today(),
  };
}

/** The value of an operand: a formula, a quoted text, or typed text read as a number, boolean, or text. */
export function operandOf(text: unknown, c: RuleContext): CellValue {
  if (typeof text !== 'string') return { kind: 'blank' };
  const t = text.trim();
  if (t.startsWith('=')) return evaluateFormula(t, formulaContext(c));
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"'))
    return { kind: 'text', s: t.slice(1, -1).replace(/""/g, '"') };
  return readText(t);
}

function cellMatches(rule: JsonObject, v: CellValue, c: RuleContext): boolean {
  if (v.kind === 'error') return false;
  const op = own(rule, 'op') ?? 'between';
  const a = operandOf(own(rule, 'a'), c);
  if (op === 'between' || op === 'notBetween') {
    const b = operandOf(own(rule, 'b'), c);
    const inside = compareValues(v, a) >= 0 && compareValues(v, b) <= 0;
    return op === 'between' ? inside : !inside;
  }
  const d = compareValues(v, a);
  switch (op) {
    case 'equal':
      return d === 0;
    case 'notEqual':
      return d !== 0;
    case 'greater':
      return d > 0;
    case 'less':
      return d < 0;
    case 'greaterOrEqual':
      return d >= 0;
    case 'lessOrEqual':
      return d <= 0;
    default:
      return false;
  }
}

function textMatches(rule: JsonObject, v: CellValue): boolean {
  const needle = String(own(rule, 'text') ?? '').toLowerCase();
  const hay = textOf(v).toLowerCase();
  switch (own(rule, 'op')) {
    case 'contains':
      return hay.includes(needle);
    case 'notContains':
      return !hay.includes(needle);
    case 'begins':
      return hay.startsWith(needle);
    case 'ends':
      return hay.endsWith(needle);
    default:
      return false;
  }
}

/** The month of a serial day as year * 12 + month index, so "last month" and "next month" are plus and minus one. */
function monthIndex(serial: number): number {
  const [y, m] = daysToIso(Math.floor(serial)).split('-').map(Number);
  return y * 12 + (m - 1);
}

/** True when a serial day falls in a period, counting weeks from Sunday as Excel's default does. */
export function inPeriod(period: unknown, serial: number, now: number): boolean {
  const day = Math.floor(serial);
  const start = now - weekdayOf(now);
  switch (period) {
    case 'yesterday':
      return day === now - 1;
    case 'today':
      return day === now;
    case 'tomorrow':
      return day === now + 1;
    case 'last7Days':
      return day >= now - 6 && day <= now;
    case 'lastWeek':
      return day >= start - 7 && day < start;
    case 'thisWeek':
      return day >= start && day < start + 7;
    case 'nextWeek':
      return day >= start + 7 && day < start + 14;
    case 'lastMonth':
      return monthIndex(day) === monthIndex(now) - 1;
    case 'thisMonth':
      return monthIndex(day) === monthIndex(now);
    case 'nextMonth':
      return monthIndex(day) === monthIndex(now) + 1;
    default:
      return false;
  }
}

function rankMatches(rule: JsonObject, n: number, c: RuleContext): boolean {
  const stats = statsOf(c.sheet, c.table, c.rule);
  const count = stats.numbers.length;
  if (count === 0) return false;
  const rank = typeof rule.rank === 'number' ? rule.rank : 10;
  // Top 10 percent of 20 values is 2 values; there is always at least one.
  const take = rule.percent === true ? Math.max(1, Math.floor((count * rank) / 100)) : Math.min(rank, count);
  return rule.bottom === true ? n <= stats.numbers[take - 1] : n >= stats.numbers[count - take];
}

function averageMatches(rule: JsonObject, n: number, c: RuleContext): boolean {
  const stats = statsOf(c.sheet, c.table, c.rule);
  const k = typeof rule.stdDev === 'number' ? rule.stdDev : 0;
  const equal = rule.equal === true;
  if (rule.below === true) {
    const edge = stats.average - k * stats.deviation;
    return equal ? n <= edge : n < edge;
  }
  const edge = stats.average + k * stats.deviation;
  return equal ? n >= edge : n > edge;
}

/** True when a style rule matches the cell. The scale, bar, and icon types are not here: they draw (visual.ts). */
export function ruleMatches(c: RuleContext): boolean {
  const rule = c.rule.rule;
  const v = valueOfCell(c.sheet, c.table, c.row, c.col);
  const n = numberOf(v);
  switch (own(rule, 'type')) {
    case 'cell':
      return cellMatches(rule, v, c);
    case 'text':
      return v.kind !== 'blank' && textMatches(rule, v);
    case 'date':
      return n !== undefined && inPeriod(own(rule, 'period'), n, today());
    case 'blank':
      return v.kind === 'blank';
    case 'noBlank':
      return v.kind !== 'blank';
    case 'error':
      return v.kind === 'error';
    case 'noError':
      return v.kind !== 'error';
    case 'top':
      return n !== undefined && rankMatches(rule, n, c);
    case 'average':
      return n !== undefined && averageMatches(rule, n, c);
    case 'duplicate':
    case 'unique': {
      if (v.kind === 'blank') return false;
      const count = statsOf(c.sheet, c.table, c.rule).counts.get(textOf(v).toLowerCase()) ?? 0;
      return own(rule, 'type') === 'duplicate' ? count > 1 : count === 1;
    }
    case 'formula':
      return isTrue(evaluateFormula(String(own(rule, 'a') ?? ''), formulaContext(c)));
    default:
      return false;
  }
}
