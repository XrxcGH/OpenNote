// The window-wide listeners of the appearance feature. app/start.ts installs them with the other listeners.

import { installDensity } from './density';
import { installZoomWheel } from './zoom';

/** Installs density and Ctrl+wheel text size. Returns a function that removes them. */
export function installAppearance(view: Window = window): () => void {
  const stops = [installDensity(view), installZoomWheel(view)];
  return () => stops.forEach((stop) => stop());
}
