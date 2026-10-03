// Eraser and lasso filters (architecture 12.5). The eraser can erase all ink, only highlighter, only pens (pen and
// pencil), or one tool. The lasso can choose what it picks up: ink, highlighter, typed text, images, and shapes. Both
// turn a person's choice into the `skip` predicate the hit tests already take, so the geometry stays unaware of them.

import type { Stroke } from '../geometry/types';
import type { InkStroke } from '../model/types';

export type EraserFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'highlighter' }
  | { readonly kind: 'pens' }
  | { readonly kind: 'tool'; readonly tool: Stroke['tool'] };

export const ERASE_ALL: EraserFilter = { kind: 'all' };

/** True when the eraser may erase this stroke. */
export function eraserAccepts(filter: EraserFilter, stroke: Stroke): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'highlighter':
      return stroke.tool === 'highlighter';
    case 'pens':
      return stroke.tool === 'pen' || stroke.tool === 'pencil';
    case 'tool':
      return stroke.tool === filter.tool;
  }
}

/**
 * The `skip` predicate for the erasers. Strokes in locked ink blocks are never erased, whatever the filter says.
 * `locked` tells whether a block is locked.
 */
export function eraserSkip(
  filter: EraserFilter,
  locked: (block: string) => boolean = () => false,
): (stroke: Stroke) => boolean {
  return (stroke) => !eraserAccepts(filter, stroke) || locked((stroke as Partial<InkStroke>).block ?? '');
}

/** What a lasso can pick up. Text and images belong to blocks, and the rest are strokes. */
export interface LassoFilter {
  readonly ink: boolean;
  readonly highlighter: boolean;
  readonly shapes: boolean;
  readonly text: boolean;
  readonly images: boolean;
}

export const LASSO_EVERYTHING: LassoFilter = { ink: true, highlighter: true, shapes: true, text: true, images: true };

export type StrokeKind = 'ink' | 'highlighter' | 'shape';

/**
 * What a stroke is to the lasso. A highlighter stroke is highlighter. A stroke with no per-point times and a known
 * start holds exact geometry, as a recognized shape does (spec 8.2). Everything else is ink.
 */
export function strokeKind(stroke: Stroke & { startUnknown?: boolean }): StrokeKind {
  if (stroke.tool === 'highlighter') return 'highlighter';
  const drawn = stroke.startUnknown === true || stroke.points.some((p) => p.time !== undefined);
  return drawn ? 'ink' : 'shape';
}

export function lassoAcceptsStroke(filter: LassoFilter, stroke: Stroke): boolean {
  const kind = strokeKind(stroke);
  return kind === 'ink' ? filter.ink : kind === 'highlighter' ? filter.highlighter : filter.shapes;
}

/** The `skip` predicate for the lasso's stroke search: skips strokes the filter does not pick up. */
export function lassoSkip(filter: LassoFilter, extra?: (stroke: Stroke) => boolean): (stroke: Stroke) => boolean {
  return (stroke) => !lassoAcceptsStroke(filter, stroke) || (extra?.(stroke) ?? false);
}
