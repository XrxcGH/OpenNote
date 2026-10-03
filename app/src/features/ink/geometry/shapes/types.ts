// The shapes recognition can return. Each carries its exact geometry, so a caller stores it as an ordinary stroke
// with no per-point times (design 11.5).

import type { Vec } from '../types';

export type ShapeKind = 'line' | 'arrow' | 'rectangle' | 'triangle' | 'circle' | 'ellipse';

export type Shape =
  | { readonly kind: 'line'; readonly from: Vec; readonly to: Vec }
  /** A shaft from `from` to `tip` and two barbs that end at the tip. */
  | { readonly kind: 'arrow'; readonly from: Vec; readonly tip: Vec; readonly barbs: readonly [Vec, Vec] }
  | { readonly kind: 'rectangle'; readonly corners: readonly [Vec, Vec, Vec, Vec]; readonly square: boolean }
  | {
      readonly kind: 'triangle';
      readonly corners: readonly [Vec, Vec, Vec];
      readonly variant: 'equilateral' | 'right' | 'general';
    }
  | { readonly kind: 'circle'; readonly center: Vec; readonly radius: number }
  /** `rotation` turns the x axis of the ellipse toward y, in radians. */
  | {
      readonly kind: 'ellipse';
      readonly center: Vec;
      readonly rx: number;
      readonly ry: number;
      readonly rotation: number;
    };

export interface ShapeMatch {
  readonly shape: Shape;
  /** The exact geometry as a polyline. Closed shapes end on their first point, and curves are sampled finely. */
  readonly points: readonly Vec[];
  /** From 0.5 at the edge of what recognition accepts to 1 for an exact fit. */
  readonly confidence: number;
}

export interface RecognizeOptions {
  /** Strokes with a box smaller than this, in page units, are never shapes. Callers pass 16 screen pixels. */
  readonly minSize?: number;
  /** The stroke's width, which sizes an arrow's head. Defaults to 2. */
  readonly width?: number;
}

/** A shape that fits a stroke. The ratio is the fit error over what recognition accepts: under 1 is accepted. */
export interface Candidate {
  readonly shape: Shape;
  readonly ratio: number;
}

/** Breaks ties toward the simpler shape: within 10% of the best fit, the lowest rank wins. */
export const SIMPLICITY: Record<ShapeKind, number> = {
  line: 0,
  arrow: 1,
  circle: 2,
  ellipse: 3,
  triangle: 4,
  rectangle: 5,
};
