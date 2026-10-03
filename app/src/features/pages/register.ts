// Phase 6's registrations, in one file: the View tab's page view, paper, and background; print and export; the page
// gallery; and slides. Everything here is small, because it loads at start-up. Each command loads its code on first
// use, and the paginated view attaches to a page when the page is mounted.
import { defineCommand, chord } from '../../commands/registry';
import type { CommandContext, CommandDef } from '../../commands/types';
import { commandBar, commands, contextMenus } from '../../registries';
import type { CommandBarItem, MenuId } from '../../registries/types';
import { mountedPageHooks, shownMounted } from '../page';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { openMenu } from '../../ui';
import { menuItemsFor } from '../../commands/menus';
import { isEnabled } from '../../app/flags';
import type { FlagId } from '../../app/flags';

import type { PagesViewState, PaperName, MarginName } from './live/shown';
import { pagesViewEpoch, shownPagesView } from './live/shown';

const shown = () => shownMounted.get() !== null;
const state = (): PagesViewState | null => shownPagesView.get()?.state() ?? null;
const api = () => shownPagesView.get();

/** Registers a command with the page-view defaults: the View category, the keywords, and a shown page. */
function command(def: Omit<CommandDef, 'category' | 'keywords'> & { keywords?: MessageKey; flag: FlagId }): void {
  commands.register(
    defineCommand({ category: 'view', keywords: 'pageViews.commands.keywords', when: shown, ...def } as CommandDef),
  );
}

const loadExport = () => import('./ui/exportCommands');

// ---- Output: print, PDF, Markdown, web page, picture --------------------------------------------------------------
command({
  id: 'pages.print',
  title: 'pageViews.commands.print',
  keys: [chord('Ctrl+P')],
  flag: 'pages.pdf',
  allowInTextInput: true,
  run: (ctx) => loadExport().then((m) => m.printPage(ctx, 'print')),
});
command({
  id: 'pages.exportPdf',
  title: 'pageViews.commands.exportPdf',
  flag: 'pages.pdf',
  run: (ctx) => loadExport().then((m) => m.printPage(ctx, 'export')),
});
command({
  id: 'pages.exportMarkdown',
  title: 'pageViews.commands.exportMarkdown',
  flag: 'pages.exportText',
  run: (ctx) => loadExport().then((m) => m.exportText(ctx, 'markdown')),
});
command({
  id: 'pages.exportHtml',
  title: 'pageViews.commands.exportHtml',
  flag: 'pages.exportText',
  run: (ctx) => loadExport().then((m) => m.exportText(ctx, 'html')),
});

command({
  id: 'pages.exportImage',
  title: 'pageViews.commands.exportImage',
  flag: 'pages.exportImage',
  run: (ctx) => import('./ui/imageCommands').then((m) => m.exportImage(ctx)),
});
command({
  id: 'pages.readingAids',
  title: 'pageViews.commands.readingAids',
  keywords: 'pageViews.commands.readingKeywords',
  flag: 'pages.reading',
  run: () => import('./ui/readingCommands').then((m) => m.openReadingAids()),
});
command({
  id: 'pages.gallery',
  title: 'pageViews.commands.gallery',
  keywords: 'pageViews.commands.galleryKeywords',
  flag: 'pages.gallery',
  when: () => true,
  run: (ctx) => import('./ui/galleryCommands').then((m) => m.openGallery(ctx)),
});
command({
  id: 'pages.present',
  title: 'pageViews.commands.present',
  keywords: 'pageViews.commands.presentKeywords',
  keys: [chord('F5')],
  flag: 'pages.slides',
  run: (ctx) => import('./ui/slideCommands').then((m) => m.presentPage(ctx)),
});

