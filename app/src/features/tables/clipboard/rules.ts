// Validation rules on paste (DESIGN 13.7, ADR 0067). OpenNote's own form carries the copied cells' rules; a paste of
// a copy from the same page gives the pasted cells those rules and takes them out of the rules that covered them
// before, as a spreadsheet's paste replaces a cell's validation. Pure: tests run it without an editor.

import { freeRuleId, removeRule, rulesOf, setRule } from '../sheet/model';
import { RANGE_LIMIT } from '../sheet/model/rules';
import type { Box, JsonObject, Sheet } from '../sheet/model';
import { cornersOf, gridOf, overlaps } from '../sheet/model/grid';
import type { TableData } from '../../../editor/schema/specs';

/** A pasted cell by grid position, with the index of its rule in the clip's rules, if any. */
export interface RuleCell {
  row: number;
  col: number;
  rule?: number;
}

/** The fewest row runs, joined down where they line up, that cover the cells exactly. */
export function boxesOf(cells: readonly { row: number; col: number }[]): Box[] {
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const runs: Box[] = [];
  for (const { row, col } of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.top === row && last.right === col - 1) last.right = col;
    else if (!last || last.top !== row || last.right < col) runs.push({ top: row, bottom: row, left: col, right: col });
  }
  const out: Box[] = [];
  for (const run of runs) {
    const above = out.find((b) => b.bottom === run.top - 1 && b.left === run.left && b.right === run.right);
    if (above) above.bottom = run.bottom;
    else out.push(run);
  }
  return out;
}

/** What is left of `box` once `cut` is taken out: up to four boxes. */
export function subtract(box: Box, cut: Box): Box[] {
  if (!overlaps(box, cut)) return [box];
  const out: Box[] = [];
  const top = Math.max(box.top, cut.top);
  const bottom = Math.min(box.bottom, cut.bottom);
  if (box.top < cut.top) out.push({ ...box, bottom: cut.top - 1 });
  if (box.bottom > cut.bottom) out.push({ ...box, top: cut.bottom + 1 });
  if (box.left < cut.left) out.push({ top, bottom, left: box.left, right: cut.left - 1 });
  if (box.right > cut.right) out.push({ top, bottom, left: cut.right + 1, right: box.right });
  return out;
}

/**
 * Gives the pasted cells the clip's rules. Changes `sheet` in place. Returns false when a rule could not be kept
 * (past the 256 rules or the 64 ranges a rule may have), for the announcement.
 */
export function pasteRules(sheet: Sheet, table: TableData, rules: readonly JsonObject[], cells: readonly RuleCell[]) {
  if (cells.length === 0) return true;
  const grid = gridOf(table);
  const ranges = (boxes: readonly Box[]) => boxes.map((box) => cornersOf(grid, box) as unknown as JsonObject);
  const pasted = boxesOf(cells);
  let kept = true;
  // The pasted cells leave the rules that covered them.
  for (const found of rulesOf(sheet, table, 'validation')) {
    if (!found.boxes.some((b) => pasted.some((p) => overlaps(b, p)))) continue;
    let boxes = found.boxes;
    for (const cut of pasted) boxes = boxes.flatMap((b) => subtract(b, cut));
    if (boxes.length === 0) removeRule(sheet, 'validation', found.id);
    else if (boxes.length > RANGE_LIMIT) kept = false;
    else setRule(sheet, 'validation', found.id, { ...found.rule, ranges: ranges(boxes) });
  }
  const byRule = new Map<number, RuleCell[]>();
  for (const cell of cells) {
    if (cell.rule === undefined) continue;
    const list = byRule.get(cell.rule) ?? [];
    list.push(cell);
    byRule.set(cell.rule, list);
  }
  for (const [index, list] of byRule) {
    const rule = rules[index];
    if (!rule || Object.keys(rule).length === 0) continue;
    const boxes = boxesOf(list);
    const id = freeRuleId(sheet, 'validation');
    if (boxes.length > RANGE_LIMIT || !setRule(sheet, 'validation', id, { ...rule, ranges: ranges(boxes) }))
      kept = false;
  }
  return kept;
}
