// The order of the command bar's items. Owner: text:scaffold. Groups sit in the order their first item registered,
// except on the Insert tab, where the groups in INSERT_GROUPS come last in that fixed order (NEXT-PLAN 3.6), so
// lanes that register from separate files never decide the order by load order.
import type { CommandBarItem } from '../../registries/types';

/** The Insert tab's fixed group order. Groups not listed here keep their registration order, ahead of these. */
export const INSERT_GROUPS = [
  'table',
  'codeCell',
  'codeProject',
  'equation',
  'symbol',
  'footnote',
  'endnote',
  'comment',
  'pageBreak',
  'columnBreak',
] as const;

export function inBarOrder(items: readonly CommandBarItem[]): CommandBarItem[] {
  const keys = [...new Set(items.map((item) => `${item.tab} ${item.group}`))];
  const rank = (item: CommandBarItem): number => {
    const fixed = item.tab === 'insert' ? (INSERT_GROUPS as readonly string[]).indexOf(item.group) : -1;
    return fixed >= 0 ? keys.length + fixed : keys.indexOf(`${item.tab} ${item.group}`);
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}
