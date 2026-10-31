// The history, places, languages, and texts kit: one tool window with a tab for each tool. The window's code loads
// the first time it opens; each tool's code loads the first time its tab is shown.
import { lazy } from 'react';

export const HumanitiesKit = lazy(() => import('./ui/KitWindow').then((module) => ({ default: module.HumanitiesKit })));
export { openHumanitiesTool } from './open';
export { HUMANITIES_FLAGS } from './flags';
export type { HumanitiesFlagId } from './flags';
export { HUMANITIES_TOOLS } from './meta';
export type { HumanitiesToolId } from './meta';
