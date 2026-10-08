// Shared shapes for the function grapher. Everything here is plain data, so it is easy to test and to save.

/** A point in graph coordinates (x to the right, y up). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A run of points to draw as one unbroken line. A break in a curve, such as an asymptote, starts a new segment. */
export type Segment = readonly Point[];

/** The part of the plane in view, in graph coordinates. */
export interface Viewport {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** The drawing area in pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A position on screen, in pixels from the top left. */
export interface Pixel {
  readonly x: number;
  readonly y: number;
}
