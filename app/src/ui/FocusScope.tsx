// Keeps Tab inside an overlay (contain), focuses its first control (autoFocus), and returns focus when it closes
// (restoreFocus). Without containment, tabbing past the last element would move focus to the host window.

import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import styles from './controls.module.css';

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]';

export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => !element.closest('[inert]'));
}

export function FocusScope(props: {
  contain: boolean;
  restoreFocus?: boolean;
  autoFocus?: boolean;
  children: ReactNode;
}) {
  const { contain, restoreFocus, autoFocus, children } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (autoFocus && ref.current) tabbables(ref.current)[0]?.focus();
    return () => {
      if (restoreFocus && previous?.isConnected) previous.focus();
    };
  }, [autoFocus, restoreFocus]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!contain || event.key !== 'Tab' || !ref.current) return;
    const items = tabbables(ref.current);
    if (items.length === 0) return;
    const [first, last] = [items[0], items[items.length - 1]];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div ref={ref} className={styles.scope} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
