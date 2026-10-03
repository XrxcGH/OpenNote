// The pages area's second pass of commands, menu items, and bar items, in one file so the first pass (register.ts)
// stays as it was: layout templates and spacing, the sheet navigator, accessible PDF, the elements library, selection
// export, presenting with a laser, and syllable marks. Each command loads its code on first use.
import { chord, defineCommand } from '../../commands/registry';
import type { CommandDef } from '../../commands/types';
import { commandBar, commands, contextMenus } from '../../registries';
import type { MenuId } from '../../registries/types';
import { pageSelection, shownMounted } from '../page';
import type { MessageKey } from '../../strings/t';
import type { FlagId } from '../../app/flags';

import { spacingRangeMm } from './layout/layouts';
import { setSheetNav, sheetNav, shownPagesView } from './live/shown';

const shown = () => shownMounted.get() !== null;
const api = () => shownPagesView.get();

/** Registers a command with the defaults of this file: the View category, the keywords, and a shown page. */
function command(def: Omit<CommandDef, 'category' | 'keywords'> & { keywords?: MessageKey; flag: FlagId }): void {
  commands.register(
    defineCommand({ category: 'view', keywords: 'pagesPlus.commands.keywords', when: shown, ...def } as CommandDef),
  );
}

let order = 1000;
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

// ---- Page layouts: templates, spacing, saved layouts, and the notebook default -----------------------------------------
const TEMPLATES = [
  ['lab', 'pagesPlus.commands.templateLab'],
  ['planner', 'pagesPlus.commands.templatePlanner'],
  ['storyboard', 'pagesPlus.commands.templateStoryboard'],
] as const;
for (const [key, title] of TEMPLATES) {
  command({
    id: `pages.template.${key}`,
    title,
    keywords: 'pagesPlus.commands.templateKeywords',
    flag: 'pages.layouts',
    checked: () => api()?.state().background === key,
    enabled: () => api() !== null,
    run: () => import('./ui/layoutCommands').then((m) => m.applyBuiltin(key)),
  });
}
command({
  id: 'pages.spacing',
  title: 'pagesPlus.commands.spacing',
  keywords: 'pagesPlus.commands.spacingKeywords',
  flag: 'pages.layouts',
  enabled: () => {
    const view = api()?.view();
    return view !== undefined && spacingRangeMm(view.background.pattern) !== null;
  },
  run: () => import('./ui/layoutCommands').then((m) => m.openSpacing()),
});
command({
  id: 'pages.layoutTemplates',
  title: 'pagesPlus.commands.layoutTemplates',
  keywords: 'pagesPlus.commands.layoutTemplatesKeywords',
  flag: 'pages.layouts',
  enabled: () => api() !== null,
  run: (ctx) => import('./ui/layoutCommands').then((m) => m.openTemplates(ctx)),
});
command({
  id: 'pages.notebookDefault',
  title: 'pagesPlus.commands.notebookDefault',
  keywords: 'pagesPlus.commands.notebookDefaultKeywords',
  flag: 'pages.layouts',
  enabled: () => api() !== null,
  run: () => import('./ui/layoutCommands').then((m) => m.useForNewPages(true)),
});
command({
  id: 'pages.notebookDefaultClear',
  title: 'pagesPlus.commands.notebookDefaultClear',
  keywords: 'pagesPlus.commands.notebookDefaultKeywords',
  flag: 'pages.layouts',
  run: () => import('./ui/layoutCommands').then((m) => m.useForNewPages(false)),
});
menuItems(
  'pages.background',
  'pages.layouts',
  'template',
  TEMPLATES.map(([key]) => `pages.template.${key}`),
);
menuItems('pages.background', 'pages.layouts', 'layout', [
  'pages.spacing',
  'pages.layoutTemplates',
  'pages.notebookDefault',
  'pages.notebookDefaultClear',
]);

