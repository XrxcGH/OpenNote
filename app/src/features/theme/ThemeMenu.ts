// The theme menu (ARCHITECTURE.md section 9.3): Light, Dark, and Match Windows as menuitemradio items with the
// current one checked, a separator, and "Appearance settings". The items come from the contextMenus registry
// under 'theme.choices', so their commands, enablement, and shortcuts match the palette.

import { menuItemsFor } from '../../commands/menus';
import { commandContext } from '../../commands/registry';
import { topLayer } from '../../state/layers';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { openMenu } from '../../ui';
import type { MenuAnchor, MenuItemSpec } from '../../ui';

/** The menu items this feature registers, with their shorter menu labels. Radio items are the three choices. */
export const THEME_MENU_ITEMS: Readonly<Record<string, { label: MessageKey; radio: boolean }>> = {
  'theme.light': { label: 'theme.choices.light', radio: true },
  'theme.dark': { label: 'theme.choices.dark', radio: true },
  'theme.system': { label: 'theme.choices.system', radio: true },
  'theme.openAppearance': { label: 'theme.menu.appearance', radio: false },
};

/** The menu's items now, with the choices as radio items. Items other features add keep their own labels. */
export function themeMenuItems(): MenuItemSpec[] {
  return menuItemsFor('theme.choices', commandContext('menu')).map((item) => {
    const own = THEME_MENU_ITEMS[item.id];
    if (!own) return item;
    return { ...item, label: t(own.label), kind: own.radio ? 'radio' : 'item', checked: own.radio && item.checked };
  });
}

/** Opens the theme menu at an element or a point, and returns focus to `returnFocus` when it closes. */
export function openThemeMenu(anchor: MenuAnchor, returnFocus: HTMLElement | null): void {
  if (topLayer()?.kind === 'menu') return;
  void openMenu({ label: t('theme.menu.label'), items: themeMenuItems(), anchor, returnFocus });
}
