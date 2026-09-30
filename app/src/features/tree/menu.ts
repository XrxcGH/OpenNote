// The rows' context menus (ARCHITECTURE.md section 13.8), built from the contextMenus registry so labels,
// shortcuts, and enablement stay in step with the palette. The Color item gets its submenu here: the seven pen
// names as radio items with a swatch, plus "No color".

import { createElement } from 'react';
import type { ComponentType } from 'react';
import { menuItemsFor } from '../../commands/menus';
import { commandContext, executeCommand } from '../../commands/registry';
import type { MenuId } from '../../registries/types';
import { CHIP_COLORS } from '../../services/notes';
import type { ChipColor, NodeKind, NodeSummary } from '../../services/notes';
import { t } from '../../strings/t';
import { openMenu } from '../../ui';
import type { IconProps, MenuAnchor, MenuItemSpec } from '../../ui';
import { titleOf } from './actions';
import styles from './Tree.module.css';

export const ROW_MENUS: Record<NodeKind, MenuId> = {
  notebook: 'tree.notebook',
  sectionGroup: 'tree.sectionGroup',
  section: 'tree.section',
  page: 'tree.page',
};

/** The context menu item ids that carry the Color submenu end with this. */
export const COLOR_ITEM = '.color';

function swatch(color: ChipColor | null): ComponentType<IconProps> {
  const Swatch = () =>
    createElement('span', {
      'aria-hidden': 'true',
      className: `${styles.chip} ${styles.dot}`,
      'data-color': color ?? 'none',
    });
  Swatch.displayName = `Swatch(${color ?? 'none'})`;
  return Swatch;
}

const SWATCHES = new Map<ChipColor | null, ComponentType<IconProps>>(
  [...CHIP_COLORS, null].map((color) => [color, swatch(color)]),
);

/** The Color submenu for a row. */
export function colorItems(node: NodeSummary): MenuItemSpec[] {
  const target = { kind: 'node', id: node.id } as const;
  return [...CHIP_COLORS, null].map((color) => ({
    id: `color.${color ?? 'none'}`,
    label: t(`tree.colors.${color ?? 'none'}`),
    icon: SWATCHES.get(color),
    kind: 'radio' as const,
    checked: node.color === color,
    separatorBefore: color === null,
    onSelect: () => void executeCommand('tree.color', { color }, 'menu', target),
  }));
}

function withColors(items: MenuItemSpec[], node: NodeSummary, anchor: MenuAnchor, returnFocus: HTMLElement) {
  return items.map((item) => {
    if (!item.id.endsWith(COLOR_ITEM) || item.submenu) return item;
    const submenu = colorItems(node);
    const label = t('tree.colors.menu');
    return { ...item, submenu, onSelect: () => void openMenu({ label, items: submenu, anchor, returnFocus }) };
  });
}

/** The menu for a row, or null when nothing applies. */
export function rowMenu(node: NodeSummary, anchor: MenuAnchor, returnFocus: HTMLElement) {
  const ctx = commandContext('menu', { kind: 'node', id: node.id });
  const items = withColors(menuItemsFor(ROW_MENUS[node.kind], ctx), node, anchor, returnFocus);
  return items.length ? { label: t('tree.menu.label', { title: titleOf(node) }), items } : null;
}

/** Opens a row's context menu at the pointer, or at the row for the keyboard and the "More actions" button. */
export function openRowMenu(node: NodeSummary, anchor: MenuAnchor, returnFocus: HTMLElement): void {
  const menu = rowMenu(node, anchor, returnFocus);
  if (menu) void openMenu({ ...menu, anchor, returnFocus });
}
