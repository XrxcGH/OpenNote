// One connector: its name and state, what connecting gives you, what OpenNote will be able to do, and the buttons for
// its state. A service with its own sign-in page opens the browser from Connect. A service that takes a pasted token
// shows its form (the token, and the school's address where there is one) under the button.

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { t } from '../../strings/t';
import { Button, TextField } from '../../ui';
import styles from './Connectors.module.css';
import {
  accessLines,
  cardActions,
  connectedOnLine,
  errorText,
  featureName,
  hostList,
  lastUsedLine,
  stateLine,
  unlocksLine,
} from './model';
import type { ConnectInput, ConnectorErrorCode, ConnectorInfo } from './types';

export interface ConnectorCardProps {
  info: ConnectorInfo;
  /** Work offline is on, so Connect and Reconnect wait. */
  offline: boolean;
  /** The element that says why, linked from the waiting buttons. */
  offlineNoticeId: string;
  error?: ConnectorErrorCode;
  /** Answers true when the account is connected. */
  onConnect(input?: ConnectInput): Promise<boolean>;
  onCancel(): void;
  onDisconnect(): void;
  onSetup(): void;
  onOpenFolder(): void;
  /** Saves the client ID typed on the card. Answers true when it was saved. */
  onSaveClient?(clientId: string, clientSecret: string): Promise<boolean>;
}

function TokenForm(props: { info: ConnectorInfo; onSubmit(input: ConnectInput): Promise<boolean>; onClose(): void }) {
  const { info, onSubmit, onClose } = props;
  const [token, setToken] = useState('');
  const [address, setAddress] = useState(info.baseUrl ?? '');
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const school = info.auth === 'tokenAndUrl';
  // WebDAV takes a user name and a password, not a token, and a server address, not a school's.
  const webdav = info.id === 'webdav';
  useEffect(() => form.current?.querySelector('input')?.focus(), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || token.trim().length === 0) return;
    setBusy(true);
    const connected = await onSubmit({ token, ...(school ? { baseUrl: address } : {}) });
    setBusy(false);
    // The token field is emptied as soon as the token has been sent, whatever the answer.
    setToken('');
    if (connected) onClose();
  };
  return (
    <form
      ref={form}
      className={styles.form}
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      {school && (
        <TextField
          label={t(webdav ? 'connectors.detail.webdavAddressLabel' : 'connectors.detail.addressLabel')}
          help={t(webdav ? 'connectors.detail.webdavAddressHelp' : 'connectors.detail.addressHelp')}
          value={address}
          onChange={setAddress}
        />
      )}
      <TextField
        label={t(webdav ? 'connectors.detail.webdavTokenLabel' : 'connectors.detail.tokenLabel')}
        help={t(webdav ? 'connectors.detail.webdavTokenHelp' : 'connectors.detail.tokenHelp')}
        value={token}
        onChange={setToken}
        secret
      />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" aria-disabled={busy || token.trim().length === 0 ? true : undefined}>
          {t('connectors.actions.save')}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          {t('connectors.actions.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ClientForm(props: { onSubmit(id: string, secret: string): Promise<boolean>; onClose(): void }) {
  const { onSubmit, onClose } = props;
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => form.current?.querySelector('input')?.focus(), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || clientId.trim().length === 0) return;
    setBusy(true);
    const saved = await onSubmit(clientId.trim(), secret.trim());
    setBusy(false);
    setSecret('');
    if (saved) onClose();
  };
  return (
    <form
      ref={form}
      className={styles.form}
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <TextField
        label={t('connectors.detail.clientIdLabel')}
        help={t('connectors.detail.clientIdHelp')}
        value={clientId}
        onChange={setClientId}
      />
      <TextField
        label={t('connectors.detail.clientSecretLabel')}
        help={t('connectors.detail.clientSecretHelp')}
        value={secret}
        onChange={setSecret}
        secret
      />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" aria-disabled={busy || clientId.trim().length === 0 ? true : undefined}>
          {t('connectors.actions.saveClient')}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          {t('connectors.actions.cancel')}
        </Button>
      </div>
    </form>
  );
}
function Details({ info }: { info: ConnectorInfo }) {
  const access = accessLines(info);
  const used = lastUsedLine(info);
  return (
    <details className={styles.details}>
      <summary>{t('connectors.actions.details')}</summary>
      <div className={styles.more}>
        <h4>{t('connectors.detail.unlocksHeading')}</h4>
        <ul>
          {info.features.map((feature) => (
            <li key={feature}>{featureName(feature)}</li>
          ))}
        </ul>
        <h4>{t('connectors.detail.accessHeading')}</h4>
        <ul>
          {access.map((line) => (
            <li key={line.capability}>
              {line.text}{' '}
              <span className={styles.mark}>
                ({line.writes ? t('connectors.detail.canChange') : t('connectors.detail.readOnly')})
              </span>
            </li>
          ))}
        </ul>
        <h4>{t('connectors.detail.hostsHeading')}</h4>
        <p className={styles.help}>
          {info.hosts.length > 0
            ? t('connectors.detail.hosts', { hosts: hostList(info.hosts) })
            : t('connectors.detail.noHostsYet')}
        </p>
        {used && <p className={styles.help}>{used}</p>}
      </div>
    </details>
  );
}

