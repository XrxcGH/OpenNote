// Context menus built from the contextMenus registry (ARCHITECTURE.md section 13.8), so labels, shortcuts, and
// enablement stay in step with the palette. Items come in group order, a separator between groups, and the
// 'danger' group always last. WP7 owns the full version.

import { withEnabledFlags } from '../app/flags';
import { commands, contextMenus } from '../registries';
import type { ContextMenuItem, MenuId } from '../registries/types';
import { t } from '../strings/t';
import type { MenuItemSpec } from '../ui/Menu';
import { shortcutHint } from './keymap';
import { executeCommand } from './registry';
import type { CommandContext } from './types';

function sorted(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const groups = [...new Set(items.map((item) => item.group))].sort((a, b) =>
    a === 'danger' ? 1 : b === 'danger' ? -1 : 0,
  );
  return [...items].sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.order - b.order);
}

export function menuItemsFor(menu: MenuId, ctx: CommandContext): MenuItemSpec[] {
  const items = sorted(withEnabledFlags(contextMenus.list().filter((item) => item.menu === menu)));
  const specs: MenuItemSpec[] = [];
  let group: string | null = null;
  for (const item of items) {
    const def = commands.get(item.command);
    if (!def || (def.flag && !withEnabledFlags([def]).length) || (def.when && !def.when(ctx))) continue;
    specs.push({
      id: item.id,
      label: t(def.title),
      shortcut: shortcutHint(def.id) ?? undefined,
      kind: def.checked ? 'checkbox' : 'item',
      checked: def.checked?.(ctx),
      disabled: def.enabled ? !def.enabled(ctx) : false,
      danger: item.group === 'danger',
      separatorBefore: group !== null && item.group !== group,
      onSelect: () => void executeCommand(def.id, item.args, 'menu', ctx.target),
    });
    group = item.group;
  }
  return specs;
}
