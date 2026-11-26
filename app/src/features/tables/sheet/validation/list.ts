// The drop-down of a list rule (Alt+Down, or the arrow in the cell), and of a choice column.
import { ruleAt } from './check';
import { listItems } from './operands';
import type { At, Context } from './types';

export interface ListOffer {
  items: string[];
  /** Pick several (a choice column that allows it): the cell shows its picks as chips. */
  multi: boolean;
  /** The cell shows an arrow. Alt+Down opens the list either way. */
  arrow: boolean;
}

/** What Alt+Down offers in a cell: the rule's items, or null when the cell has no list rule. */
export function openList(ctx: Context, at: At): ListOffer | null {
  const found = ruleAt(ctx, at);
  if (!found || found.rule.kind !== 'list') return null;
  const column = ctx.table.columns[at.col];
  return {
    items: listItems(ctx, found.rule, at, found.anchor),
    multi: column?.type === 'choice' && column.multi === true,
    arrow: found.rule.dropDown !== false,
  };
}
