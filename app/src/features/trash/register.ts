// Registers Trash's commands, both behind trash.view: opening the view, and restoring an item from its row or
// its context menu. The menu itself is registered with the tree's menus.

import { navigate } from '../../app/location';
import { defineCommand } from '../../commands/registry';
import { commands, contextMenus } from '../../registries';
import { deleteForever, emptyTrash } from './purge';
import { restoreTrashItem } from './restore';

commands.register(
  defineCommand({
    id: 'trash.open',
    title: 'tree.commands.openTrash',
    category: 'notebooks',
    flag: 'trash.view',
    run: () => navigate({ view: 'trash' }),
  }),
);

commands.register(
  defineCommand({
    id: 'trash.restore',
    title: 'tree.commands.restore',
    category: 'notebooks',
    flag: 'trash.view',
    palette: false,
    enabled: (ctx) => ctx.target?.kind === 'trashItem',
    async run(ctx) {
      if (ctx.target?.kind === 'trashItem') await restoreTrashItem(ctx.notes, ctx.target.id);
    },
  }),
);

// Deleting for good, behind trash.purge (purge.ts): Empty Trash from the palette, and Delete forever (Delete folder
// for a notebook) from an item's context menu.
commands.register(
  defineCommand({
    id: 'trash.empty',
    title: 'tree.commands.emptyTrash',
    category: 'notebooks',
    flag: 'trash.purge',
    keywords: 'tree.commands.keywords.emptyTrash',
    async run(ctx) {
      await emptyTrash(ctx.notes, await ctx.notes.listTrash());
    },
  }),
);

commands.register(
  defineCommand({
    id: 'trash.deleteForever',
    title: 'tree.commands.deleteForever',
    category: 'notebooks',
    flag: 'trash.purge',
    palette: false,
    enabled: (ctx) => ctx.target?.kind === 'trashItem',
    async run(ctx) {
      if (ctx.target?.kind !== 'trashItem') return;
      const id = ctx.target.id;
      const item = (await ctx.notes.listTrash()).find((listed) => listed.node.id === id);
      if (item) await deleteForever(ctx.notes, item);
    },
  }),
);

contextMenus.register({
  id: 'trash.item.deleteForever',
  menu: 'trash.item',
  command: 'trash.deleteForever',
  group: 'danger',
  order: 1,
  flag: 'trash.purge',
});
