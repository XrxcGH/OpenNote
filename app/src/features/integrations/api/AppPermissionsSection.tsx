// Settings, then App permissions (beside Privacy).
// It shows whether apps on this PC may connect at all, and each connected app with what it may do and Revoke.
// It also has a pairing code for the web clipper and the mail add-ins, the MCP config for an AI assistant,
// outgoing webhooks, and the access log.
// Nothing here ever shows a token or a secret.

import { useCallback, useEffect, useId, useState } from 'react';
import { formatDate, formatTime } from '../../../strings/format';
import { t } from '../../../strings/t';
import { announce, Button, confirm, Switch } from '../../../ui';
import styles from './AppPermissions.module.css';
import { errorCode, apiHost } from './host';
import { ScopePicker, useNotebookChoices } from './ScopePicker';
import type { NotebookChoice } from './ScopePicker';
import type { Access, ApiStatus, AppGrant, LogEntry, PairCode } from './types';
import { WebhooksPanel } from './WebhooksPanel';

const iso = (ms: number) => new Date(ms).toISOString();

function useApiData() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [apps, setApps] = useState<AppGrant[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const refresh = useCallback((what: 'all' | 'grants' | 'log' | 'status' = 'all') => {
    const host = apiHost();
    const loads: Promise<unknown>[] = [];
    if (what === 'all' || what === 'status') loads.push(host.call<ApiStatus>('status').then(setStatus));
    if (what === 'all' || what === 'grants')
      loads.push(host.call<AppGrant[]>('apps').then((list) => setApps(list ?? [])));
    if (what === 'all' || what === 'log') {
      loads.push(host.call<LogEntry[]>('log', { limit: 200 }).then((list) => setLog(list ?? [])));
    }
    return Promise.all(loads).then(() => undefined);
  }, []);
  useEffect(() => {
    const host = apiHost();
    void Promise.all([
      host.call<ApiStatus>('status').then(setStatus),
      host.call<AppGrant[]>('apps').then((list) => setApps(list ?? [])),
      host.call<LogEntry[]>('log', { limit: 200 }).then((list) => setLog(list ?? [])),
    ]).catch(() => {});
    return host.listen((event) => {
      if (event.kind === 'changed' && event.what !== 'webhooks') void refresh(event.what).catch(() => {});
    });
  }, [refresh]);
  return { status, apps, log, refresh };
}

export default function AppPermissionsSection() {
  const { status, apps, log, refresh } = useApiData();
  const notebooks = useNotebookChoices();
  const noteId = useId();
  if (status && !status.available) {
    return (
      <div className={styles.page}>
        <p className={styles.help}>{t('platformApi.unavailable')}</p>
      </div>
    );
  }
  const setEnabled = async (enabled: boolean) => {
    await apiHost().call('setEnabled', { enabled });
    await refresh('status');
  };
  return (
    <div className={styles.page}>
      <p className={styles.help}>{t('platformApi.intro')}</p>
      <div className={styles.row}>
        <Switch
          label={t('platformApi.enable')}
          checked={status?.enabled ?? false}
          describedBy={noteId}
          onChange={(next) => void setEnabled(next)}
        />
      </div>
      <p id={noteId} className={styles.help}>
        {t('platformApi.enableNote')}{' '}
        <span role="status">{status?.running ? t('platformApi.running') : t('platformApi.stopped')}</span>
      </p>
      <AppsList apps={apps} notebooks={notebooks} onChanged={() => void refresh('grants')} />
      <PairPanel running={Boolean(status?.running)} />
      <CliPanel />
      <McpPanel />
      <WebhooksPanel notebooks={notebooks} />
      <LogPanel log={log} onCleared={() => void refresh('log')} />
    </div>
  );
}

