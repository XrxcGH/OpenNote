// The seams Phase 5 builds on (ARCHITECTURE.md section 25; PLAN.md section 3.7). This file is the only path Phase 5
// imports from the page feature; WP0 fixed its exports, and WP3 owns what is behind them.
export type { Camera, GestureKind, Point } from '../viewport/camera';
export type { PageViewportApi } from '../viewport/viewport';
export type { PointerToolDef, RouterContext } from '../viewport/router';
export type { PageSelection } from './selectionStore';
export type { TextGeometry } from './geometry';
export { usePageViewport } from '../viewport/viewport';
export { registerPointerTool, setActiveTool } from '../viewport/router';
export { pageSelection, selectOnPage } from './selectionStore';
export { textGeometry, onBlockLayout } from './geometry';
export { appendToNextBatch, setFlushGate } from '../sync';
export { blockRenderers, clipboardFormats, readingItemProviders } from '../registries';
export { editorExtensions } from '../../../editor/extensions/kit';
