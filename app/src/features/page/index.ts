// The page area's public face (owner after WP0: WP3).

export { PageView } from './PageView';
export { installPageZoom } from './zoom';
export { installPages } from './runtime';
export { mountedPageHooks, shownAssetUrl, shownMounted, snapshotShownPage } from './pagesApi';
export type { MountedPage, MountedPageHook } from './pagesApi';
export { shownQueue } from './sync/shown';
export { shownStrokes } from './seams/inkStrokes';
export { pageSelection } from './seams/selectionStore';
export { shownPaper } from './seams/paper';
export { transcriptActions } from './audio/transcripts/actionRegistry';
export type { TranscriptAction, TranscriptContext } from './audio/transcripts/actionRegistry';
export { usePrefs as usePageExtrasPrefs } from './qol/prefs';
export { readingLock } from './qol/stores';
export type { TableExtraDef, TableExtraHandle, TableExtraHost } from './tables/extras';
export { assetTable } from './images/assets';
export { expandEmbedText } from './embeds/expand';
export { loadEmbed } from './embeds/load';
export { preparePlayer } from './audio/exportPlayer';
