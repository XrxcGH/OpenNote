// The stroke model: records to strokes and back, the page's stroke table, and recolor and width edits.

export { canEncode, recordBounds, recordFromStroke, strokeFromRecord } from './convert';
export { recolor, scaledWidth, scaleWidths, setDrawnWidth, THICKER, THINNER } from './restyle';
export type { PickedColor } from './restyle';
export { applyProps, applyRecord, foldRecords } from './table';
export type { StrokeTable } from './table';
export type { InkStroke } from './types';
