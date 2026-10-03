// Registers the layout's commands, menus, command bar items, and title bar items: the pane commands and their
// menus, F6 between regions, back and forward, "Reveal in tree", the window commands, the history arrows, and the
// breadcrumb (ARCHITECTURE.md sections 10 and 11).

import { commandBar, commands, contextMenus, titleBarItems } from '../../registries';
import { Breadcrumb } from '../../shell/titlebar/Breadcrumb';
import { BackButton, ForwardButton } from '../../shell/titlebar/HistoryButtons';
import { BREADCRUMB_ID } from '../../shell/titlebar/TitleBar';
import { PANE_MENU_ITEMS, PANE_WIDTHS_MENU } from './menuCommands';
import { NAV_COMMANDS } from './navCommands';
import { PANE_COMMANDS } from './paneCommands';
import { WINDOW_COMMANDS } from './windowCommands';

[...PANE_COMMANDS, PANE_WIDTHS_MENU, ...NAV_COMMANDS, ...WINDOW_COMMANDS].forEach((def) => commands.register(def));
PANE_MENU_ITEMS.forEach((item) => contextMenus.register(item));

commandBar.register({
  id: 'layout.notebooksPane',
  tab: 'view',
  group: 'panes',
  command: 'layout.toggleNotebooks',
  priority: 90,
  presentation: 'toggle',
});
commandBar.register({
  id: 'layout.pagesPane',
  tab: 'view',
  group: 'panes',
  command: 'layout.togglePages',
  priority: 89,
  presentation: 'toggle',
});
commandBar.register({
  id: 'layout.paneWidths',
  tab: 'view',
  group: 'panes',
  command: 'layout.paneWidths',
  priority: 80,
  presentation: 'menu',
  menu: 'view.paneWidths',
});
commandBar.register({
  id: 'layout.revealInTree',
  tab: 'view',
  group: 'navigation',
  command: 'nav.revealInTree',
  priority: 50,
});

titleBarItems.register({
  id: 'nav.back',
  side: 'start',
  order: 10,
  priority: 70,
  compact: 'hide',
  Component: BackButton,
});
titleBarItems.register({
  id: 'nav.forward',
  side: 'start',
  order: 11,
  priority: 60,
  compact: 'hide',
  Component: ForwardButton,
});
titleBarItems.register({
  id: BREADCRUMB_ID,
  side: 'start',
  order: 20,
  priority: 1000,
  compact: 'hide',
  Component: Breadcrumb,
});
