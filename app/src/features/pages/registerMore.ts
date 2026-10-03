// The pages area's second pass of commands, menu items, and bar items, in one file so the first pass (register.ts)
// stays as it was: layout templates and spacing, the sheet navigator, accessible PDF, the elements library, selection
// export, presenting with a laser, and syllable marks. Each command loads its code on first use.
import { defineCommand } from '../../commands/registry';
import type { CommandDef } from '../../commands/types';
import { commands, contextMenus } from '../../registries';
import type { MenuId } from '../../registries/types';
import { shownMounted } from '../page';
import type { MessageKey } from '../../strings/t';
import type { FlagId } from '../../app/flags';

import { spacingRangeMm } from './layout/layouts';
import { shownPagesView } from './live/shown';

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
