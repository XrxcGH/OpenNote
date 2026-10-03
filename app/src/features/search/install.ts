// Start-up for search and linking: gives the feature its client, sends the tree's titles to the index, settles a
// page's title when the person leaves the page, and hands the link edits a rename plans to rename.ts, which loads
// when the first one comes.
import { isEnabled } from '../../app/flags';
import { getLocation, onNavigate } from '../../app/location';
import type { Platform } from '../../platform/types';
import type { NotesService } from '../../services/notes/types';
import type { IndexUpdate } from '../../services/search/types';
import { setSearchClient } from './client';
import { startTitleFeed } from './feed';
import type { TitleFeed } from './feed';

let running: TitleFeed | null = null;

/** Resolves once the index knows the tree's pages and titles. Search waits for it, so a first search is whole. */
export function titlesReady(): Promise<void> {
  return running ? running.ready() : Promise.resolve();
}

let linkLayerLoading = false;

/**
 * The link layer joins the editor kit, which belongs to the page chunk, so it loads when a page is first shown and
 * not at start-up: the chunk that holds the kit would otherwise load before the first paint.
 */
function loadLinkLayer(): void {
  if (linkLayerLoading || !isEnabled('search.links')) return;
  linkLayerLoading = true;
  void import('./links/registerEditor');
}

function pageIdOf(location: { view: string; pageId?: string | null }): string | null {
  return location.view === 'workspace' ? (location.pageId ?? null) : null;
}

/** Wires search and linking to the app. Returns a function that undoes it. */
export function installSearch(platform: Platform, notes: NotesService): () => void {
  setSearchClient(platform.search);
  if (pageIdOf(getLocation()) !== null) loadLinkLayer();
  const handle = (update: IndexUpdate) => {
    const plans = update.renames ?? [];
    if (plans.length === 0) return;
    void import('./rename').then(({ applyRename }) => plans.forEach((plan) => void applyRename(platform, plan)));
  };
  // A host that reads the notebooks itself needs no feed of the tree's titles.
  const feed = platform.search.capabilities.feed ? startTitleFeed(platform.search, notes) : null;
  running = feed;
  const stops = [
    () => feed?.stop(),
    platform.search.onUpdate(handle),
    // Links follow a new title once the person is done with it, which leaving the page says. The tree may have
    // renamed the page a moment ago, so the index hears the tree first.
    onNavigate(({ from, to }) => {
      if (pageIdOf(to) !== null) loadLinkLayer();
      const left = pageIdOf(from);
      if (!left || left === pageIdOf(to)) return;
      void (feed?.flush() ?? Promise.resolve()).then(() => platform.search.titleSettled(left)).catch(() => undefined);
    }),
  ];
  return () => {
    stops.forEach((stop) => stop());
    running = null;
    setSearchClient(null);
  };
}
