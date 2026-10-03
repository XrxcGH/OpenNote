// Context menus and menu buttons built from the contextMenus registry (ARCHITECTURE.md sections 13.8 and 15.3).
// Labels, shortcuts, enablement, and checked states come from the commands, as in the palette and the keymap.
//
// - Groups keep the order their first item registered, with a separator between them, and 'danger' always last.
// - Items hide when their flag or their command's flag is off, or when the command isn't available (`when`).
// - A command with a checked state is a checkbox item; a group whose every item has one is a radio group.
// - An item with submenu 'color' lists the chip colors and "No color", and runs its command with the color.

import { isEnabled, withEnabledFlags } from '../app/flags';
import { commands, contextMenus } from '../registries';
import type { ContextMenuItem, MenuId } from '../registries/types';
import type { ChipColor } from '../services/notes/types';
import { t } from '../strings/t';
import type { MenuItemSpec } from '../ui/Menu';
import type { AnyCommand } from './keymap';
import { shortcutHint } from './keymap';
import { tokens } from '../theme/tokens';
import { executeCommand } from './registry';
import type { CommandContext } from './types';

const DANGER = 'danger';
/** The chip colors in pen order, from the tokens, then "No color". */
const COLORS: readonly (ChipColor | null)[] = [
  ...tokens.ink.pens.map((pen) => pen.name.toLowerCase() as ChipColor),
  null,
];

function inGroupOrder(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const groups = [...new Set(items.map((item) => item.group))];
  const rank = (group: string) => (group === DANGER ? groups.length : groups.indexOf(group));
  return [...items].sort((a, b) => rank(a.group) - rank(b.group) || a.order - b.order);
}

function available(def: AnyCommand | undefined, ctx: CommandContext): def is AnyCommand {
  return def !== undefined && (!def.flag || isEnabled(def.flag)) && (!def.when || def.when(ctx));
}

function colorMenu(item: ContextMenuItem, def: AnyCommand, ctx: CommandContext): MenuItemSpec[] {
  const base = typeof item.args === 'object' && item.args !== null ? item.args : {};
  return COLORS.map((color) => ({
    id: `${item.id}.${color ?? 'none'}`,
    label: t(color ? `commands.colors.${color}` : 'commands.colors.none'),
    kind: 'radio',
    checked: false,
    onSelect: () => void executeCommand(def.id, { ...base, color }, 'menu', ctx.target),
  }));
}

function specFor(item: ContextMenuItem, def: AnyCommand, ctx: CommandContext, radio: boolean): MenuItemSpec {
  const checked = def.checked?.(ctx);
  return {
    id: item.id,
    label: t(def.title),
    shortcut: shortcutHint(def.id) ?? undefined,
    kind: checked === undefined ? 'item' : radio ? 'radio' : 'checkbox',
    checked,
    disabled: def.enabled ? !def.enabled(ctx) : false,
    danger: item.group === DANGER,
    submenu: item.submenu === 'color' ? colorMenu(item, def, ctx) : undefined,
    onSelect: item.submenu ? undefined : () => void executeCommand(def.id, item.args, 'menu', ctx.target),
  };
}

/** The menu's items for this context, in order, ready for openMenu. */
export function menuItemsFor(menu: MenuId, ctx: CommandContext): MenuItemSpec[] {
  const items = inGroupOrder(withEnabledFlags(contextMenus.list().filter((item) => item.menu === menu)))
    .map((item) => ({ item, def: commands.get(item.command) }))
    .filter((entry): entry is { item: ContextMenuItem; def: AnyCommand } => available(entry.def, ctx));
  const radioGroups = new Set(
    [...new Set(items.map(({ item }) => item.group))].filter((group) => {
      const members = items.filter(({ item }) => item.group === group);
      return members.length > 1 && members.every(({ def }) => def.checked);
    }),
  );
  return items.map(({ item, def }, i) => ({
    ...specFor(item, def, ctx, radioGroups.has(item.group)),
    separatorBefore: i > 0 && items[i - 1].item.group !== item.group,
  }));
}
