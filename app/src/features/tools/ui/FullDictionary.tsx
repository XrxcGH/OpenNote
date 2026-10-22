// The optional full dictionary inside the Dictionary window: the first time the window opens it asks, with the size,
// the sources and their licenses, whether to download Open English WordNet and Moby Thesaurus II. Nothing downloads
// until the person says so. After that the words work offline, and the data can be removed here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, ProgressBar, announce } from '../../../ui';
import { errorCode, failureKey } from '../dictionary/full';
import type { FailureKey, FullClient, FullStatus } from '../dictionary/full';
import styles from './tools.module.css';

const DECLINED = 'opennote.dictionary.offerDeclined';
const POLL_MS = 400;

function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function declined(): boolean {
  try {
    return window.localStorage.getItem(DECLINED) === '1';
  } catch {
    return false;
  }
}

function rememberDeclined(): void {
  try {
    window.localStorage.setItem(DECLINED, '1');
  } catch {
    // The offer then shows again next time, which is harmless.
  }
}

const isBusy = (status: FullStatus | null) => status?.state === 'downloading' || status?.state === 'building';

/**
 * Follows the shell's download. `onInstalled` runs when the index becomes ready (and once when the window opens with it
 * ready), `onRemoved` when the data is removed, so the window can switch its look-ups.
 */
function useFull(client: FullClient, onChange: (installed: boolean) => void) {
  const [status, setStatus] = useState<FullStatus | null>(null);
  const [failure, setFailure] = useState<FailureKey | null>(null);
  const [note, setNote] = useState('');
  const previous = useRef<FullStatus['state'] | null>(null);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  });

  const apply = useCallback((next: FullStatus) => {
    const before = previous.current;
    previous.current = next.state;
    setStatus(next);
    if (next.state === 'installed' && before !== 'installed') {
      change.current(true);
      if (before !== null) announce(t('study.dictionary.full.ready'));
    }
    if (next.state === 'failed') setFailure(failureKey(next.error));
    if (next.state === 'downloading' || next.state === 'installed') setFailure(null);
  }, []);

  const run = useCallback(
    async (action: () => Promise<FullStatus>) => {
      try {
        apply(await action());
      } catch (error) {
        setFailure(failureKey(errorCode(error)));
      }
    },
    [apply],
  );

  useEffect(() => {
    let current = true;
    client.status().then(
      (next) => current && apply(next),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, apply]);

  // While a download runs, the shell is asked how far it got.
  const busy = isBusy(status);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => {
      client.status().then(apply, () => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, client, apply]);

  return {
    status,
    failure,
    note,
    start: () => {
      setFailure(null);
      setNote('');
      return run(() => client.start());
    },
    cancel: async () => {
      await run(() => client.cancel());
      setNote(t('study.dictionary.full.canceled'));
    },
    remove: async () => {
      await run(() => client.remove());
      previous.current = 'notInstalled';
      change.current(false);
      const message = t('study.dictionary.full.removed');
      setNote(message);
      announce(message);
    },
  };
}

function Sources() {
  return (
    <p className={styles.note}>
      {t('study.dictionary.full.sourceMeanings')} {t('study.dictionary.full.sourceRelated')}{' '}
      {t('study.dictionary.full.sourceChecked')}
    </p>
  );
}

