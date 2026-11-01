// Typeset math inside a worked step. A long line scrolls sideways, and a region that scrolls must be reachable from
// the keyboard, so it joins the Tab order only while its content overflows.
import { useEffect, useRef, useState } from 'react';

export function ScrollMath({ className, html }: { className?: string; html: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [html]);
  // The HTML is KaTeX output built from fixed text and numbers.
  return (
    <span
      ref={ref}
      className={className}
      tabIndex={scrolls ? 0 : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
