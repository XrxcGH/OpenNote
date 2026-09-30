// Focus through layout changes (ARCHITECTURE.md section 11.6). When the size class changes, a pane collapses, the
// drawer closes, or the compact stack changes screens, focus stays on the same item if it is still visible, and
// otherwise moves to the main control of the region that held it, never to <body>. At start-up, focus goes to the
// selected page's row once the tree has drawn it, so keyboard users start oriented.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { getLocation } from '../../app/location';
import { updateLayout } from '../../state/layout';
import type { CompactScreen, SizeClass } from '../../state/layout';
import { focusRegion, repairFocus } from '../regions';
import type { PaneLayout } from './solvePanes';
import { compactScreenFor } from './useLayoutFollowsNavigation';

/** How long start-up waits for the tree to draw before it stops trying to place focus. */
const STARTUP_WAIT_MS = 2000;

function focusStart(): boolean {
  if (document.activeElement && document.activeElement !== document.body) return true;
  if (getLocation().view !== 'workspace') return focusRegion('page', 'main');
  return focusRegion('pages', 'main') || focusRegion('notebooks', 'main');
}

/** Places focus at start-up, trying again as the panes fill in, until it lands or the person moves it. */
function useStartupFocus() {
  useEffect(() => {
    if (focusStart()) return;
    const observer = new MutationObserver(() => {
      if (focusStart()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), STARTUP_WAIT_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);
}

export function useWorkspaceFocus(layout: PaneLayout, sizeClass: SizeClass, compactScreen: CompactScreen): void {
  const shown = useRef<string | null>(null);
  useStartupFocus();
  // Entering the compact layout shows the screen that fits the location.
  useLayoutEffect(() => {
    if (sizeClass === 'compact') updateLayout({ compactScreen: compactScreenFor(getLocation()) });
  }, [sizeClass]);
  useLayoutEffect(() => {
    const key = [sizeClass, layout.notebooks.mode, layout.pages.mode, compactScreen].join(' ');
    const previous = shown.current;
    shown.current = key;
    // Start-up focus is placed above, once the panes have drawn; only a change of layout repairs focus.
    if (previous !== null && previous !== key) repairFocus(sizeClass === 'compact' ? compactScreen : undefined);
  }, [sizeClass, layout.notebooks.mode, layout.pages.mode, compactScreen]);
}
