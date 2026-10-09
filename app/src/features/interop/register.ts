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
import type { DrawPdf } from './exportFlow';

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
      const { platform, notes } = ctx;
      // A PDF export prints each page in the hidden print window first (features/pdf/bundle.ts).
      const drawPdf: DrawPdf = async (job, request, signal, onPage) => {
        const [{ drawBundle, collectSource }, { shownMounted }] = await Promise.all([
          import('../pages'),
          import('../page'),
        ]);
        const shown = async (pageId: string) => (shownMounted.get()?.page.id === pageId ? collectSource(notes) : null);
        const { pages, exports, interop } = platform;
        return drawBundle({
          pages,
          exports,
          interop,
          job,
          notebook: request.title,
          sections: request.sections,
          shown,
          signal,
          onPage,
        });
      };
      showOverlay('interop-export', LazyExport, {
        interop: platform.interop,
        notes,
        target,
        ...(platform.interop.more ? { drawPdf } : {}),
      });
    },
  }),
);

// Share as a file (ADR 0035): the Export dialog in its share mode, which makes one .opennote file with an optional
// password and page history. Opening that file later imports it as a new notebook.
commands.register(
  defineCommand({
    id: 'interop.share',
    title: 'interop.share.command',
    keywords: 'interop.share.keywords',
    category: 'notebooks',
    flag: 'interop.share',
    when: (ctx) => exportStart(ctx) !== null,
    async run(ctx) {
      const start = exportStart(ctx);
      if (!start) return;
      const { resolveTarget } = await import('./exportTarget');
      const target = await resolveTarget(ctx.notes, start);
      if (!target) return;
      showOverlay('interop-share', LazyExport, {
        interop: ctx.platform.interop,
        notes: ctx.notes,
        target,
        mode: 'share' as const,
      });
    },
  }),
);

// Open file: a Markdown or text file becomes a page that saves back to the file, and a shared .opennote file
// opens through Import notes (openFiles.ts).
commands.register(
  defineCommand({
    id: 'interop.openFile',
    title: 'interop.openFiles.command',
    keywords: 'interop.openFiles.keywords',
    category: 'notebooks',
    flag: 'interop.openFiles',
    async run(ctx) {
      const path = await ctx.platform.interop.pick('file', null);
      if (!path) return;
      const { openFiles, OpenFiles } = await import('./openFiles');
      const running =
        openFiles() ??
        new OpenFiles({
          platform: ctx.platform,
          notes: ctx.notes,
          openPage: async (notes, page) => (await import('../search')).openPage(notes, page),
          shownText: () => Promise.resolve(null),
        });
      await running.open(path);
    },
  }),
);

// Windows lets only the person choose a default app, so this shows the Default apps page and changes nothing.
commands.register(
  defineCommand({
    id: 'interop.defaultApp',
    title: 'interop.openFiles.makeDefault',
    keywords: 'interop.openFiles.keywords',
    category: 'notebooks',
    flag: 'interop.openFiles',
    when: (ctx) => Boolean(ctx.platform.interop.more),
    async run(ctx) {
      await ctx.platform.interop.more?.('open_default_apps', {});
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
    contextMenus.register({
      id: `${menu}.share`,
      menu,
      command: 'interop.share',
      group: 'share',
      order: 81,
      flag: 'interop.share',
    });
  }
  // The page's own Export and Print menu.
  contextMenus.register({
    id: 'pages.export.share',
    menu: 'pages.export',
    command: 'interop.share',
    group: 'share',
    order: 90,
    flag: 'interop.share',
  });
  commandBar.register({
    id: 'home.interop.openFile',
    tab: 'home',
    group: 'share',
    command: 'interop.openFile',
    priority: 41,
    flag: 'interop.openFiles',
  });
  commandBar.register({
    id: 'home.interop.share',
    tab: 'home',
    group: 'share',
    command: 'interop.share',
    priority: 38,
    flag: 'interop.share',
  });
});
