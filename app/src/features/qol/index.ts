// The quality-of-life features for the shell and storage: tabs, windows, focus mode, backups, and the rest. The
// registrations are in register.ts, which features/index.ts loads; this is what other modules import.
import { lazy } from 'react';

export { QolPage } from './QolPage';
export { CloudNotice, useCloud } from './CloudNotice';
export { QOL_FLAGS } from './flags';
export { showDialog } from './dialogHost';
export { pagesClient } from './pagesApi';
export { readPrefs, writePrefs } from './prefs';
export { openInNewTab } from './tabs';
/** The notice about a page edited in another app loads when first needed. */
export const loadExternalNotice = () => import('./ExternalNotice');
/** A page in a window of its own; it loads only in that window. */
export const PageWindow = lazy(() => import('./PageWindow'));

/** Check notebook loads when first needed. */
export const loadCheckNotebook = () => import('./CheckNotebook');
