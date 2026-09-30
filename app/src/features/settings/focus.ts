// Settings' focus rules (ARCHITECTURE.md section 16.1).
// - Opening Settings, and choosing a section, moves focus to the heading.
// - Leaving returns focus to the element that opened Settings, or else into the part of the window it was in.
// - Escape leaves only when focus isn't in a text field and no menu, popover, or dialog is open.

import { goBack, navigate } from '../../app/location';
import { hasOpenLayer } from '../../state/layers';
import { focusRegion } from '../../shell/regions';
import type { RegionId } from '../../shell/regions';

/** Goes back to where the person was, or to the notebooks when there is no history. */
export function leaveSettings(): void {
  if (!goBack()) navigate({ view: 'workspace', notebookId: null, sectionId: null, pageId: null });
}

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Whether an Escape key press should leave Settings: nothing else wants it. */
export function escapeLeaves(event: { key: string; defaultPrevented: boolean; target: EventTarget | null }): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || hasOpenLayer()) return false;
  return !(event.target instanceof Element && event.target.closest(TEXT_ENTRY));
}

const REGIONS: readonly RegionId[] = ['titleBar', 'commandBar', 'notebooks', 'pages', 'page'];

/**
 * Notes where focus is now. The returned function puts it back once Settings is gone and the window it replaced is
 * back on screen. It does nothing if focus already went somewhere outside the window's regions, such as a dialog.
 */
export function rememberOpener(): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const region = opener?.closest('[data-region]')?.getAttribute('data-region') as RegionId | undefined;
  return () => {
    const restore = () => {
      // The workspace's own start-up focus may have landed in a region already; the opener beats that.
      const now = document.activeElement;
      if (now && now !== document.body && !now.closest('[data-region]')) return;
      if (opener?.isConnected && opener !== document.body) return opener.focus();
      const order =
        region && REGIONS.includes(region) ? [region, 'notebooks', 'page'] : (['notebooks', 'page'] as const);
      order.some((id) => focusRegion(id as RegionId, 'main'));
    };
    requestAnimationFrame(() => requestAnimationFrame(restore));
  };
}