// ---- The sheet navigator: a strip of thumbnails, Go to sheet, flipping, and adding a sheet ------------------------------
const paginated = () => api()?.state().mode === 'paginated';
const sheetsModule = () => import('./ui/sheetCommands');
command({
  id: 'pages.sheet.navigator',
  title: 'pagesPlus.commands.sheetNavigator',
  keywords: 'pagesPlus.commands.sheetKeywords',
  flag: 'pages.sheets',
  checked: () => sheetNav.get().open,
  enabled: paginated,
  run: () => setSheetNav({ open: !sheetNav.get().open }),
});
command({
  id: 'pages.sheet.flip',
  title: 'pagesPlus.commands.sheetFlip',
  keywords: 'pagesPlus.commands.sheetKeywords',
  flag: 'pages.sheets',
  checked: () => sheetNav.get().flip,
  enabled: paginated,
  run: () => setSheetNav({ flip: !sheetNav.get().flip }),
});
command({
  id: 'pages.sheet.goTo',
  title: 'pagesPlus.commands.sheetGoTo',
  keywords: 'pagesPlus.commands.sheetKeywords',
  flag: 'pages.sheets',
  enabled: paginated,
  run: () => sheetsModule().then((m) => m.openGoToSheet()),
});
command({
  id: 'pages.sheet.next',
  title: 'pagesPlus.commands.sheetNext',
  keywords: 'pagesPlus.commands.sheetKeywords',
  keys: [chord('Alt+PageDown')],
  flag: 'pages.sheets',
  allowInTextInput: true,
  enabled: paginated,
  run: () => sheetsModule().then((m) => m.stepSheet(1)),
});
command({
  id: 'pages.sheet.previous',
  title: 'pagesPlus.commands.sheetPrevious',
  keywords: 'pagesPlus.commands.sheetKeywords',
  keys: [chord('Alt+PageUp')],
  flag: 'pages.sheets',
  allowInTextInput: true,
  enabled: paginated,
  run: () => sheetsModule().then((m) => m.stepSheet(-1)),
});
command({
  id: 'pages.sheet.add',
  title: 'pagesPlus.commands.sheetAdd',
  keywords: 'pagesPlus.commands.sheetKeywords',
  flag: 'pages.sheets',
  enabled: paginated,
  run: () => api()?.addSheet(),
});
commandBar.register({
  tab: 'view',
  id: 'pages.bar.sheets',
  group: 'pageview',
  command: 'pages.sheet.navigator',
  priority: 55,
  presentation: 'toggle',
  flag: 'pages.sheets',
});

// ---- The elements library: Save as element, and a library to browse, search, share, and insert from ----------------------
command({
  id: 'pages.elements.library',
  title: 'pagesPlus.commands.elementsLibrary',
  keywords: 'pagesPlus.commands.elementsKeywords',
  flag: 'pages.elements',
  when: () => true,
  run: (ctx) => import('./ui/elementCommands').then((m) => m.openElementsLibrary(ctx)),
});
command({
  id: 'pages.elements.save',
  title: 'pagesPlus.commands.saveElement',
  keywords: 'pagesPlus.commands.elementsKeywords',
  flag: 'pages.elements',
  enabled: () => pageSelection.get().blocks.length + pageSelection.get().strokes.length > 0,
  run: (ctx) => import('./ui/elementCommands').then((m) => m.saveSelectionAsElement(ctx)),
});
commandBar.register({
  tab: 'view',
  id: 'pages.bar.elements',
  group: 'output',
  command: 'pages.elements.library',
  priority: 33,
  flag: 'pages.elements',
});
commandBar.register({
  tab: 'view',
  id: 'pages.bar.saveElement',
  group: 'output',
  command: 'pages.elements.save',
  priority: 32,
  flag: 'pages.elements',
});

// ---- Export selection: the lasso's picks as PDF, PNG, SVG, or Word, and copy as an image -----------------------------------
command({
  id: 'pages.exportSelection',
  title: 'pagesPlus.commands.exportSelection',
  keywords: 'pagesPlus.commands.exportKeywords',
  flag: 'pages.exportSelection',
  run: (ctx) => import('./ui/imageCommands').then((m) => m.exportImage(ctx, ['pdf', 'png', 'svg', 'docx'])),
});
command({
  id: 'pages.copyImage',
  title: 'pagesPlus.commands.copyImage',
  keywords: 'pagesPlus.commands.exportKeywords',
  flag: 'pages.exportSelection',
  run: (ctx) => import('./ui/imageCommands').then((m) => m.copyImage(ctx)),
});
menuItems('pages.export', 'pages.exportSelection', 'selection', ['pages.exportSelection', 'pages.copyImage']);

// ---- Present the whole page with a laser pointer and ink that fades -------------------------------------------------------
command({
  id: 'pages.presentPage',
  title: 'pagesPlus.commands.presentPage',
  keywords: 'pagesPlus.commands.presentKeywords',
  keys: [chord('Shift+F5')],
  flag: 'pages.laser',
  run: (ctx) => import('./ui/presentCommands').then((m) => m.presentWholePage(ctx)),
});
commandBar.register({
  tab: 'view',
  id: 'pages.bar.presentPage',
  group: 'output',
  command: 'pages.presentPage',
  priority: 34,
  flag: 'pages.laser',
});
