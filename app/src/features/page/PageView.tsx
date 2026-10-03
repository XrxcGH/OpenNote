// The page view (ARCHITECTURE.md section 5; owner after WP0: WP3). The open page's title is a heading that Enter
// in the tree moves focus to. With page.editor on, the page's blocks follow it in the viewport, and typing goes
// to the core through the sync queue; with it off, the Phase 2 placeholder stays. With no page open, a quiet
// empty state says how to start.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useFlag } from '../../app/flags';
import { useLocation } from '../../app/location';
import { useNotes } from '../../services/notes';
import type { NodeId, NodeSummary } from '../../services/notes';
import { registerRegionMain } from '../../shell/regions';
import { formatDate } from '../../strings/format';
import { t } from '../../strings/t';
import { ProgressBar, useDelayedFlag } from '../../ui';
import { titleOf, useTreeNode } from '../tree';
import { EmptyPageArt } from './EmptyPageArt';
import styles from './PageView.module.css';
import { usePageZoom } from './zoom';

/** The editor, Markdown, and sync code load in the page chunk, after start-up. */
const PageBody = lazy(() => import('./PageBody'));

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
  const editing = useFlag('page.editor');
  const shown = editing && page !== null;
  const zoom = usePageZoom(shown ? null : (page?.id ?? null));
  useEffect(() => registerRegionMain('page', () => heading.current), []);
  const titleBlock = (
    <>
      <h1 ref={heading} tabIndex={-1} className={styles.title}>
        {page ? titleOf(page) : t('tree.page.noneTitle')}
      </h1>
      {page && <p className={styles.changed}>{t('tree.page.changed', { date: formatDate(page.modified) })}</p>}
    </>
  );
  return (
    <article
      className={shown ? styles.editing : styles.page}
      data-scope="page"
      aria-busy={loading || undefined}
      style={zoom === 100 ? undefined : { zoom: zoom / 100 }}
    >
      {showProgress && <ProgressBar label={t('tree.loading.page')} />}
      {shown ? <header className={styles.header}>{titleBlock}</header> : titleBlock}
      {shown && (
        <Suspense fallback={null}>
          <PageBody key={page.id} pageId={page.id} />
        </Suspense>
      )}
      {page && !editing && <p className={styles.note}>{t('tree.page.empty')}</p>}
      {!page && !loading && (
        <div className={styles.empty}>
          <EmptyPageArt />
          <p className={styles.note}>{t('tree.page.none')}</p>
        </div>
      )}
    </article>
  );
}