function AppsList(props: { apps: AppGrant[]; notebooks: readonly NotebookChoice[]; onChanged(): void }) {
  const { apps, notebooks, onChanged } = props;
  const headingId = useId();
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('platformApi.apps.heading')}</h2>
      {apps.length === 0 ? (
        <p className={styles.help}>{t('platformApi.apps.empty')}</p>
      ) : (
        <ul className={styles.list} aria-labelledby={headingId}>
          {apps.map((app) => (
            <AppCard key={app.id} app={app} notebooks={notebooks} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AppCard(props: { app: AppGrant; notebooks: readonly NotebookChoice[]; onChanged(): void }) {
  const { app, notebooks, onChanged } = props;
  const titleId = useId();
  const save = async (change: Partial<Pick<AppGrant, 'access' | 'notebooks' | 'askBeforeWrites'>>) => {
    await apiHost().call('updateApp', {
      id: app.id,
      access: change.access ?? app.access,
      notebooks: change.notebooks ?? app.notebooks,
      askBeforeWrites: change.askBeforeWrites ?? app.askBeforeWrites,
    });
    announce(t('platformApi.apps.saved'));
    onChanged();
  };
  const revoke = async () => {
    const yes = await confirm({
      title: t('platformApi.apps.revokeTitle', { name: app.name }),
      body: t('platformApi.apps.revokeBody', { name: app.name }),
      confirmLabel: t('platformApi.apps.revoke'),
      danger: true,
    });
    if (!yes) return;
    await apiHost().call('revoke', { id: app.id });
    announce(t('platformApi.apps.revoked', { name: app.name }));
    onChanged();
  };
  // A clipper or a mail add-in only adds pages; an app or the tool reads, and may also add.
  const choices: Access[] = app.kind === 'clipper' || app.kind === 'mail' ? ['addPages'] : ['read', 'readWrite'];
  return (
    <li>
      <article className={styles.card} aria-labelledby={titleId}>
        <div className={styles.head}>
          <h3 id={titleId}>{app.name}</h3>
          <span className={styles.meta}>{t(`platformApi.apps.kind.${app.kind}`)}</span>
        </div>
        <p className={styles.meta}>
          {t('platformApi.apps.connected', { date: formatDate(iso(app.created * 1000)) })}
          {' · '}
          {app.lastUsed
            ? t('platformApi.apps.lastUsed', { date: formatDate(iso(app.lastUsed * 1000)) })
            : t('platformApi.apps.neverUsed')}
        </p>
        <label className={styles.field}>
          <span>{t('platformApi.apps.access.label')}</span>
          <select value={app.access} onChange={(event) => void save({ access: event.target.value as Access })}>
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {t(`platformApi.apps.access.${choice}`)}
              </option>
            ))}
          </select>
        </label>
        <ScopePicker
          legend={t('platformApi.apps.notebooks.label')}
          value={app.notebooks}
          notebooks={notebooks}
          onChange={(next) => void save({ notebooks: next })}
        />
        {app.access !== 'read' && (
          <Switch
            label={t('platformApi.apps.ask')}
            checked={app.askBeforeWrites}
            onChange={(next) => void save({ askBeforeWrites: next })}
          />
        )}
        <div className={styles.actions}>
          <Button
            variant="danger"
            aria-label={t('platformApi.apps.revokeLabel', { name: app.name })}
            onClick={() => void revoke()}
          >
            {t('platformApi.apps.revoke')}
          </Button>
        </div>
      </article>
    </li>
  );
}

function PairPanel({ running }: { running: boolean }) {
  const [code, setCode] = useState<PairCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const make = async () => {
    setError(null);
    try {
      setCode(await apiHost().call<PairCode>('pairCode', { access: 'addPages', notebooks: { kind: 'all' } }));
    } catch (failure) {
      setError(errorCode(failure) === 'notRunning' ? t('platformApi.pair.notRunning') : String(failure));
    }
  };
  const cancel = async () => {
    await apiHost().call('cancelCode');
    setCode(null);
  };
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('platformApi.pair.heading')}</h2>
      <p className={styles.help}>{t('platformApi.pair.help')}</p>
      {code ? (
        <div className={styles.code} role="status">
          <p className={styles.codeText}>{t('platformApi.pair.code', { code: code.code })}</p>
          <p className={styles.meta}>
            {t('platformApi.pair.port', { port: code.port })}
            {' · '}
            {t('platformApi.pair.expires', { time: formatTime(iso(code.expiresAt)) })}
          </p>
          <Button variant="secondary" onClick={() => void cancel()}>
            {t('platformApi.pair.cancel')}
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" disabled={!running} onClick={() => void make()}>
            {t('platformApi.pair.make')}
          </Button>
        </div>
      )}
      {!running && <p className={styles.note}>{t('platformApi.pair.notRunning')}</p>}
      {error && (
        <p className={styles.note} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function CliPanel() {
  const headingId = useId();
  const noteId = useId();
  const [cli, setCli] = useState<{ installed: boolean; onPath: boolean; folder: string } | null>(null);
  useEffect(() => {
    void apiHost()
      .call<{ installed: boolean; onPath: boolean; folder: string }>('cliStatus')
      .then(setCli)
      .catch(() => {});
  }, []);
  const setPath = async (on: boolean) => {
    setCli(await apiHost().call('setCliPath', { on }));
  };
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('platformApi.cli.heading')}</h2>
      <p className={styles.help}>{t('platformApi.cli.help')}</p>
      {cli?.installed ? (
        <>
          <p className={styles.meta}>{t('platformApi.cli.installed', { folder: cli.folder })}</p>
          <Switch
            label={t('platformApi.cli.path')}
            checked={cli.onPath}
            describedBy={noteId}
            onChange={(on) => void setPath(on)}
          />
          <p id={noteId} className={styles.note}>
            {t('platformApi.cli.pathNote')}
          </p>
        </>
      ) : (
        <p className={styles.note}>{t('platformApi.cli.missing')}</p>
      )}
    </section>
  );
}

function McpPanel() {
  const headingId = useId();
  const [missing, setMissing] = useState(false);
  const copy = async () => {
    const { config, toolInstalled } = await apiHost().call<{ config: string; toolInstalled: boolean }>('mcpConfig');
    setMissing(!toolInstalled);
    try {
      await navigator.clipboard.writeText(config);
      announce(t('platformApi.mcp.copied'));
    } catch {
      // The clipboard can refuse while the window is in the background; the person can press again.
    }
  };
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('platformApi.mcp.heading')}</h2>
      <p className={styles.help}>{t('platformApi.mcp.help')}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void copy()}>
          {t('platformApi.mcp.copy')}
        </Button>
      </div>
      {missing && <p className={styles.note}>{t('platformApi.mcp.missing')}</p>}
    </section>
  );
}

