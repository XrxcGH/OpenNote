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
export type { CodeEditor } from './editor';
/** Loads the run core (features/codestudio/run, code:L03): the run host that code cells and the studio share. */
export const loadRunCore = () => import('./run');
export type { RunHost, RunResult as RunCoreResult } from './run';
/** Loads code projects' chunk (features/codestudio/project, code:L02): the page card, the store, and the exchange. */
export const loadCodeProjects = () => import('./project');

/** Loads error detection (features/codestudio/diagnostics, code:L10): the scheduler, checkers, and engine checks. */
export const loadDiagnostics = () => import('./diagnostics');

/** Loads completion without a model (features/codestudio/complete, code:L12): attachCompletion for an editor. */
export const loadCompletion = () => import('./complete');

/** Loads quick fixes (features/codestudio/fixes, code:L11): fixesFor, attachFixes, and fixAll. */
export const loadFixes = () => import('./fixes');

/** Loads plain-language error explanations (features/codestudio/explain, code:L11): explain. */
export const loadExplain = () => import('./explain');
