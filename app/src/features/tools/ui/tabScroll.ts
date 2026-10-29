// Keeps the chosen tab of a scrolling tab strip in view: when the strip is wider than its window, the tab the person is on
// (or has just moved to with the arrow keys) is never left half cut off at the edge.
import { useEffect } from 'react';
import type { RefObject } from 'react';

/** Scrolls the strip, not the page, so the selected tab is fully inside it. */
export function useSelectedTabInView(strip: RefObject<HTMLElement | null>, selected: string): void {
  useEffect(() => {
    const list = strip.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab) return;
    const edge = 16;
    const left = tab.offsetLeft - edge;
    const right = tab.offsetLeft + tab.offsetWidth + edge;
    if (left < list.scrollLeft) list.scrollTo({ left: Math.max(0, left) });
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth });
  }, [strip, selected]);
}
