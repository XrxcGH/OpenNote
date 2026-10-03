// Registers Import notes and Export (Phase 11): palette commands, Home tab items, and "Export…" on the tree's
// notebook, section, and page menus. The dialogs load when a command runs, so start-up carries only this file.

import { lazy } from 'react';
import { getLocation } from '../../app/location';
import { defineCommand } from '../../commands/registry';
import type { CommandContext } from '../../commands/types';
import { commandBar, commands, contextMenus } from '../../registries';
import type { MenuId } from '../../registries/types';
import type { NodeId } from '../../services/notes/types';
import { showOverlay } from '../../shell/commandbar/overlays';

const LazyImport = lazy(() => import('./ImportDialog'));
const LazyExport = lazy(() => import('./ExportDialog'));

/** The node an export starts from: the row a menu opened on, else the page, section, or notebook that is open. */
function exportStart(ctx: Pick<CommandContext, 'target'>): NodeId | null {
  if (ctx.target?.kind === 'node') return ctx.target.id;
  const location = getLocation();
  if (location.view !== 'workspace') return null;
  return location.pageId ?? location.sectionId ?? location.notebookId;
}

commands.register(
  defineCommand({
    id: 'interop.import',
    title: 'interop.commands.import',
    keywords: 'interop.commands.keywords',
    category: 'notebooks',
    flag: 'interop.import',
    run(ctx) {
      showOverlay('interop-import', LazyImport, { interop: ctx.platform.interop, notes: ctx.notes });
    },
  }),
);

commands.register(
  defineCommand({
    id: 'interop.export',
    title: 'interop.commands.export',
    keywords: 'interop.commands.keywords',
    category: 'notebooks',
    flag: 'interop.export',
    when: (ctx) => exportStart(ctx) !== null,
    async run(ctx) {
      const start = exportStart(ctx);
      if (!start) return;
      const { resolveTarget } = await import('./exportTarget');
      const target = await resolveTarget(ctx.notes, start);
      if (!target) return;
      showOverlay('interop-export', LazyExport, { interop: ctx.platform.interop, notes: ctx.notes, target });
    },
  }),
);

// The bar and the menus put their groups in the order each first registered. Features register in folder order,
// so this waits until every feature has, and the new items then follow the tree's New, Edit, and Move groups.
queueMicrotask(() => {
  commandBar.register({
    id: 'home.interop.import',
    tab: 'home',
    group: 'share',
    command: 'interop.import',
    priority: 40,
    flag: 'interop.import',
  });
  commandBar.register({
    id: 'home.interop.export',
    tab: 'home',
    group: 'share',
    command: 'interop.export',
    priority: 39,
    flag: 'interop.export',
  });

  for (const menu of ['tree.notebook', 'tree.section', 'tree.page'] as const satisfies readonly MenuId[]) {
    contextMenus.register({
      id: `${menu}.export`,
      menu,
      command: 'interop.export',
      group: 'share',
      order: 80,
      flag: 'interop.export',
    });
  }
});
