// What Phase 6's page views and export read from the shown page. The pages feature (features/pages) imports only this
// file's exports through the page index: a registry of hooks that run when a page view is mounted, and a store that
// holds the shown page's view. Kept free of the page view's code, so start-up loads none of it.
import type { Registry } from '../../registries';
import { createRegistry } from '../../registries';
import { createStore } from '../../state/store';
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