function Controls({ full, size }: { full: ReturnType<typeof useFull>; size: string }) {
  const { status, failure, note } = full;
  if (!status) return null;
  const busy = isBusy(status);
  const percent = status.totalBytes > 0 ? Math.min(100, Math.round((status.bytes / status.totalBytes) * 100)) : 0;
  const line = (() => {
    if (failure) return t(`study.dictionary.full.failure.${failure}`);
    switch (status.state) {
      case 'downloading':
        return t('study.dictionary.full.downloading', { done: megabytes(status.bytes), size });
      case 'building':
        return t('study.dictionary.full.building');
      case 'installed':
        return [
          t('study.dictionary.full.installedWords', { words: status.words }),
          t('study.dictionary.full.installedRelated', { related: status.related }),
        ].join(' ');
      case 'partial':
        return t('study.dictionary.full.partial', { done: megabytes(status.bytes), size });
      default:
        return status.offline ? t('study.dictionary.full.offlineNow') : note || t('study.dictionary.full.none');
    }
  })();
  return (
    <div className={styles.group}>
      {status.state === 'downloading' ? (
        <ProgressBar label={t('study.dictionary.full.progress')} value={percent} />
      ) : null}
      {status.state === 'building' ? <ProgressBar label={t('study.dictionary.full.progress')} /> : null}
      <p className={failure ? styles.problem : styles.note} role="status">
        {line}
      </p>
      {note && !failure && status.state !== 'notInstalled' ? <p className={styles.note}>{note}</p> : null}
      <div className={styles.buttons}>
        {status.state === 'notInstalled' || status.state === 'failed' ? (
          <Button
            variant="primary"
            disabled={status.offline}
            aria-label={failure ? undefined : t('study.dictionary.full.downloadNamed', { size })}
            onClick={() => void full.start()}
          >
            {failure ? t('study.dictionary.full.retry') : t('study.dictionary.full.download', { size })}
          </Button>
        ) : null}
        {status.state === 'partial' ? (
          <Button variant="primary" disabled={status.offline} onClick={() => void full.start()}>
            {t('study.dictionary.full.resume')}
          </Button>
        ) : null}
        {busy && status.state === 'downloading' ? (
          <Button variant="secondary" onClick={() => void full.cancel()}>
            {t('study.dictionary.full.cancel')}
          </Button>
        ) : null}
        {status.state === 'installed' || status.state === 'partial' || status.state === 'failed' ? (
          <Button variant="quiet" onClick={() => void full.remove()}>
            {t('study.dictionary.full.remove')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The offer and the controls. Without a shell client (a browser) it shows nothing, because nothing can be downloaded
 * there. `onChange` says whether the full data is installed, whenever that changes.
 */
export function FullDictionary({
  client,
  onChange,
}: {
  client: FullClient | null;
  onChange: (installed: boolean) => void;
}) {
  if (!client) return null;
  return <FullDictionaryFor client={client} onChange={onChange} />;
}

function FullDictionaryFor({ client, onChange }: { client: FullClient; onChange: (installed: boolean) => void }) {
  const full = useFull(client, onChange);
  const [skipped, setSkipped] = useState(declined);
  const { status } = full;
  if (!status) return null;
  const size = megabytes(status.totalBytes);
  const asking = status.state === 'notInstalled' && !skipped && !full.failure;
  const active = isBusy(status) || status.state === 'partial' || full.failure !== null;
  if (asking || active) {
    return (
      <section className={styles.card} aria-labelledby="dictionary-full-title">
        <h3 id="dictionary-full-title" className={styles.groupTitle}>
          {asking ? t('study.dictionary.full.offerTitle') : t('study.dictionary.full.title')}
        </h3>
        {asking ? (
          <p className={styles.note}>
            {t('study.dictionary.full.offerWords')} {t('study.dictionary.full.offerBody')}{' '}
            {t('study.dictionary.full.offerSize', { size })}
          </p>
        ) : null}
        <Sources />
        <Controls full={full} size={size} />
        {asking ? (
          <div className={styles.buttons}>
            <Button
              variant="quiet"
              onClick={() => {
                rememberDeclined();
                setSkipped(true);
                announce(t('study.dictionary.full.notNowHint'));
              }}
            >
              {t('study.dictionary.full.notNow')}
            </Button>
          </div>
        ) : null}
      </section>
    );
  }
  return (
    <details className={styles.group}>
      <summary>{t('study.dictionary.full.title')}</summary>
      <div className={styles.form}>
        {status.state === 'notInstalled' && skipped ? (
          <p className={styles.note}>{t('study.dictionary.full.notNowHint')}</p>
        ) : null}
        <Sources />
        <Controls full={full} size={size} />
      </div>
    </details>
  );
}
