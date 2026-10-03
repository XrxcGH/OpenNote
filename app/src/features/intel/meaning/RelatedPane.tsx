// The Related pages list beside the page: the pages most like the one that is open, found from the vector index on
// this device. It follows the page as the person moves, and the page stays usable beside it. Like the linked pages
// pane, it has no slot in the workspace grid, so it renders in a root of its own.
import { useEffect, useId } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { useLocation } from '../../../app/location';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { openPageById } from '../openPage';
import styles from '../plus.module.css';
import { loadSavedIndex, meaningState, relatedPages, startIndexing } from './engine';

function Related({ onClose }: { onClose(): void }) {
  const where = useLocation();
  const pageId = where.view === 'workspace' ? where.pageId : null;
  const state = useStore(meaningState, (current) => current);
  const headingId = useId();
  useEffect(() => {
    void loadSavedIndex().then(() => startIndexing());
  }, []);
  const hits = pageId ? relatedPages(pageId) : [];
  return (
    <section aria-labelledby={headingId} className={styles.stack}>
      <div className={styles.itemHead}>
        <h2 id={headingId} className={styles.heading}>
          {t('intelPlus.meaning.relatedTitle')}
        </h2>
        <Button variant="quiet" onClick={onClose}>
          {t('intelPlus.meaning.close')}
        </Button>
      </div>
      {state.running && (
        <p className={styles.help} role="status">
          {t('intelPlus.meaning.progress', { done: state.done, total: state.total })}
        </p>
      )}
      {hits.length > 0 ? (
        <ul className={styles.list}>
          {hits.map((hit) => (
            <li key={hit.pageId}>
              <button type="button" className={styles.linkButton} onClick={() => void openPageById(hit.pageId)}>
                <strong>{hit.title || t('intelPlus.meaning.untitled')}</strong>
                {hit.chunk && <span className={styles.help}> {hit.chunk.text.slice(0, 100)}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.help}>
          {pageId ? t('intelPlus.meaning.relatedNone') : t('intelPlus.meaning.relatedNoPage')}
        </p>
      )}
    </section>
  );
}

let host: HTMLElement | null = null;
let root: Root | null = null;
let opener: HTMLElement | null = null;

export function closeRelatedPages(): void {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  if (opener?.isConnected) opener.focus();
  opener = null;
}

/** Shows the pane, or closes it when it is showing. */
export function toggleRelatedPages(): void {
  if (host) {
    closeRelatedPages();
    return;
  }
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  host = document.body.appendChild(document.createElement('div'));
  host.className = styles.sheet ?? '';
  host.dataset['region'] = 'related-pages';
  root = createRoot(host);
  root.render(<Related onClose={closeRelatedPages} />);
}
