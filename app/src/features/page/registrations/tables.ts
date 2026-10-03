// WP6's registrations for tables (PLAN.md section 2, rule 3): the table block renderer, the table commands, the
// page.table menu, the Insert tab and slash menu items, and the table editor's context menu. This file loads at
// start-up, so the renderer, the editor, and the commands' work load on first use.
import { menuItemsFor } from '../../../commands/menus';
import { commandContext } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import type { TableOp } from '../../../editor/commands/tables';
import { commandBar, commands, contextMenus } from '../../../registries';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { editMenu, registerAppMenu } from '../../../ui';
import { pageCommandDef } from '../keys';
import type { PageCommandId } from '../keys';
import { blockRenderers, slashItems } from '../registries';
import { shownQueue } from '../sync/shown';
import { currentTable } from '../tables/current';
import { lazyBlockView } from '../tables/lazyView';
import { lateRefines } from '../tables/refines';

const FLAG = 'page.tables' as const;

blockRenderers.register({
  id: 'table',
  types: ['table'],
  priority: 1,
  flag: FLAG,
  create: (block, ctx) => lazyBlockView(block, ctx, () => import('../blocks/tableBlock'), t('tables.block')),
});

const table = () => currentTable.get();

function register(id: PageCommandId, title: MessageKey, run: () => unknown, extra: object = {}): void {
  commands.register(
    lateRefines(
      pageCommandDef({
        id,
        title,
        keywords: 'tables.commands.keywords',
        category: 'table',
        flag: FLAG,
        when: () => table() !== null,
        run: async () => void (await run()),
        ...extra,
      }),
    ),
  );
}

/** Each structure command, its menu group, and its place in the group. */
const OPS: readonly [PageCommandId, TableOp, string, number][] = [
  ['table.rowAbove', { op: 'rowAbove' }, 'rows', 1],
  ['table.rowBelow', { op: 'rowBelow' }, 'rows', 2],
  ['table.moveRowUp', { op: 'moveRowUp' }, 'move', 1],
  ['table.moveRowDown', { op: 'moveRowDown' }, 'move', 2],
  ['table.columnLeft', { op: 'columnLeft' }, 'columns', 1],
  ['table.columnRight', { op: 'columnRight' }, 'columns', 2],
  ['table.headerRow', { op: 'headerRow' }, 'table', 1],
  ['table.deleteRow', { op: 'deleteRow' }, 'danger', 1],
  ['table.deleteColumn', { op: 'deleteColumn' }, 'danger', 2],
];

for (const [id, op, group, order] of OPS) {
  const title = `tables.commands.${id.slice('table.'.length)}` as MessageKey;
  register(id, title, () => table()?.run(op), {
    enabled: () => table()?.can(op) ?? false,
    ...(op.op === 'headerRow' ? { checked: () => table()?.header() ?? false } : {}),
  });
  contextMenus.register({ id, menu: 'page.table', command: id, group, order });
}

register('table.columnWidth', 'tables.commands.columnWidth', () => table()?.openColumnWidth());
register('table.select', 'tables.commands.select', () => table()?.selectAll());
register('table.deleteTable', 'tables.commands.deleteTable', () => table()?.deleteTable());
contextMenus.register({
  id: 'table.columnWidth',
  menu: 'page.table',
  command: 'table.columnWidth',
  group: 'columns',
  order: 3,
});
contextMenus.register({ id: 'table.select', menu: 'page.table', command: 'table.select', group: 'table', order: 2 });
contextMenus.register({
  id: 'table.deleteTable',
  menu: 'page.table',
  command: 'table.deleteTable',
  group: 'danger',
  order: 3,
});

commands.register(
  pageCommandDef({
    id: 'insert.table',
    title: 'tables.commands.insert',
    keywords: 'tables.commands.insertKeywords',
    category: 'insert',
    icon: 'Table',
    flag: FLAG,
    when: () => shownQueue.get() !== null,
    run: async () => void (await (await import('../tables/insert')).insertTable()),
  }),
);
commandBar.register({
  id: 'insert.table',
  tab: 'insert',
  group: 'tables',
  command: 'insert.table',
  priority: 60,
  flag: FLAG,
});
slashItems.register({
  id: 'table',
  title: 'tables.commands.insert',
  keywords: 'tables.commands.insertKeywords',
  icon: 'Table',
  group: 'advanced',
  order: 10,
  flag: FLAG,
  command: 'insert.table' satisfies CommandId,
});

// The table editor's context menu: Cut, Copy, Paste, and Select all, then the table's own commands.
registerAppMenu('table', (context) => {
  const edit = editMenu(context);
  const own = menuItemsFor('page.table', commandContext('menu'));
  const items = [...edit.items, ...own.map((item, i) => (i === 0 ? { ...item, separatorBefore: true } : item))];
  return { label: t('tables.menu.label'), items };
});
