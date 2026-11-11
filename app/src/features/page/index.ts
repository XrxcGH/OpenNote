// The page area's public face (owner after WP0: WP3).

export { PageView } from './PageView';
export { installPageZoom } from './zoom';
export { saveStyles, stylesFor } from './styles/store';
export { installPages } from './runtime';
export { mountedPageHooks, shownAssetUrl, shownMounted, snapshotShownPage } from './pagesApi';
/** The editor that formatting commands act on (a light module). */
export { targetEditor } from './formattingBar/target';
/** Reading pages and making pages from templates or text loads when first used, so start-up stays small. */
export const loadTemplates = () => import('./templates/apply');
/** The page on screen as a Replace in all notebooks target, which takes the batch through the page's own queue. */
export const loadReplaceTarget = () => import('./find/replaceTarget');
export type { MountedPage, MountedPageHook } from './pagesApi';
export { shownQueue } from './sync/shown';
export { shownStrokes } from './seams/inkStrokes';
export { pageSelection } from './seams/selectionStore';
export { shownPaper } from './seams/paper';
export { shownPaginated } from './seams/paginated';
export { textSeams } from './textSeams';
export { transcriptActions } from './audio/transcripts/actionRegistry';
export type { TranscriptAction, TranscriptContext } from './audio/transcripts/actionRegistry';
export { usePrefs as usePageExtrasPrefs } from './qol/prefs';
export { readingLock } from './qol/stores';
export type { TableExtraDef, TableExtraHandle, TableExtraHost } from './tables/extras';
export { assetTable } from './images/assets';
/** The exporter's helpers load when a page is exported, not at start-up. */
export const expandEmbedText = async (...args: Parameters<typeof import('./embeds/expand').expandEmbedText>) =>
  (await import('./embeds/expand')).expandEmbedText(...args);
export const loadEmbed = async (...args: Parameters<typeof import('./embeds/load').loadEmbed>) =>
  (await import('./embeds/load')).loadEmbed(...args);
export const preparePlayer = async (...args: Parameters<typeof import('./audio/exportPlayer').preparePlayer>) =>
  (await import('./audio/exportPlayer')).preparePlayer(...args);
