// Math's public face: the function grapher engine and the LaTeX helpers (owner after WP0: the Phase 10 lane).
// The editor, the blocks, and the screen wiring come later, so nothing here touches React or Tauri.

export * from './grapher';
export * from './latex';
export { mathRenderer } from './mathHost';
export { insertMath } from './insert';
export { graphRenderer } from './graph/renderer';
export { GraphView } from './graph/GraphView';
export { readGraph, writeGraph } from './graph/source';
export type { GraphSource } from './graph/source';
