// Settings > Sync (ADR 0049), labeled Beta. Before setup it explains what sync does and what is encrypted, and
// offers Set up and Join. After setup it shows the state in words, Sync this device (off pauses), Sync now,
// Preview changes, the devices, Change passphrase, and Turn off. Errors say what happened and what to do; a rollback offers Trust the
// storage as it is. Work offline keeps every round waiting, with a note.

import { useState } from 'react';
import { t } from '../../strings/t';
import { Button, Switch, announce, confirm, showToast } from '../../ui';
import { useOffline } from '../diagnostics';
import { Devices } from './Devices';
import { ChangePassphrase } from './Passphrase';
import { codeOf, errorText, keyStoreText, placeText, stateText, summaryLines, whenText } from './model';
import { refreshSync, setView, syncClient, useSyncPolling, useSyncView } from './runtime';
import styles from './sync.module.css';
import type { SyncView } from './types';
import { Wizard } from './Wizard';

const EXPLAINER = ['item1', 'item2', 'item3', 'item4', 'item5', 'item6'] as const;

function Explainer() {
  return (
    <section className={styles.block} aria-labelledby="sync-explainer">
      <h2 id="sync-explainer">{t('sync.explainer.title')}</h2>
      <ul className={styles.bullets}>
        {EXPLAINER.map((item) => (
          <li key={item}>{item === 'item4' ? keyStoreText('sync.explainer.item4') : t(`sync.explainer.${item}`)}</li>
        ))}
      </ul>
    </section>
  );
}

/** Sync now, Preview, Pause, Trust, and Turn off, with the busy state and the last problem. */
function useActions(view: SyncView) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(errorText(codeOf(error)));
      void refreshSync();
    } finally {
      setBusy(false);
    }
  };
  const asked = async (prefix: 'sync.trust' | 'sync.turnOff', work: () => Promise<SyncView>, done: string) => {
    const yes = await confirm({
      title: t(`${prefix}Title`),
      body: t(`${prefix}Body`),
      confirmLabel: t(`${prefix}Confirm`),
      danger: true,
    });
    if (!yes) return;
    await run(async () => {
      setView(await work());
      announce(done);
    });
  };
  return {
    busy,
    problem,
    preview,
    syncNow: () =>
      run(async () => {
        setView({ ...view, status: { ...view.status, state: 'syncing' } });
        const result = await syncClient().syncNow();
        setView(result.view);
        setPreview(null);
        announce(t('sync.done.synced'));
      }),
    showPreview: () => run(async () => setPreview(summaryLines((await syncClient().preview()).summary))),
    setPaused: (next: boolean) =>
      run(async () => {
        setView(await syncClient().setPaused(next));
        announce(t(next ? 'sync.done.paused' : 'sync.done.resumed'));
      }),
    trust: () => asked('sync.trust', () => syncClient().trustStorage(), t('sync.done.trusted')),
    turnOff: () => asked('sync.turnOff', () => syncClient().turnOff(), t('sync.done.off')),
  };
}

function StatusLines({ view }: { view: SyncView }) {
  const { status } = view;
  return (
    <>
      <p role="status" className={styles.help}>
        {status.lastSync ? t('sync.lastSync', { when: whenText(status.lastSync) }) : t('sync.never')}
      </p>
      {view.backend && <p className={styles.help}>{placeText(view.backend)}</p>}
      {view.fingerprint && <p className={styles.help}>{t('sync.fingerprint', { code: view.fingerprint })}</p>}
      {status.conflicts > 0 && <p className={styles.notice}>{t('sync.conflicts', { count: status.conflicts })}</p>}
    </>
  );
}

function Configured({ view }: { view: SyncView }) {
  const a = useActions(view);
  const { status } = view;
  const paused = status.state === 'paused';
  const stopped = status.state === 'error' && status.errorCode ? errorText(status.errorCode) : null;
  const shown = a.problem ?? stopped;
  return (
    <>
      <section className={styles.block} aria-labelledby="sync-status">
        <h2 id="sync-status">{stateText(status.state)}</h2>
        <StatusLines view={view} />
        {shown && (
          <p className={styles.notice} role="alert">
            {shown}
          </p>
        )}
        <Switch
          label={t('sync.switchLabel')}
          checked={!paused}
          onChange={(on) => void a.setPaused(!on)}
          describedBy="sync-switch-help"
          disabled={a.busy ? 'aria' : undefined}
        />
        <p id="sync-switch-help" className={styles.help}>
          {t('sync.switchHelp')}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void a.syncNow()} disabled={a.busy || paused}>
            {status.state === 'syncing' ? t('sync.state.syncing') : t('sync.syncNow')}
          </Button>
          <Button onClick={() => void a.showPreview()} disabled={a.busy || paused}>
            {t('sync.preview')}
          </Button>
          {status.errorCode === 'rollback' && <Button onClick={() => void a.trust()}>{t('sync.trust')}</Button>}
        </div>
        {a.preview && (
          <section className={styles.notice} aria-labelledby="sync-preview">
            <h3 id="sync-preview">{t('sync.summary.title')}</h3>
            <ul className={styles.bullets}>
              {a.preview.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
      </section>
      <Devices />
      <ChangePassphrase />
      <div className={styles.actions}>
        <Button variant="danger" onClick={() => void a.turnOff()}>
          {t('sync.turnOff')}
        </Button>
      </div>
    </>
  );
}

/** Setup stopped before the recovery key was checked, such as when Settings closed. The key can't be shown again. */
function Unfinished() {
  const [busy, setBusy] = useState(false);
  const again = async () => {
    setBusy(true);
    try {
      setView(await syncClient().cancelSetUp());
    } catch (error) {
      showToast({ message: errorText(codeOf(error)), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.block} aria-label={t('sync.setUp')}>
      <p className={styles.notice} role="status">
        {t('sync.unfinished')}
      </p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void again()} disabled={busy}>
          {t('sync.startAgain')}
        </Button>
      </div>
    </section>
  );
}

export default function SyncSection() {
  useSyncPolling(15_000);
  const view = useSyncView();
  const offline = useOffline();
  const [wizard, setWizard] = useState<'create' | 'join' | null>(null);

  if (wizard) {
    return <Wizard mode={wizard} onCancel={() => setWizard(null)} onDone={() => setWizard(null)} />;
  }
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <span className={styles.badge}>{t('sync.beta')}</span>
      </div>
      <p className={styles.help}>{t('sync.intro')}</p>
      {offline && (
        <p className={styles.notice} role="status">
          {t('sync.offlineNotice')}
        </p>
      )}
      {view?.configured && view.unfinished ? (
        <Unfinished />
      ) : view?.configured ? (
        <Configured view={view} />
      ) : (
        <section className={styles.block} aria-label={t('sync.setUp')}>
          <p>{t('sync.offNotice')}</p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setWizard('create')}>
              {t('sync.setUp')}
            </Button>
            <Button onClick={() => setWizard('join')}>{t('sync.join')}</Button>
          </div>
        </section>
      )}
      <Explainer />
    </div>
  );
}
