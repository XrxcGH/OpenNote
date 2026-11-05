// The order of the command bar's items. Owner: text:scaffold.
// Groups sit in the order their first item registered.
// The exception is the Insert tab, where the groups in INSERT_GROUPS come first, in that fixed order (NEXT-PLAN 3.6).
// So lanes that register from separate files never decide the order by load order.
// The names are the groups the registrations use today.
// 'tables' is Insert table. 'math' is Equation, Inline math, and Graph.
// Groups not listed (text, blocks, dates, media, pdf) keep their registration order after the fixed ones.
import type { CommandBarItem } from '../../registries/types';

/** The Insert tab's fixed group order. Groups not listed here keep their registration order, after these. */
export const INSERT_GROUPS = [
  'tables',
  'codeCell',
  'codeProject',
  'math',
  'symbol',
  'footnote',
  'endnote',
  'comment',
  'pageBreak',
  'columnBreak',
] as const;

/** The fixed Insert group names. Type a registration's group with this to catch a misspelled name. */
export type InsertGroup = (typeof INSERT_GROUPS)[number];

export function inBarOrder(items: readonly CommandBarItem[]): CommandBarItem[] {
  const keys = [...new Set(items.map((item) => `${item.tab} ${item.group}`))];
  const rank = (item: CommandBarItem): number => {
    const fixed = item.tab === 'insert' ? (INSERT_GROUPS as readonly string[]).indexOf(item.group) : -1;
    return fixed >= 0 ? fixed - INSERT_GROUPS.length : keys.indexOf(`${item.tab} ${item.group}`);
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}
