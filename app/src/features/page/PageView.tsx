// The page view (ARCHITECTURE.md section 5; owner after WP0: WP3). The open page's title is a heading that Enter
// in the tree moves focus to. With page.editor on, the page's blocks follow it in the viewport, and typing goes
// to the core through the sync queue; with it off, the Phase 2 placeholder stays. With no page open, a quiet
// empty state says how to start.

import { useEffect, useRef, useState } from 'react';
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
import { mountPage } from './mount';
import styles from './PageView.module.css';
import { pagesClient } from './runtime';
import { usePageZoom } from './zoom';

const LAYERS = { viewport: styles.viewport, world: styles.world, underlay: styles.underlay };

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

/** The page's blocks, mounted imperatively, so React never re-renders on a keystroke. */
function PageBody({ pageId }: { pageId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;
    pagesClient()
      .open(pageId, { viewport: null })
      .then((page) => {
        if (cancelled || !host.current) return void page.close();
        destroy = mountPage(host.current, page, { classNames: LAYERS }).destroy;
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [pageId]);
  return (
    <>
      {failed && <p role="alert">{t('page.openFailed')}</p>}
      <div ref={host} className={styles.body} />
    </>
  );
}

export function PageView() {
  const location = useLocation();
  const { page, loading } = usePage(location.view === 'workspace' ? location.pageId : null);
  const heading = useRef<HTMLHeadingElement>(null);
  const showProgress = useDelayedFlag(loading);
  const zoom = usePageZoom(page?.id ?? null);
  const editing = useFlag('page.editor');
  useEffect(() => registerRegionMain('page', () => heading.current), []);
  return (
    <article
      className={styles.page}
      data-scope="page"
      aria-busy={loading || undefined}
      style={zoom === 100 ? undefined : { zoom: zoom / 100 }}
    >
      {showProgress && <ProgressBar label={t('tree.loading.page')} />}
      <h1 ref={heading} tabIndex={-1} className={styles.title}>
        {page ? titleOf(page) : t('tree.page.noneTitle')}
      </h1>
      {page && <p className={styles.changed}>{t('tree.page.changed', { date: formatDate(page.modified) })}</p>}
      {page && editing && <PageBody key={page.id} pageId={page.id} />}
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
