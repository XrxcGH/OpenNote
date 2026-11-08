// The rule manager's work, apart from its screen: which rules to list for a scope, how a rule reads in a sentence,
// and the changes (priority, stop if true, delete) as a new sheet and a patch for the table's data.

import { t } from '../../../../strings/t';
import { columnLetter } from '../../engine/model';
import { gridOf, type Box } from '../../sheet/model/grid';
import { isObject, own, type JsonObject } from '../../sheet/model/json';
import { applyOrder, rangeBox, removeRule, rulesOf, setRule, type Rule } from '../../sheet/model/rules';
import { readSheet, sheetPatch } from '../../sheet/model/sheet';
import type { Sheet, TableLike } from '../../sheet/model/types';

export type Scope = 'selection' | 'table' | 'page';

/** One row of the manager. */
export interface ManagedRule {
  id: string;
  summary: string;
  ranges: string;
  stop: boolean;
  /** The table's label, for the page scope. */
  tableLabel?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const OPS = [
  'between',
  'notBetween',
  'equal',
  'notEqual',
  'greater',
  'less',
  'greaterOrEqual',
  'lessOrEqual',
  'contains',
  'notContains',
  'begins',
  'ends',
] as const;
type Op = (typeof OPS)[number];

const PERIODS = [
  'yesterday',
  'today',
  'tomorrow',
  'last7Days',
  'lastWeek',
  'thisWeek',
  'nextWeek',
  'lastMonth',
  'thisMonth',
  'nextMonth',
] as const;
type Period = (typeof PERIODS)[number];

function opText(op: string): string {
  const known: Op = (OPS as readonly string[]).includes(op) ? (op as Op) : 'equal';
  return t(`sheetConditional.op.${known}`);
}

function periodText(period: string): string {
  const known: Period = (PERIODS as readonly string[]).includes(period) ? (period as Period) : 'today';
  return t(`sheetConditional.period.${known}`);
}

/** A rule as a sentence, such as `Cell value is greater than 5`. */
export function describeRule(rule: JsonObject): string {
  const type = str(own(rule, 'type'));
  const op = str(own(rule, 'op')) || 'between';
  const count = typeof rule.rank === 'number' ? rule.rank : 10;
  switch (type) {
    case 'cell':
      return op === 'between' || op === 'notBetween'
        ? t('sheetConditional.type.cellBetween', { op: opText(op), a: str(rule.a), b: str(rule.b) })
        : t('sheetConditional.type.cell', { op: opText(op), a: str(rule.a) });
    case 'text':
      return t('sheetConditional.type.text', { op: opText(op), text: str(rule.text) });
    case 'date':
      return t('sheetConditional.type.date', { period: periodText(str(rule.period)) });
    case 'blank':
      return t('sheetConditional.type.blank');
    case 'noBlank':
      return t('sheetConditional.type.noBlank');
    case 'error':
      return t('sheetConditional.type.error');
    case 'noError':
      return t('sheetConditional.type.noError');
    case 'duplicate':
      return t('sheetConditional.type.duplicate');
    case 'unique':
      return t('sheetConditional.type.unique');
    case 'scale':
      return t('sheetConditional.type.scale');
    case 'bar':
      return t('sheetConditional.type.bar');
    case 'top':
      if (rule.bottom === true) {
        return rule.percent === true
          ? t('sheetConditional.type.bottomPercent', { count })
          : t('sheetConditional.type.bottom', { count });
      }
      return rule.percent === true
        ? t('sheetConditional.type.topPercent', { count })
        : t('sheetConditional.type.top', { count });
    case 'average':
      return t(rule.below === true ? 'sheetConditional.type.below' : 'sheetConditional.type.above');
    case 'formula':
      return t('sheetConditional.type.formula', { a: str(rule.a) });
    case 'icons':
      return t('sheetConditional.type.icons', { set: str(rule.set) });
    default:
      return t('sheetConditional.type.unknown');
  }
}

/** The ranges of a rule in words: "column A", "row 3", "cells A2 to B5". */
export function describeRanges(rule: JsonObject, table: TableLike): string {
  const grid = gridOf(table);
  const parts: string[] = [];
  for (const range of Array.isArray(rule.ranges) ? rule.ranges : []) {
    const box = rangeBox(grid, range);
    if (!box || !isObject(range)) continue;
    if (typeof range.col === 'string') {
      parts.push(t('sheetConditional.manager.wholeColumn', { name: columnLetter(box.left) }));
    } else if (typeof range.row === 'string') {
      parts.push(t('sheetConditional.manager.wholeRow', { number: box.top + 1 }));
    } else {
      parts.push(
        t('sheetConditional.manager.cells', {
          from: `${columnLetter(box.left)}${box.top + 1}`,
          to: `${columnLetter(box.right)}${box.bottom + 1}`,
        }),
      );
    }
  }
  return parts.join(', ');
}

function managed(rule: Rule, table: TableLike, tableLabel?: string): ManagedRule {
  return {
    id: rule.id,
    summary: describeRule(rule.rule),
    ranges: describeRanges(rule.rule, table),
    stop: rule.rule.stop === true,
    tableLabel,
  };
}

function touches(a: Box, b: Box): boolean {
  return !(a.bottom < b.top || b.bottom < a.top || a.right < b.left || b.right < a.left);
}

/**
 * The rules of one table in the order they apply, for the cells of a selection or for the whole table. Rules of
 * a type this version does not know are not listed here: the model keeps them and does not apply them.
 */
export function managedRules(
  sheet: Sheet,
  table: TableLike,
  scope: Exclude<Scope, 'page'>,
  selection?: Box,
  tableLabel?: string,
): ManagedRule[] {
  const byId = new Map(rulesOf(sheet, table, 'conditional').map((r) => [r.id, r]));
  return applyOrder(sheet)
    .flatMap((id) => {
      const rule = byId.get(id);
      return rule ? [rule] : [];
    })
    .filter((r) => scope === 'table' || !selection || r.boxes.some((b) => touches(b, selection)))
    .map((r) => managed(r, table, tableLabel));
}

export interface Changed {
  sheet: Sheet;
  /** The patch for the table block's data, or null when nothing changed. */
  patch: JsonObject | null;
}

function change(sheet: Sheet, edit: (copy: Sheet) => void): Changed {
  const copy = readSheet({ sheet });
  edit(copy);
  return { sheet: copy, patch: sheetPatch(sheet, copy) };
}

function ruleOf(sheet: Sheet, id: string): JsonObject | undefined {
  const rules = sheet.conditional;
  const rule = isObject(rules) ? own(rules, id) : undefined;
  return isObject(rule) ? rule : undefined;
}

/** Moves a rule up (-1) or down (1) in the priority order and numbers every rule 1 to n, so no two share an order. */
export function moveRule(sheet: Sheet, id: string, by: -1 | 1): Changed {
  return change(sheet, (copy) => {
    const ids = applyOrder(copy);
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    ids.forEach((rid, i) => {
      const rule = ruleOf(copy, rid);
      if (rule) setRule(copy, 'conditional', rid, { ...rule, order: i + 1 });
    });
  });
}

/** Turns stop if true on or off for a rule. */
export function setStop(sheet: Sheet, id: string, stop: boolean): Changed {
  return change(sheet, (copy) => {
    const rule = ruleOf(copy, id);
    if (!rule) return;
    const next = { ...rule };
    if (stop) next.stop = true;
    else delete next.stop;
    setRule(copy, 'conditional', id, next);
  });
}

/** Deletes a rule. */
export function deleteRule(sheet: Sheet, id: string): Changed {
  return change(sheet, (copy) => removeRule(copy, 'conditional', id));
}
