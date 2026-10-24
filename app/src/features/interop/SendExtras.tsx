// Favorite folders and "Update the copy" in the Export dialog (flag interop.sendToFolder). A favorite is a folder the
// person chose before, such as one that OneDrive or Dropbox keeps in sync. A copy is a file sent before, which an
// export can replace after the notes change. Everything stays on this PC until the person presses a button.

import { useSyncExternalStore } from 'react';
import { isEnabled } from '../../app/flags';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import type { ExportFlow } from './exportFlow';
import styles from './Interop.module.css';
import { fileName } from './text';

export function SendExtras({ flow, folder }: { flow: ExportFlow; folder: string | null }) {
  const extras = useSyncExternalStore(flow.extras.subscribe, flow.extras.get);
  if (!isEnabled('interop.sendToFolder')) return null;
  const { favorites, copies } = extras;
  if (favorites.length === 0 && copies.length === 0 && !folder) return null;
  const isFavorite = folder !== null && favorites.includes(folder);
  return (
    <div className={styles.body}>
      {favorites.length > 0 && (
        <div role="group" aria-label={t('moreInterop.send.favorites')}>
          <h3 className={styles.subheading}>{t('moreInterop.send.favorites')}</h3>
          {favorites.map((favorite) => (
            <Button key={favorite} variant="quiet" onClick={() => flow.useFolder(favorite)}>
              {t('moreInterop.send.use', { name: fileName(favorite) })}
            </Button>
          ))}
        </div>
      )}
      {folder && (
        <Button variant="quiet" onClick={() => void flow.toggleFavorite()}>
          {isFavorite ? t('moreInterop.send.unfavorite') : t('moreInterop.send.favorite')}
        </Button>
      )}
      {copies.length > 0 && (
        <div role="group" aria-label={t('moreInterop.send.copies')}>
          <h3 className={styles.subheading}>{t('moreInterop.send.copies')}</h3>
          {copies.map((copy) => (
            <Button key={copy.path} variant="secondary" onClick={() => void flow.update(copy)}>
              {t('moreInterop.send.update', { name: fileName(copy.path) })}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
