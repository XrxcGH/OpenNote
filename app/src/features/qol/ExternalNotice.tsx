// The notices above a page when something outside OpenNote touched it: a program changed the page's files while it
// was open (offers to reload it), or a sync tool or another device made a copy of it (offers the side-by-side view).
// Neither notice changes the page by itself.

import { useEffect, useState } from 'react';
import { useFlag } from '../../app/flags';
import { getLocation, navigate, useLocation } from '../../app/location';
import { shellCall } from '../../platform/shellqol';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { dismissExternal, externalStore, markReadable } from './externalStore';
import { bringInReadable, hasReadableEdits } from './readableImport';
import styles from './QolPage.module.css';

export interface ConflictItem {
  readonly revision: string;
  readonly device: { readonly label?: string };
  readonly savedAt: string;
}

const NONE: ConflictItem[] = [];

/** The open conflicts of the page, read again when the page changes, when the watcher reports, and on focus. */
export function useConflicts(pageId: string | null, enabled: boolean): ConflictItem[] {
  const tick = useStore(externalStore, (state) => state.tick);
  const [read, setRead] = useState<{ pageId: string; items: ConflictItem[] } | null>(null);
  useEffect(() => {
    if (!pageId || !enabled) return undefined;
    let current = true;
    const read = () =>
      void shellCall<ConflictItem[] | null>('conflict.list', { pageId }).then(
        (list) => current && setRead({ pageId, items: list ?? [] }),
        () => current && setRead({ pageId, items: [] }),
      );
    read();
    // The page may still be opening when the first read comes.
    const later = setTimeout(read, 800);
    window.addEventListener('focus', read);
    return () => {
      current = false;
      clearTimeout(later);
      window.removeEventListener('focus', read);
    };
  }, [pageId, enabled, tick]);
  return pageId && enabled && read?.pageId === pageId ? read.items : NONE;
}

/** Closes the page and opens it again, so it is read from the files. */
export async function reloadPage(pageId: string): Promise<void> {
  const location = getLocation();
  if (location.view !== 'workspace' || location.pageId !== pageId) return;
  navigate({ ...location, pageId: null }, { replace: true, focus: 'keep' });
  await new Promise((resolve) => setTimeout(resolve, 250));
  navigate(location, { replace: true, focus: 'keep' });
  dismissExternal(pageId);
}

export function ExternalNotice() {
  const location = useLocation();
  const watching = useFlag('qol.externalEdits');
  const conflicts = useFlag('qol.conflicts');
  const pageId = location.view === 'workspace' ? location.pageId : null;
  const changed = useStore(externalStore, (state) => (pageId ? state.changed[pageId] : undefined));
  const open = useConflicts(pageId, conflicts);
  // A page.md edited while OpenNote was closed is found when its page opens.
  useEffect(() => {
    if (!pageId || !watching) return undefined;
    let current = true;
    const check = setTimeout(
      () => void hasReadableEdits(pageId).then((found) => current && found && markReadable(pageId)),
      800,
    );
    return () => {
      current = false;
      clearTimeout(check);
    };
  }, [pageId, watching]);
  if (!pageId) return null;
  const bringIn = () =>
    void bringInReadable(pageId).then(
      (changed) => (changed ? reloadPage(pageId) : dismissExternal(pageId)),
      () => dismissExternal(pageId),
    );
  const compare = () =>
    void import('./ConflictDialog').then((loaded) => loaded.openConflictDialog(pageId, open[0], open.length));
  return (
    <>
      {watching && changed === 'changed' && (
        <div className={styles.notice} role="status">
          <p>{t('qol.external.changed')}</p>
          <div className={styles.actions}>
            <Button onClick={() => void reloadPage(pageId)}>{t('qol.external.reload')}</Button>
            <Button variant="quiet" onClick={() => dismissExternal(pageId)}>
              {t('qol.external.dismiss')}
            </Button>
          </div>
        </div>
      )}
      {watching && changed === 'readable' && (
        <div className={styles.notice} role="status">
          <p>{t('qol.external.readable')}</p>
          <div className={styles.actions}>
            <Button onClick={bringIn}>{t('qol.external.bringIn')}</Button>
            <Button variant="quiet" onClick={() => dismissExternal(pageId)}>
              {t('qol.external.dismiss')}
            </Button>
          </div>
        </div>
      )}
      {conflicts && open.length > 0 && (
        <div className={styles.notice} role="status">
          <p>{t('qol.conflict.banner', { count: open.length })}</p>
          <div className={styles.actions}>
            <Button onClick={compare}>{t('qol.conflict.compare')}</Button>
          </div>
        </div>
      )}
    </>
  );
}
