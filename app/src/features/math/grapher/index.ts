// The function grapher's engine: parse an expression, sample it, lay out the axes, and produce vector paths.
// Nothing here touches the DOM, so it runs in tests, in a worker, and in the export pipeline.

export { compileExpression, differentiateExpression } from './evaluate';
export type { CompileResult, CompiledExpression, DerivativeResult, ExpressionProblem, Params } from './evaluate';
export { ExpressionError } from './errors';
export { findParameters } from './parser';
export type { ParseOptions } from './parser';
export { sampleFunction } from './sample';
export type { SampleOptions } from './sample';
export { clipLine, clipPolyline, segmentsToPath } from './path';
export type { ClipBox, PathOptions } from './path';
export { axisTicks, computeGrid, DEFAULT_TICK_SPACING, formatTick, niceSteps } from './ticks';
export type { AxisLine, Grid, Tick, TickSpacing, TickSteps } from './ticks';
export { buildScene, sceneToSvg } from './scene';
export type { CurveInput, CurveLayer, GraphScene, SceneOptions, SvgStyle } from './scene';
export {
  defaultViewport,
  MAX_SPAN,
  MIN_SPAN,
  panByFraction,
  panByPixels,
  resizeKeepingScale,
  scaleOf,
  squareCells,
  toPixel,
  toWorld,
  wheelZoomFactor,
  zoomAround,
  zoomAtCenter,
  zoomToBox,
} from './viewport';
export type { ZoomAxes } from './viewport';
export type { Pixel, Point, Segment, Size, Viewport } from './types';
