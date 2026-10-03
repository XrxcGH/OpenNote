// The zoom writing box: strip and box coordinates, and the rules that move the box along the line.

export {
  ADVANCE_DELAY_MS,
  advance,
  EDGE_SHARE,
  LINE_FACTOR,
  lineNumber,
  lineStep,
  moveBox,
  newLine,
  revealDelta,
  shouldAdvance,
  STEP_SHARE,
} from './advance';
export type { BoxKey, Margins, Move } from './advance';
export {
  boxAt,
  boxBounds,
  boxSize,
  DEFAULT_MAGNIFICATION,
  MAGNIFICATIONS,
  pageToStrip,
  stripHeight,
  stripScale,
  stripToPage,
  stripWidth,
} from './mapping';
export type { Magnification, Strip, ZoomBox } from './mapping';
