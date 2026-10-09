// App permissions, then Webhooks: tell a service such as Zapier or Power Automate when a page is added, changes, or
// gets a tag. Each hook has a web address, the events it hears, the notebooks it covers, and whether the page's
// text goes too (off by default). A new hook without a secret gets one, shown once so the person can copy it.

import { useCallback, useEffect, useId, useState } from 'react';
import { t } from '../../../strings/t';
import { announce, Button, confirm, Dialog, Switch } from '../../../ui';
import styles from './AppPermissions.module.css';
import { apiHost } from './host';
import { ScopePicker } from './ScopePicker';
import type { NotebookChoice } from './ScopePicker';
import type { HookEvent, Webhook } from './types';

const EVENTS: readonly HookEvent[] = ['pageCreated', 'pageChanged', 'tagAdded'];

/** A web address starting with https:// and a host name, as the shell checks it again. */
export function webhookUrlOk(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed) || /\s/.test(trimmed) || trimmed.length > 2048) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' && parsed.hostname.includes('.') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

const blank = (): Webhook => ({
  id: '',
  name: '',
  url: '',
  events: ['pageCreated'],
  notebooks: { kind: 'all' },
  includeText: false,
  enabled: true,
});

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function WebhooksPanel({ notebooks }: { notebooks: readonly NotebookChoice[] }) {
  const headingId = useId();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      apiHost()
        .call<Webhook[]>('webhooks')
        .then((list) => setHooks(list ?? [])),
    [],
  );
  useEffect(() => {
    void reload().catch(() => {});
    return apiHost().listen((event) => {
      if (event.kind === 'changed' && event.what === 'webhooks') void reload().catch(() => {});
    });
  }, [reload]);

  const remove = async (hook: Webhook) => {
    const yes = await confirm({
      title: t('platformApi.webhooks.removeTitle', { name: hook.name }),
      body: t('platformApi.webhooks.removeBody', { name: hook.name }),
      confirmLabel: t('platformApi.webhooks.remove'),
      danger: true,
    });
    if (!yes) return;
    await apiHost().call('deleteWebhook', { id: hook.id });
    await reload();
  };
  const test = async (hook: Webhook) => {
    const { status } = await apiHost().call<{ status: number | null }>('testWebhook', { id: hook.id });
    const ok = status !== null && status >= 200 && status < 300;
    announce(t(ok ? 'platformApi.webhooks.testSent' : 'platformApi.webhooks.testFailed', { name: hook.name }));
  };
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('platformApi.webhooks.heading')}</h2>
      <p className={styles.help}>{t('platformApi.webhooks.help')}</p>
      {hooks.length === 0 ? (
        <p className={styles.help}>{t('platformApi.webhooks.empty')}</p>
      ) : (
        <ul className={styles.list} aria-labelledby={headingId}>
          {hooks.map((hook) => (
            <li key={hook.id}>
              <article className={styles.card} aria-label={hook.name}>
                <div className={styles.head}>
                  <h3>{hook.name}</h3>
                  <span className={styles.meta}>{hook.url}</span>
                </div>
                <p className={styles.meta}>
                  {hook.events.map((event) => t(`platformApi.webhooks.event.${event}`)).join(', ')}
                </p>
                <div className={styles.actions}>
                  <Button
                    variant="secondary"
                    aria-label={t('platformApi.webhooks.editLabel', { name: hook.name })}
                    onClick={() => setEditing(hook)}
                  >
                    {t('platformApi.webhooks.edit')}
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label={t('platformApi.webhooks.testLabel', { name: hook.name })}
                    onClick={() => void test(hook)}
                  >
                    {t('platformApi.webhooks.test')}
                  </Button>
                  <Button
                    variant="quiet"
                    aria-label={t('platformApi.webhooks.removeLabel', { name: hook.name })}
                    onClick={() => void remove(hook)}
                  >
                    {t('platformApi.webhooks.remove')}
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      {newSecret && (
        <div className={styles.code} role="status">
          <p>{t('platformApi.webhooks.secretShown')}</p>
          <p className={styles.codeText}>{newSecret}</p>
          <Button variant="secondary" onClick={() => setNewSecret(null)}>
            {t('platformApi.webhooks.secretDone')}
          </Button>
        </div>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => setEditing(blank())}>
          {t('platformApi.webhooks.add')}
        </Button>
      </div>
      {editing && (
        <WebhookDialog
          hook={editing}
          notebooks={notebooks}
          onClose={() => setEditing(null)}
          onSaved={(secret) => {
            setEditing(null);
            setNewSecret(secret);
            announce(t('platformApi.webhooks.saved'));
            void reload();
          }}
        />
      )}
    </section>
  );
}

function WebhookDialog(props: {
  hook: Webhook;
  notebooks: readonly NotebookChoice[];
  onClose(): void;
  onSaved(newSecret: string | null): void;
// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
}) {
  const { notebooks, onClose, onSaved } = props;
  const [hook, setHook] = useState<Webhook>(props.hook);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const change = (patch: Partial<Webhook>) => setHook((current) => ({ ...current, ...patch }));
  const save = async () => {
    if (!webhookUrlOk(hook.url)) return setError(t('platformApi.webhooks.badUrl'));
    if (hook.events.length === 0) return setError(t('platformApi.webhooks.noEvents'));
    if (hook.notebooks.kind === 'notebooks' && hook.notebooks.ids.length === 0) {
      return setError(t('platformApi.ask.pickNotebook'));
    }
    try {
      const saved = await apiHost().call<{ hook: Webhook; newSecret: string | null }>('saveWebhook', {
        hook: { ...hook, name: hook.name.trim() || new URL(hook.url).hostname },
        secret: secret || null,
      });
      onSaved(saved?.newSecret ?? null);
    } catch {
      setError(t('platformApi.webhooks.badUrl'));
    }
  };
  return (
    <Dialog
      title={t('platformApi.webhooks.dialogTitle')}
      size="medium"
      onDismiss={onClose}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: onClose },
        { id: 'save', label: t('platformApi.webhooks.save'), variant: 'primary', onPress: () => void save() },
      ]}
    >
      <div className={styles.dialogBody}>
        <label className={styles.field}>
          <span>{t('platformApi.webhooks.name')}</span>
          <input
            type="text"
            maxLength={60}
            value={hook.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>{t('platformApi.webhooks.url')}</span>
          <input
            type="url"
            inputMode="url"
            spellCheck={false}
            value={hook.url}
            aria-invalid={error === t('platformApi.webhooks.badUrl') ? true : undefined}
            onChange={(event) => change({ url: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>{t('platformApi.webhooks.secret')}</span>
          <input
            type="password"
            autoComplete="off"
            value={secret}
            aria-describedby={`${id}-secret`}
            onChange={(event) => setSecret(event.target.value)}
          />
          <span id={`${id}-secret`} className={styles.note}>
            {t('platformApi.webhooks.secretNote')}
          </span>
        </label>
        <fieldset className={styles.fieldset}>
          <legend>{t('platformApi.webhooks.events')}</legend>
          {EVENTS.map((event) => (
            <label key={event} className={styles.choice}>
              <input
                type="checkbox"
                checked={hook.events.includes(event)}
                onChange={(input) =>
                  change({
                    events: input.target.checked
                      ? [...hook.events.filter((one) => one !== event), event]
                      : hook.events.filter((one) => one !== event),
                  })
                }
              />
              {t(`platformApi.webhooks.event.${event}`)}
            </label>
          ))}
        </fieldset>
        <ScopePicker
          legend={t('platformApi.apps.notebooks.label')}
          value={hook.notebooks}
          notebooks={notebooks}
          onChange={(next) => change({ notebooks: next })}
        />
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={hook.includeText}
            onChange={(event) => change({ includeText: event.target.checked })}
          />
          {t('platformApi.webhooks.includeText')}
        </label>
        <Switch
          label={t('platformApi.webhooks.enabled')}
          checked={hook.enabled}
          onChange={(on) => change({ enabled: on })}
        />
        {error && (
          <p className={styles.note} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
