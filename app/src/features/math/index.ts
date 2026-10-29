// Math's public face: the function grapher engine and the LaTeX helpers (owner after WP0: the Phase 10 lane).
// The editor, the blocks, and the screen wiring come later, so nothing here touches React or Tauri.

export * from './grapher';
export * from './grapher3d';
export * from './latex';
export { mathRenderer } from './mathHost';
export { exportGraph, exportMath } from './exportRenderers';
export { insertMath } from './insert';
export { graphOfLatex, liveAnswer } from './actions/actions';
export type { EquationGraph } from './actions/actions';
import type { GraphPopupOptions } from './graph/GraphPopup';

export type { GraphPopupOptions };

/** Opens the graph beside an equation; its code loads on first use. */
export async function openGraphPopup(options: GraphPopupOptions): Promise<void> {
  (await import('./graph/GraphPopup')).openGraphPopup(options);
}
export { graphRenderer } from './graph/renderer';
export { GraphView } from './graph/GraphView';
export { graphPicture } from './graph/picture';
export type { GraphPicture } from './graph/picture';
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
export type { KnownFunction } from './calculus';

/** The calculus tools: derivatives, integrals, limits, and sums. Their code loads on first use. */
export const loadCalculus = () => import('./calculus');
/** Check my work (step checking), loaded on first use. The AI tutor imports the same module. */
export const loadStepCheck = () => import('./stepcheck');
export type { ReasonCode, StepLine, StepResult } from './stepcheck';
/** What the tutor uses from math (ADR 0050), loaded on first use. */
export const loadTutorMath = () => import('./tutorMath');
export type { CalculusKind, Step } from './calculus/types';

/** The Math solvers window, loaded the first time it opens. */
export const loadSolversTool = () => import('./solvers/ui/SolversTool');

/** Picks the solver the Math solvers window shows, before a command opens it. */
export async function chooseSolverTab(tab: string): Promise<void> {
  const state = await import('./solvers/ui/state');
  if ((state.SOLVER_TABS as readonly string[]).includes(tab))
    state.chooseTab(tab as (typeof state.SOLVER_TABS)[number]);
}

export { Graph3DView } from './space/Graph3DView';
export { VectorsTool } from './space/tools/VectorsTool';
export { SolidsTool } from './space/tools/SolidsTool';
export { ProjectileTool } from './space/tools/ProjectileTool';
export { STARTER_3D, STARTER_CURVES } from './space/starters';
