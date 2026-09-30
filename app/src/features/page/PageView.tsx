// WP0's placeholder page: the chosen page's title as the heading, or a note to choose one. Page content arrives in
// Phase 4; WP6 builds the Phase 2 placeholder with its empty states.

import { useLocation } from '../../app/location';
import { useNotes } from '../../services/notes';
import type { NodeSummary } from '../../services/notes';
import { t } from '../../strings/t';
import { useEffect, useState } from 'react';
import styles from './PageView.module.css';

function usePage(pageId: string | null): NodeSummary | null {
  const notes = useNotes();
  const [page, setPage] = useState<NodeSummary | null>(null);
  useEffect(() => {
    let current = true;
    if (pageId) void notes.get(pageId as NodeSummary['id']).then((found) => current && setPage(found));
    return () => {
      current = false;
    };
  }, [notes, pageId]);
  return pageId && page?.id === pageId ? page : null;
}

export function PageView() {
  const location = useLocation();
  const page = usePage(location.view === 'workspace' ? location.pageId : null);
  return <article className={styles.page}>{page ? <h1>{page.title}</h1> : <p>{t('tree.page.none')}</p>}</article>;
}
