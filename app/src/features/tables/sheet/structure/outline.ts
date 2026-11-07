// Outline groups (DESIGN 3.1: `level` 0 to 7 and `collapsed` on rows and columns). A group is a run of lines with a
// higher level than the line right after it. That line is the group's summary, as Excel's default has it (summary
// below, summary right). Collapsing hides the run and marks the summary `collapsed`; expanding shows the run again,
// but a group inside it that was collapsed on its own stays collapsed. A run that ends the table has no summary line,
// so it cannot collapse.

import type { Sheet, TableLike } from '../model/types';
import { MAX_LEVEL, assign, edit, idsOf, setting, span, type Axis, type Edited } from './edit';

/** The outline level of a line: 0 for none. */
export function levelOf(sheet: Sheet, axis: Axis, id: string): number {
  const level = setting(sheet, axis, id, 'level');
  return typeof level === 'number' && Number.isInteger(level) ? Math.min(MAX_LEVEL, Math.max(0, level)) : 0;
}

const levels = (sheet: Sheet, table: TableLike, axis: Axis): number[] =>
  idsOf(table, axis).map((id) => levelOf(sheet, axis, id));

const isCollapsed = (sheet: Sheet, axis: Axis, id: string): boolean => setting(sheet, axis, id, 'collapsed') === true;

/** The group before the summary at `index`: the contiguous lines above it with a higher level. */
export function groupBefore(all: readonly number[], index: number): number[] {
  const out: number[] = [];
  for (let j = index - 1; j >= 0 && all[j] > (all[index] ?? 0); j--) out.unshift(j);
  return out;
}

/** Collapsed marks that no longer have a group above them go, so a stale mark never hides the outline buttons. */
function tidyCollapsed(sheet: Sheet, table: TableLike, axis: Axis): void {
  const all = levels(sheet, table, axis);
  idsOf(table, axis).forEach((id, i) => {
    if (isCollapsed(sheet, axis, id) && groupBefore(all, i).length === 0)
      assign(sheet, axis, id, 'collapsed', undefined);
  });
}

/** Groups the lines from index `from` to `to`: each goes one level deeper, up to level 7. */
export function group(sheet: Sheet, table: TableLike, axis: Axis, from: number, to: number): Edited {
  const ids = span(table, axis, from, to);
  return edit(sheet, table, (s) => {
    for (const id of ids) assign(s, axis, id, 'level', Math.min(MAX_LEVEL, levelOf(s, axis, id) + 1));
  });
}

/** Ungroups the lines from index `from` to `to`: each goes one level up. A line that leaves every group shows. */
export function ungroup(sheet: Sheet, table: TableLike, axis: Axis, from: number, to: number): Edited {
  const ids = span(table, axis, from, to);
  return edit(sheet, table, (s) => {
    for (const id of ids) {
      const level = levelOf(s, axis, id) - 1;
      assign(s, axis, id, 'level', level > 0 ? level : undefined);
      if (level <= 0) assign(s, axis, id, 'hidden', undefined);
    }
    tidyCollapsed(s, table, axis);
  });
}

/** Removes every group of the axis and shows what they hid (Clear Outline). */
export function clearOutline(sheet: Sheet, table: TableLike, axis: Axis): Edited {
  return edit(sheet, table, (s) => {
    for (const id of idsOf(table, axis)) {
      if (levelOf(s, axis, id) === 0 && !isCollapsed(s, axis, id)) continue;
      if (levelOf(s, axis, id) > 0) assign(s, axis, id, 'hidden', undefined);
      assign(s, axis, id, 'level', undefined);
      assign(s, axis, id, 'collapsed', undefined);
    }
  });
}

/** Collapses the group above the summary line at `index`. Nothing changes when no group is there. */
export function collapse(sheet: Sheet, table: TableLike, axis: Axis, index: number): Edited {
  const ids = idsOf(table, axis);
  const run = groupBefore(levels(sheet, table, axis), index);
  return edit(sheet, table, (s) => {
    if (run.length === 0 || ids[index] === undefined) return;
    for (const j of run) assign(s, axis, ids[j], 'hidden', true);
    assign(s, axis, ids[index], 'collapsed', true);
  });
}

/** Expands the group above the summary line at `index`; a group inside it that was collapsed stays collapsed. */
export function expand(sheet: Sheet, table: TableLike, axis: Axis, index: number): Edited {
  const ids = idsOf(table, axis);
  const all = levels(sheet, table, axis);
  const run = groupBefore(all, index);
  return edit(sheet, table, (s) => {
    if (run.length === 0 || ids[index] === undefined) return;
    const stay = new Set<number>();
    for (const j of run) {
      if (isCollapsed(s, axis, ids[j])) for (const k of groupBefore(all, j)) stay.add(k);
    }
    for (const j of run) if (!stay.has(j)) assign(s, axis, ids[j], 'hidden', undefined);
    assign(s, axis, ids[index], 'collapsed', undefined);
  });
}

/** Whether the group above the summary line at `index` shows: false when it is collapsed. */
export function isExpanded(sheet: Sheet, table: TableLike, axis: Axis, index: number): boolean {
  const id = idsOf(table, axis)[index];
  return id !== undefined && !isCollapsed(sheet, axis, id);
}

/**
 * The outline's number buttons: shows the lines of level below `level` and hides the deeper ones. Level 8 shows
 * everything, level 1 shows only the lines that belong to no group.
 */
export function showLevels(sheet: Sheet, table: TableLike, axis: Axis, level: number): Edited {
  const ids = idsOf(table, axis);
  const all = levels(sheet, table, axis);
  return edit(sheet, table, (s) => {
    ids.forEach((id, i) => {
      if (all[i] === 0) return;
      assign(s, axis, id, 'hidden', all[i] >= level ? true : undefined);
    });
    ids.forEach((id, i) => {
      // A summary is collapsed when the line before it, a member of its group, is hidden.
      const member = groupBefore(all, i).length > 0 && i > 0 && all[i - 1] > all[i];
      assign(s, axis, id, 'collapsed', member && all[i - 1] >= level ? true : undefined);
    });
  });
}
