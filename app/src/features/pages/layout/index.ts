// The page layout model: a page's view settings, the geometry they stand for, and the plan that places a page's flowing
// and floating blocks on sheets. Pure TypeScript over page units, with no DOM.

export * from './view';
export * from './edit';
export * from './layouts';
export { MIN_COLUMN, columnOf, pageLayout, resolveBackground, screenLayout } from './page';
export type { Column, PageLayout, TemplateLookup } from './page';
export { displayY, naturalY, planFlow, slicesBySheet } from './flow';
export type { FlowPiece, FlowPlan, FlowSlice } from './flow';
export { floatingBySheet, planFloating } from './freeform';
export type { FloatingItem, FloatingPlan, FloatingSlice } from './freeform';
export { planPage } from './plan';
export type { PageContent, PagePlan, SheetPlan } from './plan';
export { applyPatch, diffPatch, mergeLayers } from './json';
export type { Json, JsonObject } from './json';
