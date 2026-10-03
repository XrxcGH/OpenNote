// Asks for the name of a custom tag. The dialog is a lazy chunk, so it costs nothing until it is wanted.
import { lazy } from 'react';
import { showOverlay } from '../../../shell/commandbar/overlays';

const LazyCustomTag = lazy(() => import('./CustomTag'));

/** Resolves with the name typed, or null when the person cancels. */
export function askCustomTag(): Promise<string | null> {
  return new Promise((resolve) => showOverlay('search-custom-tag', LazyCustomTag, { resolve }));
}
