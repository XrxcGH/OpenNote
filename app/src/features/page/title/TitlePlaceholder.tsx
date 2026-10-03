// The page's heading while its blocks load (owner WP3). The tree's Enter can focus it before the world's title
// band exists, so focus passes from each placeholder to the next one, and then to the band.
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import styles from './title.module.css';

let handoff = false;

/** Whether a placeholder that held focus went away; the caller takes the focus. */
export function takeTitleFocus(placeholder: HTMLElement | null): boolean {
  const focused = handoff || (placeholder !== null && placeholder === placeholder.ownerDocument.activeElement);
  handoff = false;
  return focused;
}

export const TitlePlaceholder = forwardRef<HTMLHeadingElement | null, { title: string; changed: string | null }>(
  function TitlePlaceholder({ title, changed }, forwarded) {
    const heading = useRef<HTMLHeadingElement>(null);
    useImperativeHandle<HTMLHeadingElement | null, HTMLHeadingElement | null>(forwarded, () => heading.current, []);
    useLayoutEffect(() => {
      const element = heading.current;
      if (handoff && element) {
        element.focus();
        handoff = false;
      }
      return () => {
        if (element && element === element.ownerDocument.activeElement) handoff = true;
      };
    }, []);
    return (
      <div className={styles.band}>
        <h1 ref={heading} tabIndex={-1} className={styles.title} data-page-title="">
          {title}
        </h1>
        {changed && <p className={styles.changed}>{changed}</p>}
      </div>
    );
  },
);