// ---- The View tab: page view, layout, paper, background, zoom -----------------------------------------------------
const MODES = [
  ['canvas', 'infinite', 'pageViews.commands.canvas'],
  ['pages', 'paginated', 'pageViews.commands.pages'],
] as const;
for (const [id, mode, title] of MODES) {
  command({
    id: `pages.view.${id}`,
    title,
    keywords: 'pageViews.commands.modeKeywords',
    flag: 'pages.view',
    checked: () => state()?.mode === mode,
    enabled: () => api() !== null,
    run: () => api()?.setMode(mode),
  });
}
const LAYOUTS = [
  ['flow', 'flow', 'pageViews.commands.flow'],
  ['free', 'freeform', 'pageViews.commands.freeCanvas'],
] as const;
for (const [id, layout, title] of LAYOUTS) {
  command({
    id: `pages.layout.${id}`,
    title,
    keywords: 'pageViews.commands.layoutKeywords',
    flag: 'pages.view',
    checked: () => state()?.layout === layout,
    enabled: () => api() !== null,
    run: () => api()?.setLayout(layout),
  });
}
command({
  id: 'pages.fitSheet',
  title: 'pageViews.commands.fitSheet',
  flag: 'pages.view',
  enabled: () => state()?.mode === 'paginated',
  run: () => api()?.fitSheet(),
});

const PAPERS: readonly PaperName[] = ['letter', 'a4', 'a5', 'legal', 'tabloid'];
for (const size of PAPERS) {
  command({
    id: `pages.paper.${size}`,
    title: `pageViews.paper.size.${size}`,
    keywords: 'pageViews.commands.paperKeywords',
    flag: 'pages.view',
    checked: () => state()?.paper === size,
    enabled: () => api() !== null,
    run: () => api()?.setPaper(size),
  });
}
for (const orientation of ['portrait', 'landscape'] as const) {
  command({
    id: `pages.paper.${orientation}`,
    title: `pageViews.paper.${orientation}`,
    keywords: 'pageViews.commands.paperKeywords',
    flag: 'pages.view',
    checked: () => state()?.orientation === orientation,
    enabled: () => api() !== null,
    run: () => api()?.setOrientation(orientation),
  });
}
const MARGINS: readonly MarginName[] = ['narrow', 'normal', 'wide'];
for (const margins of MARGINS) {
  command({
    id: `pages.margins.${margins}`,
    title: `pageViews.paper.margins.${margins}`,
    keywords: 'pageViews.commands.paperKeywords',
    flag: 'pages.view',
    checked: () => state()?.margins === margins,
    enabled: () => api() !== null,
    run: () => api()?.setMargins(margins),
  });
}
const BACKGROUNDS = [
  'plain',
  'ruled-narrow',
  'ruled-college',
  'ruled-wide',
  'grid-5mm',
  'grid-quarter-inch',
  'grid-1cm',
  'dots',
  'isometric',
  'cornell',
  'staff',
] as const;
for (const preset of BACKGROUNDS) {
  command({
    id: `pages.background.${preset}`,
    title: `pageViews.background.${preset}`,
    keywords: 'pageViews.commands.backgroundKeywords',
    flag: 'pages.view',
    checked: () => state()?.background === preset,
    enabled: () => api() !== null,
    run: () => api()?.setBackground(preset),
  });
}

// ---- Menus and the command bar ---------------------------------------------------------------------------------------
function menuCommand(
  id: `pages.${string}`,
  title: MessageKey,
  menu: MenuId,
  flag: FlagId,
  keywords?: MessageKey,
): void {
  command({
    id,
    title,
    keywords,
    flag,
    palette: false,
    run: async (ctx: CommandContext) => {
      const anchor = document.activeElement instanceof HTMLElement ? document.activeElement : { x: 0, y: 0 };
      await openMenu({ label: t(title), items: menuItemsFor(menu, ctx), anchor });
    },
  });
}
menuCommand('pages.paperMenu', 'pageViews.commands.paperMenu', 'pages.paper', 'pages.view');
menuCommand('pages.backgroundMenu', 'pageViews.commands.backgroundMenu', 'pages.background', 'pages.view');
menuCommand('pages.exportMenu', 'pageViews.commands.exportMenu', 'pages.export', 'pages.pdf');

let order = 0;
function menuItems(menu: MenuId, flag: FlagId, group: string, ids: readonly string[]): void {
  for (const id of ids) {
    contextMenus.register({
      id: `${menu}.${id}`,
      menu,
      command: id as `${string}.${string}`,
      group,
      order: (order += 1),
      flag,
    });
  }
}
menuItems(
  'pages.paper',
  'pages.view',
  'size',
  PAPERS.map((size) => `pages.paper.${size}`),
);
menuItems('pages.paper', 'pages.view', 'orientation', ['pages.paper.portrait', 'pages.paper.landscape']);
menuItems(
  'pages.paper',
  'pages.view',
  'margins',
  MARGINS.map((margins) => `pages.margins.${margins}`),
);
menuItems(
  'pages.background',
  'pages.view',
  'preset',
  BACKGROUNDS.map((preset) => `pages.background.${preset}`),
);
menuItems('pages.export', 'pages.pdf', 'file', ['pages.print', 'pages.exportPdf']);
menuItems('pages.export', 'pages.exportText', 'text', ['pages.exportMarkdown', 'pages.exportHtml']);
menuItems('pages.export', 'pages.exportImage', 'image', ['pages.exportImage']);

