// The save status in the title bar (ARCHITECTURE.md section 13): "Saved", "Saving", "Offline", or "Couldn't save".
// Only the trouble is announced, because the rest would chatter. In the compact layout it is an icon whose name
// is its text.

import { CloudCheckIcon } from '@phosphor-icons/react/dist/csr/CloudCheck';
import { CloudSlashIcon } from '@phosphor-icons/react/dist/csr/CloudSlash';
import { CloudArrowUpIcon } from '@phosphor-icons/react/dist/csr/CloudArrowUp';
import { CloudWarningIcon } from '@phosphor-icons/react/dist/csr/CloudWarning';
import { useEffect } from 'react';
import type { ComponentType } from 'react';
import type { SaveStatus as Status } from '../../services/notes';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce } from '../../ui';
import type { IconProps } from '../../ui';
import { treeStore } from './store';
import styles from './Tree.module.css';

const ICONS: Record<Status, ComponentType<IconProps>> = {
  saved: CloudCheckIcon,
  saving: CloudArrowUpIcon,
  offline: CloudSlashIcon,
  error: CloudWarningIcon,
};

export function SaveStatus({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const status = useStore(treeStore, (state) => state.saveStatus);
  useEffect(() => {
    if (status === 'error') announce(t('tree.save.errorAnnounce'), 'assertive');
  }, [status]);
  const Icon = ICONS[status];
  const text = t(`tree.save.${status}`);
  return (
    <span className={styles.saveStatus} data-status={status} title={presentation === 'icon' ? text : undefined}>
      <Icon aria-hidden />
      {presentation === 'icon' ? <span className={styles.visuallyHidden}>{text}</span> : <span>{text}</span>}
    </span>
  );
}
