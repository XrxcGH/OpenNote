// The object menu (ARCHITECTURE.md sections 11.3, 11.6, and 11.7; owner WP3): right-click, a long press, the
// barrel button, Shift+F10, or the Menu key on a selected block. Every drag on the page has a menu or field
// alternative here, and z-order items at an end say why they are off ("Already in front").
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import { openMenu } from '../../../ui';
import type { MenuAnchor, MenuItemSpec } from '../../../ui';
import type { ObjectCommand, Objects } from '../objects/objects';

const ITEMS: readonly { id: ObjectCommand; label: MessageKey; off?: MessageKey; separatorBefore?: boolean }[] = [
  { id: 'edit', label: 'page.object.edit' },
  { id: 'bringToFront', label: 'page.object.bringToFront', off: 'page.object.alreadyFront', separatorBefore: true },
  { id: 'bringForward', label: 'page.object.bringForward', off: 'page.object.alreadyFront' },
  { id: 'sendBackward', label: 'page.object.sendBackward', off: 'page.object.alreadyBack' },
  { id: 'sendToBack', label: 'page.object.sendToBack', off: 'page.object.alreadyBack' },
  { id: 'float', label: 'page.object.float', separatorBefore: true },
  { id: 'putInFlow', label: 'page.object.putInFlow' },
  { id: 'sizeAndPosition', label: 'page.object.sizeAndPosition' },
  { id: 'lockPosition', label: 'page.object.lockPosition', separatorBefore: true },
  { id: 'lock', label: 'page.object.lock' },
  { id: 'unlock', label: 'page.object.unlock' },
  { id: 'delete', label: 'page.object.delete', separatorBefore: true },
];

/** The menu's items for the current selection; items that don't apply are left out or say why they are off. */
export function objectMenuItems(objects: Objects): MenuItemSpec[] {
  return ITEMS.flatMap(({ id, label, off, separatorBefore }) => {
    const enabled = objects.enabled(id);
    if (!enabled && !off) return [];
    const item: MenuItemSpec = { id, label: t(enabled || !off ? label : off), disabled: !enabled };
    if (separatorBefore) item.separatorBefore = true;
    if (id === 'delete') item.danger = true;
    return [item];
  });
}

export async function openObjectMenu(objects: Objects, anchor: MenuAnchor): Promise<void> {
  const chosen = await openMenu({ label: t('page.object.menuLabel'), items: objectMenuItems(objects), anchor });
  if (chosen) objects.command(chosen as ObjectCommand);
}
