// Keeps Tab inside an overlay (contain), focuses its first control (autoFocus), and returns focus when it closes
// (restoreFocus). Without containment, tabbing past the last element would move focus to the host window.

import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { tabbables } from './tabbable';

export { tabbables } from './tabbable';

/** The element Tab or Shift+Tab should wrap to, or null when the browser's own move stays inside. */
export function wrapTarget(items: readonly HTMLElement[], active: Element | null, back: boolean): HTMLElement | null {
  if (items.length === 0) return null;
  const index = items.indexOf(active as HTMLElement);
  if (back && index <= 0) return items[items.length - 1];
  if (!back && (index === -1 || index === items.length - 1)) return items[0];
  return null;
}

export function FocusScope(props: {
  contain: boolean;
  restoreFocus?: boolean;
  autoFocus?: boolean;
  children: ReactNode;
}) {
  const { contain, restoreFocus, autoFocus, children } = props;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const scope = ref.current;
    if (autoFocus && scope) tabbables(scope)[0]?.focus();
    return () => {
      const inside = scope?.contains(document.activeElement) || document.activeElement === document.body;
      if (restoreFocus && inside && previous?.isConnected) previous.focus();
    };
  }, [autoFocus, restoreFocus]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!contain || event.key !== 'Tab' || event.ctrlKey || event.altKey || !ref.current) return;
    const target = wrapTarget(tabbables(ref.current), document.activeElement, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
  return (
    <div ref={ref} style={{ display: 'contents' }} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
