// WP6's registrations for tables (PLAN.md section 2, rule 3): the table block renderer, Insert table, and its
// Insert tab and slash menu items. This file loads at start-up, so the renderer, the editor, and the work of each
// command load on first use. The commands that apply inside a table register from their own chunk.
import type { CommandId } from '../../../commands/types';
import { commandBar, commands } from '../../../registries';
import { t } from '../../../strings/t';
import { pageCommandDef } from '../keys';
import { blockRenderers, slashItems } from '../registries';
import { shownQueue } from '../sync/shown';
import { later } from '../tables/later';
import { lazyBlockView } from '../tables/lazyView';

const FLAG = 'page.tables' as const;

blockRenderers.register({
  id: 'table',
  types: ['table'],
  priority: 1,
  flag: FLAG,
  create: (block, ctx) => lazyBlockView(block, ctx, () => import('../blocks/tableBlock'), t('tables.block')),
});

later(() => import('../tables/commands'));

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
