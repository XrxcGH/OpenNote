// Registers Trash's commands, both behind trash.view: opening the view, and restoring an item from its row or
// its context menu. The menu itself is registered with the tree's menus.

import { navigate } from '../../app/location';
import { defineCommand } from '../../commands/registry';
import { commands } from '../../registries';
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
