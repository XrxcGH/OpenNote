// The shape recognizer's public face.

export { recognizeShape } from './recognize';
export { dragHandle, handlesOf } from './edit';
export type { Handle } from './edit';
export { endsOf, isClosedShape, isConnector, moveEnd, nearestOnOutline } from './connect';
export type { End } from './connect';
export { LIBRARY, libraryShape } from './library';
export type { LibraryGroup, LibraryItem } from './library';
export { polygonCorners, sampleArc, sampleEllipse, shapePoints, starCorners } from './generate';
export { snapAngle, snapSegment } from './lines';
export { applyReshape, pivotOf, reshapeFor } from './reshape';
export type { Reshape } from './reshape';
export type { RecognizeOptions, Shape, ShapeKind, ShapeMatch } from './types';
