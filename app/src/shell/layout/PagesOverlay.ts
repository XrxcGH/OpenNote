// The expanded pages overlay (ARCHITECTURE.md section 11.4): a non-modal panel anchored to the notebooks pane's
// edge. Focus moves to the selected page when it opens. It closes when a page is chosen, on Escape, on a press
// outside, and whenever focus moves to an element outside it and its trigger, so it can never sit over the
// focused element. On Escape, focus goes back to where it was when the overlay opened, such as the section row.

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { layoutStore } from '../../state/layout';
import { useLayer } from '../../ui';
import { focusRegion, focusRegionSoon, regionFocusTarget } from '../regions';
import { setOverlayOpen } from './paneActions';

let returnTo: 'opener' | 'page' = 'opener';

/** Closes the overlay after the person chose a page, sending focus into the page. */
export function closeOverlayForChoice(): void {
  returnTo = 'page';
  setOverlayOpen(false);
}

const outside = (target: EventTarget | null, ...elements: (Element | null)[]) =>
  !(target instanceof Node) || !elements.some((element) => element?.contains(target));

export function usePagesOverlay(
  panel: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  const opener = useRef<HTMLElement | null>(null);
  useLayer({ kind: 'overlay', modal: false, close: () => setOverlayOpen(false) }, open);
  useEffect(() => {
    if (!open) return;
    returnTo = 'opener';
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stopFocus = focusRegionSoon('pages', 'main');
    const onFocusOut = (event: FocusEvent) => {
      // Focus that goes to nothing hasn't moved outside. That is a field or row inside the panel being removed
      // (a rename ending, a page deleted), whose replacement takes focus next, or the window losing focus.
      if (event.relatedTarget instanceof Node && outside(event.relatedTarget, panel.current, trigger.current)) {
        setOverlayOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target, panel.current, trigger.current)) setOverlayOpen(false);
    };
    const element = panel.current;
    element?.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      stopFocus();
      element?.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
      restoreFocus(element, opener.current);
    };
  }, [open, panel, trigger]);
}

/**
 * After the overlay closes: into the page after a choice. Otherwise, if focus was left inside the hidden panel or
 * dropped to <body>, back to the opener. Focus that already moved elsewhere, such as to a clicked row, stays.
 */
function restoreFocus(panel: HTMLElement | null, opener: HTMLElement | null) {
  requestAnimationFrame(() => {
    if (layoutStore.get().overlayOpen) return;
    if (returnTo === 'page') {
      focusRegion('page', 'main');
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && !panel?.contains(active)) return;
    const back = opener?.isConnected && !panel?.contains(opener) ? opener : regionFocusTarget('notebooks', 'main');
    back?.focus();
  });
}
