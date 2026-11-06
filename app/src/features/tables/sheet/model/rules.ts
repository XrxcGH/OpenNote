// Ranges, data validation rules, and conditional formats (format spec R-SHT-14, R-SHT-15, R-SHT-22). Rules are
// kept as JSON so a rule of a type this version does not know stays in the file. The validation and conditional
// lanes evaluate them; the model finds which rules cover a cell, in the order they apply.

import { boxOf, contains, gridOf, isCorner, overlaps, type Box, type Grid } from './grid';
import { byCodePoint, isObject, own, ownObject, put, type Json, type JsonObject } from './json';
import { moveCorners, stillThere } from './merges';
import { CONDITIONAL_TYPES } from './schema';
import type { CellStyle, Sheet, SheetRange, TableLike } from './types';

export const RULE_LIMIT = 256;
export const RANGE_LIMIT = 64;

export type RuleKind = 'validation' | 'conditional';

export interface Rule {
  id: string;
  rule: JsonObject;
  boxes: Box[];
}

/** The box a range covers (R-SHT-22): a whole column, a whole row, or the box between corners. Null when missing. */
export function rangeBox(grid: Grid, range: Json): Box | null {
  if (!isObject(range)) return null;
  const last = { row: grid.rows.length - 1, col: grid.cols.length - 1 };
  if (typeof range.col === 'string') {
    const at = grid.colAt.get(range.col);
    return at === undefined || last.row < 0 ? null : { top: 0, bottom: last.row, left: at, right: at };
  }
  if (typeof range.row === 'string') {
    const at = grid.rowAt.get(range.row);
    return at === undefined || last.col < 0 ? null : { top: at, bottom: at, left: 0, right: last.col };
  }
  return boxOf(grid, range.from, range.to);
}

/** A range that covers the whole table: every column. */
export function wholeTable(table: TableLike): SheetRange[] {
  return table.columns.map((col) => ({ col: col.id }));
}

/** The rules of one kind with the boxes of their valid ranges. A rule with no valid range is left out. */
export function rulesOf(sheet: Sheet, table: TableLike, kind: RuleKind): Rule[] {
  const rules = ownObject(sheet, kind);
  if (!rules) return [];
  const grid = gridOf(table);
  const found: Rule[] = [];
  for (const id of Object.keys(rules)) {
    const rule = rules[id];
    if (!isObject(rule) || !Array.isArray(rule.ranges)) continue;
    const boxes = rule.ranges.map((r) => rangeBox(grid, r)).filter((b): b is Box => b !== null);
    if (boxes.length > 0) found.push({ id, rule, boxes });
  }
  return found;
}

/** The order of a conditional format: an integer from 1 to 256, or last when it is invalid. */
function orderOf(rule: JsonObject): number {
  const order = rule.order;
  return typeof order === 'number' && Number.isInteger(order) && order >= 1 && order <= RULE_LIMIT ? order : 257;
}

/** Conditional formats in the order they apply: increasing `order`, equal orders by rule ID (R-SHT-15). */
export function applyOrder(sheet: Sheet): string[] {
  const rules = ownObject(sheet, 'conditional') ?? {};
  return Object.keys(rules)
    .filter((id) => isObject(rules[id]))
    .sort((a, b) => orderOf(rules[a] as JsonObject) - orderOf(rules[b] as JsonObject) || byCodePoint(a, b));
}