function LogPanel({ log, onCleared }: { log: LogEntry[]; onCleared(): void }) {
  const headingId = useId();
  const clear = async () => {
    const yes = await confirm({
      title: t('platformApi.log.clearTitle'),
      body: t('platformApi.log.clearBody'),
      confirmLabel: t('platformApi.log.clear'),
    });
    if (!yes) return;
    await apiHost().call('clearLog');
    announce(t('platformApi.log.cleared'));
    onCleared();
  };
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('platformApi.log.heading')}</h2>
      <p className={styles.help}>{t('platformApi.log.help')}</p>
      {log.length === 0 ? (
        <p className={styles.help}>{t('platformApi.log.empty')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-labelledby={headingId}>
            <thead>
              <tr>
                <th scope="col">{t('platformApi.log.columns.time')}</th>
                <th scope="col">{t('platformApi.log.columns.app')}</th>
                <th scope="col">{t('platformApi.log.columns.action')}</th>
                <th scope="col">{t('platformApi.log.columns.target')}</th>
                <th scope="col">{t('platformApi.log.columns.outcome')}</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry, index) => (
                <tr key={`${entry.time}-${index}`}>
                  <td>
                    {formatDate(iso(entry.time))} {formatTime(iso(entry.time))}
                  </td>
                  <td>{entry.name || (entry.app === '-' ? t('platformApi.log.unknownApp') : entry.app)}</td>
                  <td>{entry.action}</td>
                  <td>{entry.title ?? ''}</td>
                  <td data-outcome={entry.outcome}>
                    {t(`platformApi.log.outcome.${entry.outcome}`)}
                    {entry.detail ? ` (${entry.detail})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log.length > 0 && (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => void clear()}>
            {t('platformApi.log.clear')}
          </Button>
        </div>
      )}
    </section>
  );
}
