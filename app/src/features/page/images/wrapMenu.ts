// The Text wrap menu of a selected image: stand alone, in line, or left or right with the text wrapping around it.
import { t } from '../../../strings/t';
import { openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import type { ImageHandle } from '../blocks/imageBlock';
import { WRAPS } from './wrap';

/** Whether the image can wrap: the feature is on, the image flows, and the page is not in the Reading view. */
export function canWrap(handle: ImageHandle): boolean {
  return handle.ctx.host.flag('page.wrapImages') && !handle.floating() && !handle.ctx.reading;
}

export async function openWrapMenu(handle: ImageHandle, anchor: HTMLElement): Promise<void> {
  const current = handle.wrap();
  const items: MenuItemSpec[] = WRAPS.map((mode) => ({
    id: mode,
    label: t(`pageExtras.wrap.${mode}`),
    kind: 'radio',
    checked: mode === current,
    onSelect: () => handle.setWrap(mode),
  }));
  await openMenu({ label: t('pageExtras.wrap.menu'), items, anchor, returnFocus: handle.element });
}
