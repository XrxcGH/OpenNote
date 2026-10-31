// The psychology and behavior kit's public face: the command that opens its window, the window itself (loaded on
// first use), and its tool list for the command palette.
export { openMindKit } from './open';
export { MIND_TOOLS } from './meta';

/** The kit window, loaded the first time it opens. */
export const loadMindKit = () => import('./ui/MindKit');
