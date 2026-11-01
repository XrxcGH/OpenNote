// Typeset math. A long line scrolls sideways, and a region that scrolls must be reachable from the keyboard, so it
// joins the Tab order (as a named group) only while its content overflows. The content grows after the box is laid
// out (KaTeX fonts load, content settles), which does not resize the box, so the measurement watches the content too.
import { useEffect, useRef, useState } from 'react';
import { t } from '../../../strings/t';

export function ScrollMath({
  className,
  html,
  as = 'span',
}: {
  className?: string;
  html: string;
  as?: 'span' | 'div';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    measure();
    let live = true;
    void document.fonts?.ready.then(() => live && measure());
    window.addEventListener('resize', measure);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
      if (el.firstElementChild) observer.observe(el.firstElementChild);
    }
    return () => {
      live = false;
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [html]);
  // The HTML is KaTeX output built from fixed text and numbers.
  const Tag = as as 'div';
  return (
    <Tag
      ref={ref}
      className={className}
      tabIndex={scrolls ? 0 : undefined}
      role={scrolls ? 'group' : undefined}
      aria-label={scrolls ? t('common.scrollRegion') : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
