// The 3D grapher's engine: what a line means, its samples, and the picture from a camera. No DOM, so it runs in
// tests and in the export pipeline.
export {
  AXIS_LETTERS,
  DEFAULT_DOMAIN,
  DEFAULT_RANGES,
  MAX_GRID,
  isPlot3d,
  plotParameters,
  plotShape,
  samplePlot,
  usesXandY,
} from './plot';
export type {
  Domain,
  PlotKind,
  PlotShape,
  Point3,
  Range,
  SampleInput,
  SampleOptions as Sample3dOptions,
  Sampled,
} from './plot';
export {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  boundsOf,
  buildScene3d,
  faceOpacity,
  projector,
  rotateCamera,
  sceneToSvg3d,
  tickText,
  zoomCamera,
} from './scene';
export type { Bounds, Camera, Face, Label3, Line3, Scene3d, Svg3dStyle } from './scene';
