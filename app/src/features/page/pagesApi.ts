// What Phase 6's page views and export read from the shown page. The pages feature (features/pages) imports only this
// file's exports through the page index: a registry of hooks that run when a page view is mounted, and a store that
// holds the shown page's view. Kept free of the page view's code, so start-up loads none of it.
import type { Registry } from '../../registries';
import { createRegistry } from '../../registries';
import { setSaveRecovery } from '../../services/pages/saveHealth';
import { createStore } from '../../state/store';
import { dismissActionToasts } from '../../state/toasts';
import type { MountedPage } from './mount';

export type { MountedPage } from './mount';

/** A package that attaches to every mounted page view, such as Phase 6's paginated view. */
export interface MountedPageHook {
  id: string;
  /** Runs once the page view is assembled. Returns a function that detaches again. */
  attach(mounted: MountedPage): () => void;
}

export const mountedPageHooks: Registry<MountedPageHook> = createRegistry<MountedPageHook>('mounted page hooks');

/** The page view that is shown, or null. Set beside the other shown stores. */
export const shownMounted = createStore<MountedPage | null>(null, 'shown mounted page');
// An Undo toast belongs to the page it came from.
shownMounted.subscribe(() => dismissActionToasts({ pageChange: true }));

/** Runs every hook for a freshly mounted page view. Returns a function that detaches them all. */
export function attachMountedPageHooks(mounted: MountedPage): () => void {
  const detach = mountedPageHooks.list().map((hook) => {
    try {
      return hook.attach(mounted);
    } catch (error) {
      console.error(`The mounted page hook ${hook.id} failed.`, error);
      return () => undefined;
    }
  });
  return () => detach.reverse().forEach((stop) => stop());
}

/** The shown page as page.json data, or null when no page view is mounted. Loads the snapshot code on first use. */
export async function snapshotShownPage(title: string): Promise<import('../../services/pages/types').PageJson | null> {
  const mounted = shownMounted.get();
  if (!mounted) return null;
  const { snapshotPage } = await import('./snapshot');
  return snapshotPage(mounted, title);
}

/** The URL an asset of the shown page loads from, or null when no page is shown. */
export function shownAssetUrl(asset: string): string | null {
  return shownMounted.get()?.page.assetUrl(asset) ?? null;
}

// The save notice (features/tree) retries the shown page and copies its text through this, so the tree needs no
// import of the page view. Only the shown page is open in this window, so any other page answers "not here".
setSaveRecovery({
  holds: (page) => shownMounted.get()?.page.id === page,
  async retry(page) {
    const mounted = shownMounted.get();
    if (mounted?.page.id !== page) return false;
    // The core takes no edits while the page's file is read-only, so what was typed since waits in the editors. The
    // first save finds the file writable again, the flush sends what waited, and the second save writes it.
    await mounted.page.saveNow();
    await mounted.sync.flushAll('save');
    await mounted.page.saveNow();
    return true;
  },
  async text(page) {
    if (shownMounted.get()?.page.id !== page) return null;
    const json = await snapshotShownPage('');
    if (!json) return null;
    const blocks = json.blocks.filter((block) => block.type === 'text');
    blocks.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    return blocks.map((block) => String(block.data.markdown ?? '')).join('\n\n');
  },
});