export function ConnectorCard(props: ConnectorCardProps) {
  const { info, offline, offlineNoticeId, error, onConnect, onCancel, onDisconnect, onSetup, onOpenFolder } = props;
  const { onSaveClient } = props;
  const headingId = useId();
  const formId = useId();
  const errorId = useId();
  const [formOpen, setFormOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const clientFormId = useId();
  const actions = cardActions(info);
  const state = stateLine(info);
  const since = connectedOnLine(info);
  const withForm = info.auth !== 'oauth';
  // While offline the button stays, says why, and does nothing.
  const waiting = offline ? { 'aria-disabled': true as const } : {};
  const describedBy = offline ? `${headingId} ${offlineNoticeId}` : headingId;
  const connect = () => {
    if (offline) return;
    if (withForm) setFormOpen((open) => !open);
    else void onConnect();
  };
  const formProps = withForm ? { 'aria-expanded': formOpen, 'aria-controls': formId } : {};
  return (
    <li>
      <article className={styles.card} aria-labelledby={headingId}>
        <div className={styles.head}>
          <h3 id={headingId}>{info.name}</h3>
          <p className={styles.state} data-tone={state.tone}>
            {state.text}
          </p>
        </div>
        <p>{unlocksLine(info)}</p>
        {since && <p className={styles.help}>{since}</p>}
        {actions.setup && <p className={styles.help}>{t('connectors.detail.setupHelp', { name: info.name })}</p>}
        {error && (
          <p id={errorId} className={styles.error}>
            {errorText(error, info.name)}
          </p>
        )}
        <div className={styles.actions}>
          {actions.connect && (
            <Button variant="primary" onClick={connect} aria-describedby={describedBy} {...formProps} {...waiting}>
              {t('connectors.actions.connect')}
            </Button>
          )}
          {actions.reconnect && (
            <Button variant="primary" onClick={connect} aria-describedby={describedBy} {...formProps} {...waiting}>
              {t('connectors.actions.reconnect')}
            </Button>
          )}
          {actions.cancel && (
            <Button onClick={onCancel} aria-describedby={headingId}>
              {t('connectors.actions.cancel')}
            </Button>
          )}
          {actions.disconnect && (
            <Button onClick={onDisconnect} aria-describedby={headingId}>
              {t('connectors.actions.disconnect')}
            </Button>
          )}
          {actions.setup && (
            <>
              <Button variant="primary" onClick={onSetup} aria-describedby={headingId}>
                {t('connectors.actions.setup')}
              </Button>
              <Button variant="quiet" onClick={onOpenFolder} aria-describedby={headingId}>
                {t('connectors.actions.openFolder')}
              </Button>
              {onSaveClient && (
                <Button
                  variant="secondary"
                  onClick={() => setClientOpen((open) => !open)}
                  aria-describedby={headingId}
                  aria-expanded={clientOpen}
                  aria-controls={clientFormId}
                >
                  {t('connectors.actions.addClient')}
                </Button>
              )}
            </>
          )}
        </div>
        {withForm && formOpen && (
          <div id={formId}>
            <TokenForm info={info} onSubmit={onConnect} onClose={() => setFormOpen(false)} />
          </div>
        )}
        {actions.setup && onSaveClient && clientOpen && (
          <div id={clientFormId}>
            <ClientForm onSubmit={onSaveClient} onClose={() => setClientOpen(false)} />
          </div>
        )}
        <Details info={info} />
      </article>
    </li>
  );
}
