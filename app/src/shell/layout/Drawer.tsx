// The medium notebooks drawer (ARCHITECTURE.md section 11.4): a modal dialog that slides in from the start edge,
// with the scrim below the title bar. Focus moves to the selected row inside. Choosing a section closes it and
// moves focus to the pages pane; Escape or a click outside closes it and returns focus to the button that opened
// it. Presses on the title bar don't close it, so its controls still work while the drawer is open.

import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../strings/t';
import { Dialog } from '../../ui';
import { focusRegionSoon, regionFocusTarget, useRegion } from '../regions';
import { setDrawerOpen } from './paneActions';
import styles from './Workspace.module.css';

/** Where focus goes when the drawer closes: the pages pane after a choice, else back to the opener. */
let returnTo: 'opener' | 'pages' = 'opener';

const close = () => setDrawerOpen(false);

/** Closes the drawer after the person chose a section, sending focus to the pages pane. */
export function closeDrawerForChoice(): void {
  returnTo = 'pages';
  close();
}

/**
 * The dialog asks this where focus goes as it closes. After a choice, it is the pages pane; while the section's
 * pages are still loading, focus goes back to the opener for a moment and moves to the pages once they draw.
 */
function returnFocus(): HTMLElement | null {
  if (returnTo !== 'pages') return null;
  const target = regionFocusTarget('pages', 'main');
  if (!target) requestAnimationFrame(() => focusRegionSoon('pages', 'main'));
  return target;
}

function useCloseOnOutsidePress(inside: { current: HTMLElement | null }) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const dialog = inside.current?.closest('[role="dialog"]');
      const target = event.target instanceof Element ? event.target : null;
      if (!dialog || !target || dialog.contains(target) || target.closest('[data-title-bar]')) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [inside]);
}

export function Drawer({ children }: { children: ReactNode }) {
  const region = useRegion('notebooks');
  const inside = useRef<HTMLElement | null>(null);
  const { ref: regionRef } = region;
  const ref = useCallback(
    (element: HTMLElement | null) => {
      inside.current = element;
      return regionRef(element);
    },
    [regionRef],
  );
  useCloseOnOutsidePress(inside);
  useEffect(() => {
    returnTo = 'opener';
    // The dialog focuses its first control, if the tree has drawn one; the selected row is a better start, and
    // the tree may still be loading its rows.
    return focusRegionSoon('notebooks', 'main');
  }, []);
  return (
    <Dialog
      title={t('layout.regions.notebooks')}
      placement="start"
      size="small"
      onDismiss={close}
      returnFocus={returnFocus}
    >
      <div className={styles.drawerBody} {...region} ref={ref}>
        <div data-pane-content="notebooks">{children}</div>
      </div>
    </Dialog>
  );
}
