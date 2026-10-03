// Remembers the pages the person opens, newest first, for the quick switcher's empty query. Any way of opening a
// page counts: the tree, links, history, and the switcher itself.

import { recordRecentPage, sessionStore } from '../../state/session';

/** Starts recording. Returns a function that stops. */
export function trackRecentPages(): () => void {
  let last: string | null = null;
  return sessionStore.subscribe(() => {
    const { location } = sessionStore.get();
    const pageId = location.view === 'workspace' ? location.pageId : null;
    if (pageId === last) return;
    last = pageId;
    if (pageId) recordRecentPage(pageId);
  });
}
