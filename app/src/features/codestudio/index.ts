// The code studio's public face: what other features may import.
// Owner: code:L00. The contracts are the shared types of every code lane; the window loader keeps the window in
// a lazy chunk of its own for the tool window host.

export * from './contracts';

/** Loads the studio window's chunk (features/codestudio/window, code:L04). */
export const loadCodeStudioWindow = () => import('./window');

/** The Code group of the Models panel, with the runtime packs (features/codestudio/packs, code:L18). */
export const loadCodeDownloads = () => import('./packs/CodeDownloads');
export type { CodeDownloadsStyles } from './packs/CodeDownloads';
export { packFileUrl } from './packs/client';

/** Settings, then Code, then Downloads: opens the Models panel at its Code group. */
export const openCodeDownloads = () => import('./packs/store').then((module) => module.openCodeDownloads());

/** Loads the code editor's chunk (features/codestudio/editor, code:L01): createCodeEditor and the diff view. */
export const loadCodeEditor = () => import('./editor');
