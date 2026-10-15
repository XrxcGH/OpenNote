// The context menu items of the quality-of-life features: open in a tab or window, pin, duplicate, copy, shortcuts,
// checks, archive, and the Sort menu of the command bar. They register from here, after the tree items, so they sit
// below them in each menu (a menu lists its groups in the order they were registered); the commands are in
// features/qol.

import type { CommandId } from '../../commands/types';
import { contextMenus } from '../../registries';
import type { MenuId } from '../../registries/types';

type MenuEntry = readonly [menu: MenuId, id: string, command: string, order: number, group?: string];

const MENU_ENTRIES: readonly MenuEntry[] = [
  ['tree.page', 'tree.openInNewTab', 'tabs.openInNewTab', 20],
  ['tree.page', 'tree.openInWindow', 'tabs.openInWindow', 21],
  ['tree.page', 'tree.pin', 'tree.pin', 22],
  ['tree.page', 'tree.unpin', 'tree.unpin', 23],
  ['tree.page', 'tree.duplicate', 'tree.duplicate', 24],
  ['tree.page', 'tree.copyTo', 'tree.copyTo', 25],
  ['tree.page', 'tree.createShortcut', 'notes.createShortcut', 29],
  ['tree.page', 'tree.checkA11y', 'page.checkAccessibility', 30],
  ['tree.page', 'tree.archive', 'tree.archive', 31],
  ['tree.page', 'tree.unarchive', 'tree.unarchive', 32],
  ['tree.page', 'tree.openInEditor', 'page.openInEditor', 33],
  ['tree.section', 'tree.openInNewTab', 'tabs.openInNewTab', 20],
  ['tree.section', 'tree.duplicate', 'tree.duplicate', 24],
  ['tree.section', 'tree.copyTo', 'tree.copyTo', 25],
  ['tree.section', 'tree.createShortcut', 'notes.createShortcut', 29],
  ['tree.section', 'tree.checkA11y', 'page.checkAccessibility', 30],
  ['tree.section', 'tree.archive', 'tree.archive', 31],
  ['tree.section', 'tree.unarchive', 'tree.unarchive', 32],
  ['tree.section', 'tree.deleteHistory', 'history.deleteSectionHistory', 33],
  // Password-protected sections (features/protect); each shows only in the state it applies to.
  ['tree.section', 'protect.protect', 'protect.protectSection', 34],
  ['tree.section', 'protect.unlock', 'protect.unlockSection', 35],
  ['tree.section', 'protect.lock', 'protect.lockSection', 36],
  ['tree.section', 'protect.changePassword', 'protect.changePassword', 37],
  ['tree.section', 'protect.unprotect', 'protect.unprotectSection', 38],
  ['tree.sectionGroup', 'tree.archive', 'tree.archive', 31],
  ['tree.sectionGroup', 'tree.unarchive', 'tree.unarchive', 32],
  ['tree.notebook', 'tree.createShortcut', 'notes.createShortcut', 29],
  ['tree.notebook', 'tree.checkNotebook', 'notes.checkNotebook', 30],
  ['tree.notebook', 'tree.archive', 'tree.archive', 31],
  ['tree.notebook', 'tree.unarchive', 'tree.unarchive', 32],
  ['tree.notebook', 'tree.deleteHistory', 'history.deleteNotebookHistory', 33],
  // The Sort button in the View tab opens this menu.
  ['tree.sort', 'sort.title', 'tree.sort.title', 1, 'sort'],
  ['tree.sort', 'sort.created', 'tree.sort.created', 2, 'sort'],
  ['tree.sort', 'sort.modified', 'tree.sort.modified', 3, 'sort'],
];

export function registerQolMenus(): void {
  for (const [menu, id, command, order, group] of MENU_ENTRIES) {
    contextMenus.register({ id: `${menu}.${id}`, menu, command: command as CommandId, group: group ?? 'qol', order });
  }
}
