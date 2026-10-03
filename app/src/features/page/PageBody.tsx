// The page's blocks (owner after WP0: WP3), in the page chunk that loads after start-up: the editor, Markdown, and
// sync code stay out of the start-up bundle. They mount imperatively, so React never re-renders on a keystroke.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useFlag } from '../../app/flags';
import { useNotes } from '../../services/notes';
import type { NodeId } from '../../services/notes';
import { getSizeClass } from '../../state/layout';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { mountPage } from './mount';
import type { MountedPage } from './mount';
import extrasStyles from './qol/qol.module.css';
import styles from './PageView.module.css';
import { pagesClient, pageView } from './runtime';
import paneStyles from './readingOrder/pane.module.css';
import { ReadingOrderPane } from './readingOrder/ReadingOrderPane';
import { returnBand } from './title/TitleSlot';
import { readingOrderOpen } from './viewport/shown';

const LAYERS = { viewport: '', world: '', underlay: '' };

/** The Find bar, the status line, and the table of contents load after the page. */
const PageExtras = lazy(() => import('./qol/PageExtras'));

function Extras({ mounted, slot }: { mounted: MountedPage; slot: 'top' | 'bottom' | 'side' }) {
  return (
    <Suspense fallback={null}>
      <PageExtras mounted={mounted} slot={slot} />
    </Suspense>
  );
}

export interface PageBodyProps {
  pageId: string;
  /** The tree's name for the page, shown when the page itself has no title yet. */
  title: string;
  /**
   * The page's title as the tree has it, which may be empty. The heading and the name in the tree are one title:
   * typing in the heading renames the page, and renaming it in the tree changes the heading.
   */
  treeTitle: string;
  changed: string | null;
  /** The title band the page view shows while the page loads; the world adopts it. */
  band: HTMLElement | null;
}

export default function PageBody({ pageId, title, treeTitle, changed, band }: PageBodyProps) {
  const notes = useNotes();
  const host = useRef<HTMLDivElement>(null);
  const named = useRef(treeTitle);
  const [failed, setFailed] = useState(false);
  const [mounted, setMounted] = useState<MountedPage | null>(null);
  const paneWanted = useStore(readingOrderOpen, (open) => open);
  const paneAllowed = useFlag('page.readingOrder');
  const paneOpen = paneWanted && paneAllowed;
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;
    pagesClient()
      .open(pageId, { viewport: null })
      .then((page) => {
        if (cancelled || !host.current) return void page.close();
        const mounted = mountPage(host.current, page, {
          classNames: LAYERS,
          title: {
            text: treeTitle.trim() || page.initial.title || title,
            changed,
            band,
            onSend: (sent) => {
              if (!sent || sent === named.current) return;
              named.current = sent;
              notes.rename(pageId as NodeId, sent).catch(() => {});
            },
          },
          compact: getSizeClass() === 'compact',
          savedView: pageView(page.id)?.view ?? null,
        });
        destroy = mounted.destroy;
        setMounted(mounted);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      // The band goes back beside the page at once, before the page's slower teardown.
      if (band) returnBand(band);
      void destroy?.();
    };
    // The title and the changed line are read once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
  // A rename in the tree shows in the heading, unless the person is typing in it.
  useEffect(() => {
    named.current = treeTitle;
    if (treeTitle.trim()) mounted?.title?.setTitle(treeTitle);
  }, [mounted, treeTitle]);
  return (
    <>
      {failed && <p role="alert">{t('page.openFailed')}</p>}
      <div className={paneStyles.row}>
        <div className={extrasStyles.column}>
          {mounted && <Extras mounted={mounted} slot="top" />}
          <div ref={host} className={styles.body} />
          {mounted && <Extras mounted={mounted} slot="bottom" />}
        </div>
        {mounted && paneOpen && <ReadingOrderPane mounted={mounted} onClose={() => readingOrderOpen.set(false)} />}
        {mounted && <Extras mounted={mounted} slot="side" />}
      </div>
    </>
  );
}
