// Input: samples to strokes, palm rejection, pen buttons, and gestures.

export { normalizeSample, tiltFromAngles } from './samples';
export type { PointerKind, RawSample } from './samples';
export { createStrokeBuilder } from './strokeBuilder';
export type { StrokeBuilder, StrokeBuilderOptions } from './strokeBuilder';
export { createPalmFilter, DEFAULT_PALM_SETTINGS, MAX_GRACE_MS, MIN_GRACE_MS } from './palm';
export type {
  HeldFate,
  HeldStroke,
  PalmFilter,
  PalmSettings,
  PenSignal,
  PenState,
  Surface,
  TouchContact,
  TouchDecision,
  TouchEnd,
  TouchRole,
} from './palm';
export {
  BARREL_CHOICES,
  buttonsForPen,
  CONTEXT_MENU_QUIET_MS,
  DEFAULT_PEN_BUTTONS,
  ERASER_END_CHOICES,
  penKey,
  penSource,
  resolvePenAction,
  sanitizeButtons,
  suppressContextMenu,
} from './buttons';
export type {
  ButtonEvent,
  ContextMenuState,
  PenAction,
  PenButtonSettings,
  PenSource,
  ResolvedPenAction,
} from './buttons';
