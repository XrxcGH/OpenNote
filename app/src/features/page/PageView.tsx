// The Phase 2 page placeholder (ARCHITECTURE.md section 13): the open page's title as a heading that Enter in the
// tree moves focus to, when it was last changed, and a line that says writing and drawing come later. With no
// page open, a heading, and a prompt to choose one. Page content arrives in Phase 4.

import { useEffect, useRef, useState } from 'react';
import { useLocation } from '../../app/location';
import { useNotes } from '../../services/notes';
import type { NodeId, NodeSummary } from '../../services/notes';
import { registerRegionMain } from '../../shell/regions';
import { formatDate } from '../../strings/format';
import { t } from '../../strings/t';
import { EmptyArt, ProgressBar, useDelayedFlag } from '../../ui';
import { titleOf, useTreeNode } from '../tree';
import styles from './PageView.module.css';
import { usePageZoom } from './zoom';

/** The page from the tree store, else from the service, which happens for a page the tree hasn't listed yet. */
function usePage(pageId: NodeId | null): { page: NodeSummary | null; loading: boolean } {
  const notes = useNotes();
  const known = useTreeNode(pageId);
  const [fetched, setFetched] = useState<NodeSummary | null>(null);
  useEffect(() => {
    if (!pageId || known) return;
    let current = true;
    void notes.get(pageId).then((found) => current && setFetched(found));
    return () => {
      current = false;
    };
  }, [notes, pageId, known]);
  const page = known ?? (fetched?.id === pageId ? fetched : null);
  return { page, loading: pageId !== null && page === null && fetched?.id !== pageId };
}

export function PageView() {
  const location = useLocation();
  const { page, loading } = usePage(location.view === 'workspace' ? location.pageId : null);
  const heading = useRef<HTMLHeadingElement>(null);
  const showProgress = useDelayedFlag(loading);
  const zoom = usePageZoom(page?.id ?? null);
  useEffect(() => registerRegionMain('page', () => heading.current), []);
  return (
    <article
      className={styles.page}
      aria-busy={loading || undefined}
      style={zoom === 100 ? undefined : { zoom: zoom / 100 }}
    >
      {showProgress && <ProgressBar label={t('tree.loading.page')} />}
      <h1 ref={heading} tabIndex={-1}>
        {page ? titleOf(page) : t('tree.page.noneTitle')}
      </h1>
      {page ? (
        <>
          <p>{t('tree.page.changed', { date: formatDate(page.modified) })}</p>
          <p>{t('tree.page.empty')}</p>
        </>
      ) : (
        !loading && (
          <>
            <EmptyArt kind="page" className={styles.art} />
            <p className={styles.none}>{t('tree.page.none')}</p>
          </>
        )
      )}
    </article>
  );
}
