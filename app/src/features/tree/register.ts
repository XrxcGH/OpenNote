// Registers the tree's commands, its context menus (ARCHITECTURE.md section 13.8), the Home tab's tools, the save
// status, the palette's "Go to" results, and the hook that saves the notes before the window closes.

import type { FlagId } from '../../app/flags';
import type { CommandId } from '../../commands/types';
import { beforeExit, commandBar, commands, contextMenus, paletteProviders, titleBarItems } from '../../registries';
import type { MenuId } from '../../registries/types';
import { currentNotesService } from '../../services/notes';
import { treeCommands } from './commands';
import { nodeProvider } from './palette';
import { SaveStatus } from './SaveStatus';

for (const def of treeCommands) commands.register(def);

type Entry = readonly [command: CommandId, group: string, flag?: FlagId];

/** Items in the order of the design's table. Delete comes last, in its own group, after a separator. */
const MENUS: Partial<Record<MenuId, readonly Entry[]>> = {
  'tree.notebook': [
    ['notes.newSection', 'new'],
    ['notes.newSectionGroup', 'new'],
    ['tree.rename', 'edit'],
    ['tree.color', 'edit'],
    ['tree.moveUp', 'move'],
    ['tree.moveDown', 'move'],
    ['tree.trash', 'danger'],
  ],
  'tree.sectionGroup': [
    ['notes.newSection', 'new'],
    ['notes.newSectionGroup', 'new'],
    ['tree.rename', 'edit'],
    ['tree.color', 'edit'],
    ['tree.moveUp', 'move'],
    ['tree.moveDown', 'move'],
    ['tree.moveTo', 'move'],
    ['tree.trash', 'danger'],
  ],
  'tree.section': [
    ['notes.newPage', 'new'],
    ['tree.rename', 'edit'],
    ['tree.color', 'edit'],
    ['tree.moveUp', 'move'],
    ['tree.moveDown', 'move'],
    ['tree.moveTo', 'move'],
    ['tree.trash', 'danger'],
  ],
  'tree.page': [
    ['notes.newPage', 'new'],
    ['notes.newSubpage', 'new'],
    ['pages.indent', 'level'],
    ['pages.outdent', 'level'],
    ['tree.rename', 'edit'],
    ['tree.moveUp', 'move'],
    ['tree.moveDown', 'move'],
    ['tree.moveTo', 'move'],
    ['tree.trash', 'danger'],
  ],
  'trash.item': [['trash.restore', 'restore', 'trash.view']],
};

for (const [menu, entries] of Object.entries(MENUS) as [MenuId, readonly Entry[]][]) {
  entries.forEach(([command, group, flag], index) => {
    const isColor = command === 'tree.color';
    contextMenus.register({
      id: `${menu}.${command.split('.')[1]}`,
      menu,
      command,
      group,
      order: index,
      ...(isColor && { submenu: 'color' as const }),
      ...(flag && { flag }),
    });
  });
}

const HOME: readonly (readonly [CommandId, number])[] = [
  ['notes.newPage', 100],
  ['notes.newSection', 90],
  ['notes.newNotebook', 80],
  ['edit.undo', 70],
];

for (const [command, priority] of HOME) {
  commandBar.register({
    id: `home.${command}`,
    tab: 'home',
    group: command === 'edit.undo' ? 'edit' : 'new',
    command,
    priority,
  });
}

titleBarItems.register({
  id: 'notes.saveStatus',
  side: 'end',
  order: 10,
  priority: 20,
  compact: 'hide',
  Component: SaveStatus,
});

paletteProviders.register(nodeProvider);

beforeExit.register({
  id: 'notes.flush',
  order: 10,
  async run() {
    const notes = currentNotesService();
    if (!notes) return { ok: true as const };
    await notes.flush().catch(() => {});
    return notes.hasUnsavedChanges()
      ? { ok: false as const, reason: 'tree.exit.unsaved' as const }
      : { ok: true as const };
  },
});