const bar = (item: Omit<CommandBarItem, 'tab'>): void => {
  commandBar.register({ tab: 'view', ...item });
};
bar({
  id: 'pages.bar.canvas',
  group: 'pageview',
  command: 'pages.view.canvas',
  priority: 80,
  presentation: 'toggle',
  flag: 'pages.view',
});
bar({
  id: 'pages.bar.pages',
  group: 'pageview',
  command: 'pages.view.pages',
  priority: 80,
  presentation: 'toggle',
  flag: 'pages.view',
});
bar({
  id: 'pages.bar.flow',
  group: 'pageview',
  command: 'pages.layout.flow',
  priority: 60,
  presentation: 'toggle',
  flag: 'pages.view',
});
bar({
  id: 'pages.bar.free',
  group: 'pageview',
  command: 'pages.layout.free',
  priority: 60,
  presentation: 'toggle',
  flag: 'pages.view',
});
bar({
  id: 'pages.bar.paper',
  group: 'paper',
  command: 'pages.paperMenu',
  priority: 70,
  presentation: 'menu',
  menu: 'pages.paper',
  flag: 'pages.view',
});
bar({
  id: 'pages.bar.background',
  group: 'paper',
  command: 'pages.backgroundMenu',
  priority: 70,
  presentation: 'menu',
  menu: 'pages.background',
  flag: 'pages.view',
});
bar({ id: 'pages.bar.zoomOut', group: 'zoom', command: 'page.zoomOut', priority: 50 });
bar({ id: 'pages.bar.zoomIn', group: 'zoom', command: 'page.zoomIn', priority: 50 });
bar({ id: 'pages.bar.zoom100', group: 'zoom', command: 'page.zoom100', priority: 40 });
bar({ id: 'pages.bar.fitWidth', group: 'zoom', command: 'page.zoomFitWidth', priority: 45 });
bar({ id: 'pages.bar.fitSheet', group: 'zoom', command: 'pages.fitSheet', priority: 45, flag: 'pages.view' });
bar({ id: 'pages.bar.reading', group: 'reading', command: 'pages.readingAids', priority: 30, flag: 'pages.reading' });
bar({ id: 'pages.bar.gallery', group: 'output', command: 'pages.gallery', priority: 35, flag: 'pages.gallery' });
bar({ id: 'pages.bar.present', group: 'output', command: 'pages.present', priority: 35, flag: 'pages.slides' });
bar({
  id: 'pages.bar.export',
  group: 'output',
  command: 'pages.exportMenu',
  priority: 65,
  presentation: 'menu',
  menu: 'pages.export',
  flag: 'pages.pdf',
});

/**
 * The bar reads a command's checked and enabled state when it renders, and the view's state changes on its own (the page
 * view attaches after the bar first draws, and undo changes the view), so a change tells the bar to read again. The
 * commands registry is what the bar watches, so a command that comes and goes right away does it.
 */
const refresher = defineCommand({
  id: 'pages.refresh',
  title: 'pageViews.commands.keywords',
  category: 'view',
  palette: false,
  when: () => false,
  run: () => undefined,
});
pagesViewEpoch.subscribe(() => {
  commands.register(refresher)();
});

// ---- Attaching to the page view ------------------------------------------------------------------------------------
mountedPageHooks.register({
  id: 'pages.view',
  attach(mounted) {
    if (!isEnabled('pages.view')) return () => undefined;
    let detach: () => void = () => undefined;
    let gone = false;
    void import('./live/controller').then(({ attachPagesView }) => {
      if (gone) return;
      detach = attachPagesView(mounted);
      pagesViewEpoch.set((n) => n + 1);
    });
    return () => {
      gone = true;
      detach();
    };
  },
});
