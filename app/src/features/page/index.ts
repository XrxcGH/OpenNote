// The page area's public face (owner after WP0: WP3).

export { PageView } from './PageView';
export { installPageZoom } from './zoom';
export { installPages } from './runtime';
export { mountedPageHooks, shownAssetUrl, shownMounted, snapshotShownPage } from './pagesApi';
export type { MountedPage, MountedPageHook } from './pagesApi';
export { pageSelection } from './seams/selectionStore';
export { usePrefs as usePageExtrasPrefs } from './qol/prefs';
export { readingLock } from './qol/stores';
export type { TableExtraDef, TableExtraHandle, TableExtraHost } from './tables/extras';
