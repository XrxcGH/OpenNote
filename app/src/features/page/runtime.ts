// The platform clients the page feature uses, set once at start-up (owner after WP0: WP3), and each page's view
// state on this device (P2-9): scroll, zoom, Canvas or Reading, and remembered block heights. Device state starts
// from the boot payload and is written back through platform.state, which Rust debounces.
import { readBoot } from '../../boot/read';
import type { PageViewState } from '../../platform/bindings/PageViewState';
import type { DeviceStateClient, PagesClient, Platform } from '../../platform/types';
import { notebookOf, treeStore } from '../tree';
import { installHistoryAdmin } from './history/admin';

/** Device state keeps the views of this many pages, dropping the least recently shown. */
export const MAX_PAGE_VIEWS = 200;

let pages: PagesClient | null = null;
let state: DeviceStateClient | null = null;
let views = new Map<string, PageViewState>();

export function installPages(platform: Pick<Platform, 'pages'> & Partial<Pick<Platform, 'state'>>): () => void {
  pages = platform.pages;
  state = platform.state ?? null;
  views = new Map(Object.entries(state ? (readBoot().state.pageViews ?? {}) : {}));
  // Delete history for pages, sections, and notebooks (A2-3, A4-12), where the page service can.
  const admin = platform.pages.admin;
  const stopAdmin = installHistoryAdmin(
    admin
      ? {
          deleteHistory: (notebook, scope, keepNamed) => admin.deleteHistory(notebook, scope, keepNamed),
          notebookOf: (page) => notebookOf(treeStore.get(), page),
        }
      : null,
  );
  return () => {
    stopAdmin();
    pages = null;
    state = null;
    views = new Map();
  };
}

export function pagesClient(): PagesClient {
  if (!pages) throw new Error('The page view needs installPages(platform) first.');
  return pages;
}

/** What this device remembers about how a page was last shown. */
export function pageView(pageId: string): PageViewState | null {
  return views.get(pageId) ?? null;
}

/** Remembers part of a page's view, and trims the oldest pages past MAX_PAGE_VIEWS. */
export function savePageView(pageId: string, patch: Partial<Omit<PageViewState, 'at'>>): void {
  const before = views.get(pageId) ?? { scrollX: 0, scrollY: 0, zoom: 1, view: null, folds: [], at: 0 };
  const next: PageViewState = { ...before, ...patch, at: Date.now() };
  views.set(pageId, next);
  const dropped: Record<string, null> = {};
  if (views.size > MAX_PAGE_VIEWS) {
    const oldest = [...views.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, views.size - MAX_PAGE_VIEWS);
    for (const [id] of oldest) {
      views.delete(id);
      dropped[id] = null;
    }
  }
  state?.update({ pageViews: { ...dropped, [pageId]: next } });
}