/** The rules of a kind that cover a cell, by position. Conditional formats come in the order they apply. */
export function rulesAt(sheet: Sheet, table: TableLike, kind: RuleKind, row: number, col: number): Rule[] {
  const rules = rulesOf(sheet, table, kind).filter((r) => r.boxes.some((b) => contains(b, row, col)));
  if (kind === 'validation') return rules;
  const order = applyOrder(sheet);
  return rules
    .filter((r) => typeof r.rule.type === 'string' && CONDITIONAL_TYPES.includes(r.rule.type))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** The validation rule of a cell. Validation ranges should not overlap; when they do, the lowest ID wins. */
export function validationAt(sheet: Sheet, table: TableLike, row: number, col: number): Rule | undefined {
  return rulesAt(sheet, table, 'validation', row, col).sort((a, b) => byCodePoint(a.id, b.id))[0];
}

/**
 * What the conditional lane gives the model: the styles that the matching rules add to a cell, lowest first.
 * It stops at a rule with `stop` itself, and it draws scales, bars, and icons without a style.
 */
export type ConditionalLayer = (
  rules: readonly Rule[],
  cell: { row: number; col: number },
  sheet: Sheet,
  table: TableLike,
) => CellStyle[];

let conditionalLayer: ConditionalLayer | null = null;

/** Lets the conditional lane put its layer between the cell style and the run marks (R-SHT-9). */
export function setConditionalLayer(layer: ConditionalLayer | null): void {
  conditionalLayer = layer;
}

export function getConditionalLayer(): ConditionalLayer | null {
  return conditionalLayer;
}

/** A free rule ID: the prefix and the lowest number not in use. */
export function freeRuleId(sheet: Sheet, kind: RuleKind, prefix = kind === 'validation' ? 'v' : 'c'): string {
  const rules = ownObject(sheet, kind) ?? {};
  for (let n = 1; ; n++) if (!Object.hasOwn(rules, `${prefix}${n}`)) return `${prefix}${n}`;
}

/** Sets a rule. Changes `sheet` in place. Refuses a new rule past the limit of 256. */
export function setRule(sheet: Sheet, kind: RuleKind, id: string, rule: JsonObject): boolean {
  const rules = ownObject(sheet, kind) ?? {};
  if (!Object.hasOwn(rules, id) && Object.keys(rules).length >= RULE_LIMIT) return false;
  put(rules, id, rule);
  put(sheet, kind, rules);
  return true;
}

export function removeRule(sheet: Sheet, kind: RuleKind, id: string): void {
  const rules = ownObject(sheet, kind);
  if (!rules) return;
  delete rules[id];
  if (Object.keys(rules).length === 0) delete sheet[kind];
}

/** True when two validation rules would cover one cell. */
export function rangesOverlap(a: readonly Box[], b: readonly Box[]): boolean {
  return a.some((x) => b.some((y) => overlaps(x, y)));
}

/**
 * One range after a structure change: the same range, a range with moved corners, or null when it names a deleted
 * row or column. A range of a shape this version does not know stays as it is.
 */
function repairRange(range: Json, was: Grid, now: Grid): Json | null {
  if (!isObject(range)) return range;
  if (typeof range.col === 'string') return now.colAt.has(range.col) ? range : null;
  if (typeof range.row === 'string') return now.rowAt.has(range.row) ? range : null;
  const from = own(range, 'from');
  const to = own(range, 'to');
  if (!isCorner(from) || !isCorner(to) || stillThere(now, from, to)) return range;
  const box = moveCorners(was, now, from, to);
  if (!box) return null;
  const kept: JsonObject = { ...range };
  put(kept, 'from', [now.rows[box.top], now.cols[box.left]]);
  put(kept, 'to', [now.rows[box.bottom], now.cols[box.right]]);
  return kept;
}

/**
 * Brings the ranges of every rule up to date after a structure change (R-SHT-22). Corners move as in merges. A range
 * of a deleted row or column goes, and so does a rule left with no range. Changes `sheet` in place.
 */
export function repairRanges(sheet: Sheet, before: TableLike, after: TableLike): void {
  const was = gridOf(before);
  const now = gridOf(after);
  for (const kind of ['validation', 'conditional'] as const) {
    const rules = ownObject(sheet, kind);
    if (!rules) continue;
    for (const id of Object.keys(rules)) {
      const rule = rules[id];
      if (!isObject(rule) || !Array.isArray(rule.ranges)) continue;
      const ranges = rule.ranges.map((r) => repairRange(r, was, now)).filter((r): r is Json => r !== null);
      if (ranges.length === 0) delete rules[id];
      else put(rule, 'ranges', ranges);
    }
    if (Object.keys(rules).length === 0) delete sheet[kind];
  }
}
