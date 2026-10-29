// The stroke eraser: removes every stroke the eraser's path touches (design 8.3).

import { hitCapsules } from './hitTest';
import type { StrokeIndex } from './strokeIndex';
import type { Capsule, Stroke, Vec } from './types';

export interface StrokeEraseOptions {
  /** Strokes this returns true for are left alone, such as strokes in locked blocks or ones a filter excludes. */
  readonly skip?: (stroke: Stroke) => boolean;
}

/** The capsules for a run of eraser samples: the circle swept from each sample to the next. */
export function capsulesAlong(samples: readonly Vec[], radius: number): Capsule[] {
  if (samples.length === 1) return [{ from: samples[0], to: samples[0], radius }];
  return samples.slice(1).map((to, i) => ({ from: samples[i], to, radius }));
}

/** The ids of the strokes the capsules touch. Removing them from the index is the caller's commit step. */
export function eraseStrokes(
  index: StrokeIndex,
  capsules: readonly Capsule[],
  options: StrokeEraseOptions = {},
): string[] {
  const { skip } = options;
  return hitCapsules(index, capsules)
    .filter((stroke) => !skip?.(stroke))
    .map((stroke) => stroke.id);
}
