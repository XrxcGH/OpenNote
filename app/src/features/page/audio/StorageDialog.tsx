// The list of what recordings take (Phase 9, "Recording storage"): each recording's length and size, the page and
// notebook that hold it, and what each can free. Nothing changes until a button is pressed and confirmed.
import { useCallback, useEffect, useState } from 'react';
import type { StoredRecording } from '../../../core/audio';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, Dialog } from '../../../ui';
import { describeError } from './controller';
import { bytesText, clockNs } from './format';
import styles from './more.module.css';
import { recordingChoices } from './state';
import { compressStored, freedBy, removeStoredAudio, scanStorage } from './storage';

type Listing =
  { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; items: StoredRecording[] };

function Row({
  item,
  busy,
  onChange,
}: {
  item: StoredRecording;
  busy: boolean;
  onChange: (action: () => Promise<boolean>) => void;
}) {
  const quality = useStore(recordingChoices, (choices) => choices.quality);
  const title = item.pageTitle || t('audioMore.storage.untitled');
  const frees = freedBy(item, quality);
  return (
    <li className={styles.item}>
      <div className={styles.itemText}>
        <strong>{title}</strong>
        <span className={styles.help}>
          {t('audioMore.storage.where', { notebook: item.notebook, section: item.section })}
        </span>
        <span className={styles.help}>
          {t('audioMore.storage.row', { length: clockNs(item.durationNs), size: bytesText(item.bytes) })}
        </span>
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={busy || frees < 1000}
          aria-label={t('audioMore.storage.compressLabel', { page: title })}
          onClick={() => onChange(() => compressStored(item, quality))}
        >
          {t('audioMore.storage.compress')}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          aria-label={t('audioMore.storage.removeLabel', { page: title })}
          onClick={() => onChange(() => removeStoredAudio(item))}
        >
          {t('audioMore.storage.removeAudio')}
        </Button>
      </div>
    </li>
  );
}

export function StorageDialog({ onClose }: { onClose(): void }) {
  const [listing, setListing] = useState<Listing>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    scanStorage().then(
      (items) => setListing({ state: 'ready', items }),
      (error: unknown) => setListing({ state: 'failed', message: describeError(error) }),
    );
  }, []);
  useEffect(load, [load]);
  const change = (action: () => Promise<boolean>) => {
    setBusy(true);
    void action()
      .then((changed) => changed && load())
      .finally(() => setBusy(false));
  };
  const items = listing.state === 'ready' ? listing.items : [];
  const total = items.reduce((sum, item) => sum + item.bytes, 0);
  return (
    <Dialog
      title={t('audioMore.storage.title')}
      description={t('audioMore.storage.description')}
      size="large"
      onDismiss={onClose}
      actions={[{ id: 'close', label: t('audioMore.storage.close'), variant: 'primary', onPress: onClose }]}
    >
      {listing.state === 'loading' && <p className={styles.help}>{t('audioMore.storage.loading')}</p>}
      {listing.state === 'failed' && (
        <p role="alert" className={styles.help}>
          {t('audioMore.storage.failed')} {listing.message}
        </p>
      )}
      {listing.state === 'ready' && items.length === 0 && <p className={styles.help}>{t('audioMore.storage.none')}</p>}
      {items.length > 0 && (
        <>
          <p className={styles.help}>{t('audioMore.storage.total', { size: bytesText(total) })}</p>
          <ul className={styles.list}>
            {items.map((item) => (
              <Row key={item.entry.id} item={item} busy={busy} onChange={change} />
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
