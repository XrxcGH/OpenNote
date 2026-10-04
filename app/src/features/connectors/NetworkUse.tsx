// The connectors' row in Settings, then Privacy: which servers OpenNote talks to for each account, and when it last
// did. Nothing is contacted until the person connects, so an account that is not connected says so.

import { useEffect } from 'react';
import { formatDate } from '../../strings/format';
import { t } from '../../strings/t';
import { useOffline } from '../diagnostics';
import styles from './Connectors.module.css';
import { hostList } from './model';
import { refreshConnectors, useConnectorState } from './runtime';
import type { ConnectorInfo } from './types';

function line(info: ConnectorInfo): string {
  if (info.state.kind !== 'connected' && info.state.kind !== 'expired') {
    return t('connectors.privacy.off', { name: info.name });
  }
  const used =
    info.lastUsedUnix === null
      ? t('connectors.privacy.neverUsed')
      : t('connectors.privacy.lastUsed', { date: formatDate(new Date(info.lastUsedUnix * 1000).toISOString()) });
  return `${t('connectors.privacy.hostsLine', { name: info.name, hosts: hostList(info.hosts) })} ${used}`;
}

export function ConnectorNetworkUse() {
  const offline = useOffline();
  const { items } = useConnectorState();
  useEffect(() => {
    void refreshConnectors();
  }, []);
  if (items.length === 0) return null;
  return (
    <li className={styles.useRow}>
      <span className={styles.useTitle}>{t('connectors.privacy.heading')}</span>
      <span>{t('connectors.privacy.detail')}</span>
      <ul className={styles.useList}>
        {items.map((info) => (
          <li key={info.id}>{line(info)}</li>
        ))}
      </ul>
      <span className={styles.help}>{offline ? t('connectors.privacy.blocked') : t('connectors.privacy.ready')}</span>
    </li>
  );
}
