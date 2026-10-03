// The page's blocks (owner after WP0: WP3), in the page chunk that loads after start-up: the editor, Markdown, and
// sync code stay out of the start-up bundle. They mount imperatively, so React never re-renders on a keystroke.

import { useEffect, useRef, useState } from 'react';
import { useFlag } from '../../app/flags';
import { getSizeClass } from '../../state/layout';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { mountPage } from './mount';
import styles from './PageView.module.css';
import { pagesClient, pageView } from './runtime';
import type { MountedPage } from './mount';
import paneStyles from './readingOrder/pane.module.css';
import { ReadingOrderPane } from './readingOrder/ReadingOrderPane';
import { takeTitleFocus, TitlePlaceholder } from './title/TitlePlaceholder';
import { readingOrderOpen } from './viewport/shown';

const LAYERS = { viewport: '', world: '', underlay: '' };

export interface PageBodyProps {
  pageId: string;
  /** The tree's name for the page, shown when the page itself has no title yet. */
  title: string;
  changed: string | null;
}

export default function PageBody({ pageId, title, changed }: PageBodyProps) {
  const host = useRef<HTMLDivElement>(null);
  const placeholder = useRef<HTMLHeadingElement | null>(null);
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
          title: { text: page.initial.title || title, changed },
          compact: getSizeClass() === 'compact',
          savedView: pageView(page.id)?.view ?? null,
        });
        destroy = mounted.destroy;
        if (takeTitleFocus(placeholder.current)) mounted.title?.heading.focus();
        setMounted(mounted);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      void destroy?.();
    };
    // The title and the changed line are read once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
  return (
    <>
      {failed && <p role="alert">{t('page.openFailed')}</p>}
      {!mounted && !failed && <TitlePlaceholder ref={placeholder} title={title} changed={changed} />}
      <div className={paneStyles.row}>
        <div ref={host} className={styles.body} />
        {mounted && paneOpen && <ReadingOrderPane mounted={mounted} onClose={() => readingOrderOpen.set(false)} />}
      </div>
    </>
  );
}
