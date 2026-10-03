// The notice for a notes folder inside OneDrive, Dropbox, iCloud Drive, or Google Drive (docs/FEATURES.md, "Notes
// in OneDrive or Dropbox"): what it means, and for OneDrive the offer to always keep the folder on this device.
// Setup shows it for the folder just chosen, and Settings for the folder in use.

import { useEffect, useState } from 'react';
import { shellCall } from '../../platform/shellqol';
import { t } from '../../strings/t';
import { Button, showToast } from '../../ui';
import { settingsStyles as styles } from '../settings';

export interface CloudInfo {
  readonly service: 'oneDrive' | 'dropbox' | 'iCloud' | 'googleDrive';
  readonly name: string;
  readonly canPin: boolean;
}

/** The sync service that holds the folder, or null. */
export function useCloud(folder: string): CloudInfo | null {
  const [found, setFound] = useState<{ folder: string; info: CloudInfo | null } | null>(null);
  useEffect(() => {
    let current = true;
    if (folder) {
      shellCall<CloudInfo | null>('cloud.detect', { path: folder }).then(
        (info) => current && setFound({ folder, info }),
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [folder]);
  return found?.folder === folder ? found.info : null;
}

export function CloudNotice({ folder, info }: { folder: string; info: CloudInfo }) {
  const [pinned, setPinned] = useState(false);
  const keep = async () => {
    try {
      const answer = await shellCall<{ ok: boolean } | null>('cloud.keepOnDevice', { path: folder });
      if (answer?.ok) return setPinned(true);
    } catch {
      // Falls through to the message below.
    }
    showToast({ message: t('qol.cloud.keepFailed'), tone: 'danger' });
  };
  return (
    <section className={styles.block} aria-labelledby="cloud-notice">
      <h2 id="cloud-notice">{t('qol.cloud.title', { service: info.name })}</h2>
      <p>{t('qol.cloud.explain', { service: info.name })}</p>
      <p className={styles.help}>{t('qol.cloud.conflicts', { service: info.name })}</p>
      {info.canPin ? (
        <div className={styles.actions}>
          <Button onClick={() => void keep()} disabled={pinned}>
            {t(pinned ? 'qol.cloud.kept' : 'qol.cloud.keep')}
          </Button>
        </div>
      ) : (
        <p className={styles.help}>{t('qol.cloud.manual', { service: info.name })}</p>
      )}
    </section>
  );
}
