// Math's public face: the function grapher engine and the LaTeX helpers (owner after WP0: the Phase 10 lane).
// The editor, the blocks, and the screen wiring come later, so nothing here touches React or Tauri.

export * from './grapher';
export * from './latex';
export { mathRenderer } from './mathHost';
export { exportGraph, exportMath } from './exportRenderers';
export { insertMath } from './insert';
export { graphRenderer } from './graph/renderer';
export { GraphView } from './graph/GraphView';
export { readGraph, writeGraph } from './graph/source';
export type { GraphSource } from './graph/source';
export { applyQuickMath, browserLocale, quickMathEnabled, setQuickMathEnabled } from './quickMath';
export { default as QuickMathSetting } from './QuickMathSetting';
export { mountMindMap } from './mindmap/mount';
export { newNode, parseOutline, toOutline } from './mindmap/tree';
export type { MapNode } from './mindmap/tree';
export { mountDiagram } from './diagram/mount';
export { STARTER_TEXT, fallbackOf } from './diagram/kind';
export { drawDiagram } from './diagram/render';

/** The Math solvers window, loaded the first time it opens. */
export const loadSolversTool = () => import('./solvers/ui/SolversTool');

/** Picks the solver the Math solvers window shows, before a command opens it. */
export async function chooseSolverTab(tab: string): Promise<void> {
  const state = await import('./solvers/ui/state');
  if ((state.SOLVER_TABS as readonly string[]).includes(tab))
    state.chooseTab(tab as (typeof state.SOLVER_TABS)[number]);
}
