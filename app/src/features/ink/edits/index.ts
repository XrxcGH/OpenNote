// Edits: erase gestures and the filters that limit what the erasers and the lasso touch.

export { createPartialEraseSession, createStrokeEraseSession } from './eraseSession';
export type {
  EraseOptions,
  EraseTransaction,
  PartialEraseSession,
  StrokeEraseSession,
  ViewChange,
} from './eraseSession';
export {
  eraserAccepts,
  eraserSkip,
  ERASE_ALL,
  lassoAcceptsStroke,
  LASSO_EVERYTHING,
  lassoSkip,
  strokeKind,
} from './filters';
export type { EraserFilter, LassoFilter, StrokeKind } from './filters';
