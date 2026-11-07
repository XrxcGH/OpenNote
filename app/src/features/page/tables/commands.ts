// The table commands (ARCHITECTURE.md section 13; owner: WP6): rows, columns, the header row, move row, column
// width, select, and delete, the page.table menu, and the table editor's context menu. They apply only inside a
// table, so they register from this chunk: in idle time after start-up, or when a table block first loads.
import { menuItemsFor } from '../../../commands/menus';
import { commandContext } from '../../../commands/registry';
import type { StructureOp, TableOp } from '../../../editor/commands/tables';
import { commands, contextMenus } from '../../../registries';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { editMenu, registerAppMenu } from '../../../ui';
import { pageCommandDef } from '../keys';
import type { PageCommandId } from '../keys';
import { currentTable } from './current';
import { lateRefines } from './refines';

const FLAG = 'page.tables' as const;

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

// The table editor's context menu: Cut, Copy, Paste, and Select all, then the table's own commands.
registerAppMenu('table', (context) => {
  const edit = editMenu(context);
  const own = menuItemsFor('page.table', commandContext('menu'));
  const items = [...edit.items, ...own.map((item, i) => (i === 0 ? { ...item, separatorBefore: true } : item))];
  return { label: t('tables.menu.label'), items };
});

/** Each structure command (ADR 0056, DESIGN 13.2): its op, its context menu group, and its Excel chord in Grid mode. */
const STRUCTURE: readonly { id: string; op: StructureOp; group?: string; keys?: readonly string[] }[] = [
  { id: 'fitRows', op: { op: 'fitRows' }, group: 'size' },
  { id: 'fitColumns', op: { op: 'fitColumns' }, group: 'size' },
  { id: 'distributeRows', op: { op: 'distributeRows' } },
  { id: 'distributeColumns', op: { op: 'distributeColumns' } },
  { id: 'hideRows', op: { op: 'hideRows' }, group: 'hide', keys: ['Ctrl+9'] },
  { id: 'unhideRows', op: { op: 'unhideRows' }, group: 'hide', keys: ['Ctrl+Shift+9'] },
  { id: 'hideColumns', op: { op: 'hideColumns' }, group: 'hide', keys: ['Ctrl+0'] },
  { id: 'unhideColumns', op: { op: 'unhideColumns' }, group: 'hide', keys: ['Ctrl+Shift+0'] },
  { id: 'freezeTopRow', op: { op: 'freezeTopRow' } },
  { id: 'freezeFirstColumn', op: { op: 'freezeFirstColumn' } },
  { id: 'freezeAtCaret', op: { op: 'freezeAtCaret' } },
  { id: 'unfreeze', op: { op: 'unfreeze' } },
  { id: 'groupRows', op: { op: 'groupRows' }, keys: ['Alt+Shift+Right'] },
  { id: 'ungroupRows', op: { op: 'ungroupRows' }, keys: ['Alt+Shift+Left'] },
  { id: 'groupColumns', op: { op: 'groupColumns' } },
  { id: 'ungroupColumns', op: { op: 'ungroupColumns' } },
  { id: 'clearOutlineRows', op: { op: 'clearOutline', axis: 'rows' } },
  { id: 'clearOutlineColumns', op: { op: 'clearOutline', axis: 'columns' } },
  { id: 'insertCellsDown', op: { op: 'insertCells', shift: 'down' }, group: 'cells', keys: ['Ctrl+Shift+='] },
  { id: 'insertCellsRight', op: { op: 'insertCells', shift: 'right' }, group: 'cells' },
  { id: 'deleteCellsUp', op: { op: 'deleteCells', shift: 'up' }, group: 'cells', keys: ['Ctrl+-'] },
  { id: 'deleteCellsLeft', op: { op: 'deleteCells', shift: 'left' }, group: 'cells' },
];

STRUCTURE.forEach(({ id, op, group, keys }, order) => {
  const command = `table.structure.${id}` as const;
  commands.register({
    id: command,
    title: `sheetStructure.commands.${id}` as MessageKey,
    keywords: 'sheetStructure.commands.keywords',
    category: 'table',
    when: () => table() !== null,
    enabled: () => table()?.can(op) ?? false,
    run: async () => void (await table()?.run(op)),
    ...(keys ? { keys: keys as never, scope: 'tableGrid' as const } : {}),
  });
  if (group) contextMenus.register({ id: command, menu: 'page.table', command, group, order: 20 + order });
});
