// Settings, then Connectors: every account OpenNote can sign in to, in groups, with a search box. Everything is off
// until the person connects it. Connect opens the service's own sign-in page in their browser, and the card shows
// "Connected as" with their account when they finish. Work offline keeps Connect and Reconnect waiting, with a note.

import { useEffect, useId, useMemo, useState } from 'react';
import { commandContext } from '../../commands/registry';
import { t } from '../../strings/t';
import { announce, confirm, TextField } from '../../ui';
import { useOffline } from '../diagnostics';
import { ConnectorCard } from './ConnectorCard';
import styles from './Connectors.module.css';
import { filterConnectors, groupConnectors, groupName, SETUP_DOC } from './model';
import { cancelSignIn, connectTo, disconnectFrom, refreshConnectors, useConnectorState } from './runtime';
import type { ConnectorInfo } from './types';

const platform = () => commandContext('menu').platform;

const setUp = (info: ConnectorInfo) =>
  void platform()
    .shell.openExternal({ kind: 'link', url: `${SETUP_DOC}#${info.id}` })
    .catch(() => {});

const openFolder = () =>
  void platform()
    .shell.openExternal({ kind: 'folder', which: 'data' })
    .catch(() => {});

async function disconnect(info: ConnectorInfo): Promise<void> {
  const yes = await confirm({
    title: t('connectors.confirm.title', { name: info.name }),
    body: t('connectors.confirm.body', { name: info.name }),
    confirmLabel: t('connectors.confirm.confirm'),
    danger: true,
  });
  if (yes) await disconnectFrom(info.id);
}

export default function ConnectorsSection() {
  const { items, loaded, errors } = useConnectorState();
  const offline = useOffline();
  const [query, setQuery] = useState('');
  const baseId = useId();
  const noticeId = `${baseId}-offline`;
  useEffect(() => {
    void refreshConnectors();
  }, []);
  const visible = useMemo(() => filterConnectors(items, query), [items, query]);
  const groups = groupConnectors(visible);
  useEffect(() => {
    if (!query.trim() || !loaded) return;
    announce(visible.length === 0 ? t('connectors.noMatches') : t('connectors.resultCount', { count: visible.length }));
  }, [query, loaded, visible.length]);
  return (
    <div className={styles.page}>
      <p className={styles.help}>{t('connectors.intro')}</p>
      {offline && (
        <p id={noticeId} className={styles.notice} role="status">
          {t('connectors.offlineNotice')}
        </p>
      )}
      <TextField label={t('connectors.searchLabel')} value={query} onChange={setQuery} onCancel={() => setQuery('')} />
      {loaded && groups.length === 0 && <p role="status">{t('connectors.noMatches')}</p>}
      {groups.map(({ group, items: members }) => (
        <section key={group} className={styles.group} aria-labelledby={`${baseId}-${group}`}>
          <h2 id={`${baseId}-${group}`}>{groupName(group)}</h2>
          <ul className={styles.list} aria-label={groupName(group)}>
            {members.map((info) => (
              <ConnectorCard
                key={info.id}
                info={info}
                offline={offline}
                offlineNoticeId={noticeId}
                error={errors[info.id]}
                onConnect={(input) => connectTo(info.id, input)}
                onCancel={() => void cancelSignIn(info.id)}
                onDisconnect={() => void disconnect(info)}
                onSetup={() => setUp(info)}
                onOpenFolder={openFolder}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
