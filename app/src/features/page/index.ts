// The page area's public face (owner after WP0: WP3).

export { PageView } from './PageView';
export { installPageZoom } from './zoom';
export { installPages } from './runtime';
export { mountedPageHooks, shownAssetUrl, shownMounted, snapshotShownPage } from './pagesApi';
export type { MountedPage, MountedPageHook } from './pagesApi';
