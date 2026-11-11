// The code studio's public face: what other features may import.
// Owner: code:L00. The contracts are the shared types of every code lane; the window loader keeps the window in
// a lazy chunk of its own for the tool window host.

export * from './contracts';

/** Loads the studio window's chunk (features/codestudio/window, code:L04). */
export const loadCodeStudioWindow = () => import('./window');

/** Loads the code editor's chunk (features/codestudio/editor, code:L01): createCodeEditor and the diff view. */
export const loadCodeEditor = () => import('./editor');
