// The page's blocks (owner after WP0: WP3), in the page chunk that loads after start-up: the editor, Markdown, and
// sync code stay out of the start-up bundle. They mount imperatively, so React never re-renders on a keystroke.

import { useEffect, useRef, useState } from 'react';
import { t } from '../../strings/t';
import { mountPage } from './mount';
import styles from './PageView.module.css';
import { pagesClient } from './runtime';

const LAYERS = { viewport: '', world: '', underlay: '' };

export default function PageBody({ pageId }: { pageId: string }) {
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
