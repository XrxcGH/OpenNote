// The window-wide listeners of the appearance feature. app/start.ts installs them with the other listeners.

import { installZoomWheel } from './zoom';

/** Installs Ctrl+wheel text size. Returns a function that removes it. */
export function installAppearance(view: Window = window): () => void {
  const stops = [installZoomWheel(view)];
  return () => stops.forEach((stop) => stop());
}
