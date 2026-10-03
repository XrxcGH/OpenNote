// Gesture detectors: scribble to erase, circle and tap, and multi-finger double taps.

export {
  convexHull,
  countReversals,
  DEFAULT_SCRIBBLE,
  detectScribble,
  SCRIBBLE_SHARE,
  scribbleTargets,
} from './scribble';
export type { ScribbleMatch, ScribbleOptions, ScribbleTargetOptions } from './scribble';
export { DEFAULT_CIRCLE_TAP, DEFAULT_LOOP, detectLoop, loopContent, matchCircleTap } from './circleTap';
export type { CircleTapOptions, LoopMatch, LoopOptions, Tap } from './circleTap';
export { createMultiTapDetector, DEFAULT_MULTI_TAP } from './multiTap';
export type { MultiTapDetector, MultiTapOptions, MultiTapResult } from './multiTap';
