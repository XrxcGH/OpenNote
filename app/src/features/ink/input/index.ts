// Input: samples to strokes, palm rejection, pen buttons, and gestures.

export { normalizeSample, tiltFromAngles } from './samples';
export type { PointerKind, RawSample } from './samples';
export { createStrokeBuilder } from './strokeBuilder';
export type { StrokeBuilder, StrokeBuilderOptions } from './strokeBuilder';
export * from './palm/index';
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
export * from './gestures';
