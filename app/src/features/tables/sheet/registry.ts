// What the spreadsheet lanes add to a table (ADR 0056): commands, menu items, toolbar groups, and context menu
// entries. Each lane registers its own from a `contribute.ts` in its own folder under features/tables/sheet/,
// which sheet/index.ts imports, so no lane edits another's file or a shared list. Commands go to the one command
// registry (ADR 0046). Context menu entries go to the table's context menu. So the palette, menus, and keys see
// them as they see every other command.
import type { CommandDef } from '../../../commands/types';
import { commands, contextMenus, createRegistry } from '../../../registries';
import type { ContextMenuItem, Registry } from '../../../registries';
import type { FlagId } from '../../../app/flags';
import type { MessageKey } from '../../../strings/t';

/** The lanes of the spreadsheet program (ADR 0056), so every item names the lane that owns it. */
export const SHEET_LANES = [
  'sheet-model',
  'engine-values',
  'engine-eval',
  'numfmt',
  'fn-math',
  'fn-logic-info',
  'fn-text',
  'fn-datetime',
  'fn-lookup',
  'keys',
  'render',
  'toolbar',
  'formula-bar',
  'structure',
  'sheet-integration',
  'doc-exports',
  'merge',
  'format-dialog',
  'fn-stats',
  'fn-finance',
  'fn-arrays',
  'data-tools',
  'validation',
  'conditional',
  'clipboard',
  'xlsx-export',
  'pointer',
  'perf-virtualization',
  'xlsx-import',
  'fn-engineering',
  'fn-database',
  'cross-page',
  'what-if',
  'sparklines',
  'notes',
  'pivot',
  'table-merge-sync',
  'protection',
  'ods-export',
  'help-docs',
] as const;
export type SheetLane = (typeof SHEET_LANES)[number];

/** The menus of a table's ribbon tab, in the order they show. */
export const SHEET_MENUS = ['insert', 'format', 'data', 'review', 'tools'] as const;
export type SheetMenu = (typeof SHEET_MENUS)[number];

/** An item of one of the sheet's menus: the command it runs, its group in the menu, and its place in the group. */
export interface SheetMenuItem {
  id: string;
  lane: SheetLane;
  menu: SheetMenu;
  command: string;
  group: string;
  order: number;
  flag?: FlagId;
}

/** A group of the table's toolbar: its label, its place, and the commands it shows, in order. */
export interface SheetToolbarGroup {
  id: string;
  lane: SheetLane;
  label: MessageKey;
  order: number;
  commands: readonly string[];
  flag?: FlagId;
}

/** One thing a lane adds. */
export type SheetContribution =
  // Commands take different argument types, as in the command registry.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'command'; lane: SheetLane; command: CommandDef<any> }
  | { kind: 'menuItem'; item: SheetMenuItem }
  | { kind: 'toolbarGroup'; group: SheetToolbarGroup }
  | { kind: 'contextMenu'; lane: SheetLane; item: Omit<ContextMenuItem, 'menu'> };

export const sheetMenuItems: Registry<SheetMenuItem> = createRegistry<SheetMenuItem>('sheet menu items');
export const sheetToolbarGroups: Registry<SheetToolbarGroup> =
  createRegistry<SheetToolbarGroup>('sheet toolbar groups');

/** The menu a table's context menu entries go in (features/page/tables/commands.ts). */
export const SHEET_CONTEXT_MENU = 'page.table';

/** Adds what a lane contributes. Throws on an ID already taken. Returns a function that takes it all back. */
export function contribute(...items: readonly SheetContribution[]): () => void {
  const undo: (() => void)[] = [];
  try {
    for (const item of items) {
      if (item.kind === 'command') undo.push(commands.register(item.command));
      else if (item.kind === 'menuItem') undo.push(sheetMenuItems.register(item.item));
      else if (item.kind === 'toolbarGroup') undo.push(sheetToolbarGroups.register(item.group));
      else undo.push(contextMenus.register({ ...item.item, menu: SHEET_CONTEXT_MENU }));
    }
  } catch (error) {
    undo.reverse().forEach((take) => take());
    throw error;
  }
  return () => undo.reverse().forEach((take) => take());
}

const byPlace = <T extends { id: string; order: number }>(a: T, b: T) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A menu's items, by group as the lanes named them, then by place. */
export function sheetMenu(menu: SheetMenu): SheetMenuItem[] {
  const items = sheetMenuItems.list().filter((item) => item.menu === menu);
  return items.sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : byPlace(a, b)));
}

/** The toolbar's groups, in order. */
export function sheetToolbar(): SheetToolbarGroup[] {
  return [...sheetToolbarGroups.list()].sort(byPlace);
}
