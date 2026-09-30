// The plain data the ink geometry works on. Nothing here touches React, the DOM, or the platform, so a worker
// or a Node test can load it directly (phase 5 design, section 2).

/** A position in page units. */
export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** One raw pen sample. Pressure runs 0 to 1, tilt is in degrees, and time is in milliseconds after the start. */
export interface InkPoint extends Vec {
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly time?: number;
}

/** An affine transform `a b c d e f`, mapping (x, y) to (a·x + c·y + e, b·x + d·y + f), as in SVG and canvas. */
export type Matrix = readonly [number, number, number, number, number, number];

export type InkTool = 'pen' | 'pencil' | 'highlighter' | 'marker' | 'brush';

/**
 * A finished stroke. The raw points never change; moving, scaling, or rotating sets `transform`. Start time is in
 * Unix milliseconds. `origin` names the stroke a partial erase cut this one from.
 */
export interface Stroke {
  readonly id: string;
  readonly tool: InkTool;
  /** The nominal diameter in page units. */
  readonly width: number;
  readonly startTime: number;
  readonly points: readonly InkPoint[];
  readonly transform?: Matrix;
  readonly origin?: string;
}

/** An axis-aligned box in page units. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The path of an eraser circle between two samples: every point within `radius` of the segment. */
export interface Capsule {
  readonly from: Vec;
  readonly to: Vec;
  readonly radius: number;
}
