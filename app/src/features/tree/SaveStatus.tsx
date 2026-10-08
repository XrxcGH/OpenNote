// The save status in the title bar (ARCHITECTURE.md section 13): "Saved", "Saving", "Offline", "Couldn't save",
// or "Not responding" while a command holds the core. Only the trouble is announced, because the rest would
// chatter. In the compact layout it is an icon whose name is its text.

import { CloudCheckIcon } from '@phosphor-icons/react/dist/csr/CloudCheck';
import { CloudSlashIcon } from '@phosphor-icons/react/dist/csr/CloudSlash';
import { CloudArrowUpIcon } from '@phosphor-icons/react/dist/csr/CloudArrowUp';
import { CloudWarningIcon } from '@phosphor-icons/react/dist/csr/CloudWarning';
import { CloudXIcon } from '@phosphor-icons/react/dist/csr/CloudX';
import { useEffect } from 'react';
import type { ComponentType } from 'react';
import type { SaveStatus as Status } from '../../services/notes';
import { anySaveFailing, combinedStatus, coreStalled, saveHealthStore } from '../../services/pages/saveHealth';
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
  stalled: CloudXIcon,
};

export function SaveStatus({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const notes = useStore(treeStore, (state) => state.saveStatus);
  const pageFailing = useStore(saveHealthStore, anySaveFailing);
  const stalled = useStore(saveHealthStore, coreStalled);
  const status = combinedStatus(notes, pageFailing, stalled);
  useEffect(() => {
    if (status === 'error') announce(t('tree.save.errorAnnounce'), 'assertive');
    if (status === 'stalled') announce(t('tree.save.stalledAnnounce'), 'assertive');
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
