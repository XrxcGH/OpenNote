// The line under the page: the word count and reading time of the page, or of the selection, and a plain notice
// while the page is locked for reading. The count is text, not a toast, so it never interrupts typing; the
// "Announce word count" command says it aloud.
import { useEffect, useState } from 'react';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import type { MountedPage } from '../mount';
import { pageCounts } from './pageText';
import type { PageCounts } from './pageText';
import { usePrefs } from './prefs';
import { readingLock } from './stores';
import styles from './qol.module.css';
import { toggleReadingLock } from './lock';

const REFRESH_MS = 400;

function usePageCounts(mounted: MountedPage, active: boolean): PageCounts | null {
  const [counts, setCounts] = useState<PageCounts | null>(null);
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const refresh = () => setCounts(pageCounts(mounted));
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, REFRESH_MS);
    };
    refresh();
    const root = mounted.viewport.viewport;
    const stop = mounted.layer.onChange(later);
    root.addEventListener('input', later, true);
    root.ownerDocument.addEventListener('selectionchange', later);
    return () => {
      window.clearTimeout(timer);
      stop();
      root.removeEventListener('input', later, true);
      root.ownerDocument.removeEventListener('selectionchange', later);
    };
  }, [active, mounted]);
  return counts;
}

export function StatusLine({ mounted }: { mounted: MountedPage }) {
  const countFlag = useFlag('page.wordCount');
  const lockFlag = useFlag('page.readingLock');
  const wanted = usePrefs((prefs) => prefs.wordCount);
  const locked = useStore(readingLock, (value) => value) && lockFlag;
  const counts = usePageCounts(mounted, countFlag && wanted);
  const text =
    !counts || counts.page.words === 0
      ? null
      : counts.selection
        ? t('pageExtras.words.selection', { count: counts.selection.words, total: counts.page.words })
        : t('pageExtras.words.page', { count: counts.page.words, minutes: counts.page.minutes });
  return (
    <div className={styles.status}>
      {locked && (
        <span className={styles.locked}>
          {t('pageExtras.lock.chip')}
          <Button variant="quiet" onClick={() => toggleReadingLock(false)}>
            {t('pageExtras.lock.unlock')}
          </Button>
        </span>
      )}
      {countFlag && wanted && text && <span>{text}</span>}
    </div>
  );
}
