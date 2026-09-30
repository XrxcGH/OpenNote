// The View tab's "Pane widths" menu button (ARCHITECTURE.md section 11.3) and its items, and the splitter menus.
// Both menus list the same pane commands, so the 8 px mouse splitter meets WCAG 2.5.8 through an equivalent control.

import { menuItemsFor } from '../../commands/menus';
import { defineCommand } from '../../commands/registry';
import type { CommandDef } from '../../commands/types';
import type { ContextMenuItem, MenuId } from '../../registries/types';
import type { PaneId } from '../../shell/layout/solvePanes';
import { layoutStore } from '../../state/layout';
import { t } from '../../strings/t';
import { openMenu } from '../../ui';
import { paneMenuCommands } from './paneCommands';

export const PANE_WIDTHS_MENU: CommandDef = defineCommand({
  id: 'layout.paneWidths',
  title: 'layout.commands.paneWidths',
  category: 'view',
  palette: false,
  when: () => ['wide', 'expanded'].includes(layoutStore.get().sizeClass),
  async run(ctx) {
    const anchor = document.activeElement instanceof HTMLElement ? document.activeElement : { x: 0, y: 0 };
    await openMenu({ label: t('layout.commands.paneWidths'), items: menuItemsFor('view.paneWidths', ctx), anchor });
  },
});

function items(menu: MenuId, pane: PaneId, groupPrefix = ''): ContextMenuItem[] {
  return paneMenuCommands(pane).map(({ command, group }, order) => ({
    id: `${menu}.${command}`,
    menu,
    command,
    group: `${groupPrefix}${group}`,
    order,
  }));
}

/** Every item of the two splitter menus and the Pane widths menu. */
export const PANE_MENU_ITEMS: readonly ContextMenuItem[] = [
  ...items('splitter.notebooks', 'notebooks'),
  ...items('splitter.pages', 'pages'),
  ...items('view.paneWidths', 'notebooks', 'notebooks.'),
  ...items('view.paneWidths', 'pages', 'pages.'),
];
