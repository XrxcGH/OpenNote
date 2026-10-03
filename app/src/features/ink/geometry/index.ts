// The ink geometry's public face: pure functions over strokes, with no React, DOM, or platform code. The engine
// worker, the pen handlers, and the tests all import from here.

export type { Bounds, Capsule, InkPoint, InkTool, Matrix, Stroke, Vec } from './types';

export {
  boundsOf,
  containsBounds,
  containsPoint,
  grow,
  intersects,
  strokeBounds,
  transformBounds,
  union,
} from './bounds';
export {
  applyToPoint,
  applyToPoints,
  compose,
  determinant,
  IDENTITY,
  invert,
  isIdentity,
  rotation,
  scaling,
  translation,
  widthScale,
} from './matrix';

export {
  outlinePath,
  pencilOpacity,
  pencilWidthFactor,
  PENCIL_MAX_TILT_WIDTH,
  strokeOutline,
  tiltFraction,
  toolThinning,
} from './outline';
export type { OutlineOptions } from './outline';
export {
  applyPressureTable,
  buildPressureTable,
  DEFAULT_MINIMUM_PRESSURE,
  mapPressure,
  PRESSURE_PRESETS,
  sanitizeControls,
} from './pressure';
export type { CurveControls, PressureCurveKind, PressureSettings } from './pressure';
export { createStabilizer, PAGE_UNITS_PER_MM, stabilize, stringRadius } from './stabilizer';
export type { Stabilizer, StabilizerOptions } from './stabilizer';
export { densify, resample, simplify } from './simplify';

export { createSpatialIndex } from './spatialIndex';
export type { SpatialEntry, SpatialIndex } from './spatialIndex';
export { createStrokeIndex, drawOrder, halfWidth, pagePoints } from './strokeIndex';
export type { StrokeIndex } from './strokeIndex';
export { capsuleBounds, hitCapsules, hitPoint, strokeNearPoint, strokeTouchesCapsule } from './hitTest';

export { capsulesAlong, eraseStrokes } from './erase';
export type { StrokeEraseOptions } from './erase';
export { partialErase, splitStroke } from './partialErase';
export type { PartialEraseResult } from './partialErase';
export { lassoSelect, rectanglePath } from './lasso';
export type { LassoMode, LassoOptions } from './lasso';
export {
  bakeTransform,
  boxToBox,
  moveStrokes,
  rotateStrokes,
  scaleStrokes,
  selectionBounds,
  transformStroke,
  transformStrokes,
} from './transform';

export { recognizeShape, sampleEllipse, shapePoints, snapAngle, snapSegment } from './shapes';
export type { RecognizeOptions, Shape, ShapeKind, ShapeMatch } from './shapes';
