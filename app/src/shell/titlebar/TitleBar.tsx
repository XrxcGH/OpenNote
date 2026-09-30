// The title bar: the app name, then the items features register, in order on each side. WP5 adds the drag area,
// the caption buttons, overflow by priority, the breadcrumb, and the compact app bar.

import { useRegistry, titleBarItems } from '../../registries';
import type { TitleBarItemDef } from '../../registries/types';
import { t } from '../../strings/t';
import { useRegion } from '../regions';
import styles from './TitleBar.module.css';

const bySide = (items: readonly TitleBarItemDef[], side: TitleBarItemDef['side']) =>
  items.filter((item) => item.side === side).sort((a, b) => a.order - b.order);

export function TitleBar() {
  const items = useRegistry(titleBarItems);
  const region = useRegion('titleBar');
  return (
    <header className={styles.titleBar} {...region}>
      <span className={styles.appName}>{t('common.appName')}</span>
      {bySide(items, 'start').map(({ id, Component }) => (
        <Component key={id} presentation="full" />
      ))}
      <span className={styles.spacer} />
      {bySide(items, 'end').map(({ id, Component }) => (
        <Component key={id} presentation="full" />
      ))}
    </header>
  );
}

/** The compact layout's app bar. WP0 has no compact layout, so it renders nothing. */
export function AppBar() {
  return null;
}
