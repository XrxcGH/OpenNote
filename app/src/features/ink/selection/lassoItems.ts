// The lasso over ink and blocks together (architecture 9.3, 9.4, and 12.5). Strokes go through the stroke index. A
// block's geometry lives in the page layout, so the main thread tests blocks. It lays an 8 by 8 grid of points over
// the frame and counts how many fall inside the lasso, by the same setting as ink (mostly, any part, or all).

import { union } from '../geometry/bounds';
import { lassoSelect } from '../geometry/lasso';
import type { LassoOptions } from '../geometry/lasso';
import { buildMask, classifyBox, insideMask } from '../geometry/lassoMask';
import { simplify } from '../geometry/simplify';
import type { StrokeIndex } from '../geometry/strokeIndex';
import { selectionBounds } from '../geometry/transform';
import type { Bounds, Stroke, Vec } from '../geometry/types';
import { lassoSkip } from '../edits/filters';
import type { LassoFilter } from '../edits/filters';

export const FRAME_GRID = 8;
const DEFAULT_THRESHOLD = 0.6;

/** What kind of block a frame belongs to, which the lasso filter chooses by. */
export type BlockKind = 'text' | 'image' | 'other';

/** A block's frame in page units. Tables count as text, and files as images. */
export interface BlockItem {
  readonly id: string;
  readonly frame: Bounds;
  readonly kind: BlockKind;
  /** A locked block can be selected, but moves leave it in place. */
  readonly locked?: boolean;
}

/** The centers of an 8 by 8 grid of cells over a frame. */
export function frameGrid(frame: Bounds, n: number = FRAME_GRID): Vec[] {
  const points: Vec[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      points.push({
        x: frame.minX + ((c + 0.5) / n) * (frame.maxX - frame.minX),
        y: frame.minY + ((r + 0.5) / n) * (frame.maxY - frame.minY),
      });
    }
  }
  return points;
}

function inFrame(frame: Bounds, p: Vec): boolean {
  return p.x >= frame.minX && p.x <= frame.maxX && p.y >= frame.minY && p.y <= frame.maxY;
}

/** The ids of the blocks a lasso path selects. The path closes itself from its last point to its first. */
export function lassoBlocks(
  path: readonly Vec[],
  items: readonly BlockItem[],
  options: Pick<LassoOptions, 'mode' | 'threshold' | 'pixel'> = {},
): string[] {
  const { mode = 'mostly', threshold = DEFAULT_THRESHOLD, pixel = 1 } = options;
  const polygon = simplify(path, pixel);
  if (polygon.length < 3) return [];
  const mask = buildMask(polygon, { minCell: pixel });
  const selected: string[] = [];
  for (const item of items) {
    const box = classifyBox(mask, item.frame);
    if (box === 'outside') continue;
    if (box === 'inside') {
      selected.push(item.id);
      continue;
    }
    const grid = frameGrid(item.frame);
    const inside = grid.filter((p) => insideMask(mask, p.x, p.y)).length;
    const touches = inside > 0 || polygon.some((p) => inFrame(item.frame, p));
    const share = inside / grid.length;
    const hit = mode === 'any' ? touches : mode === 'all' ? share === 1 : share >= threshold;
    if (hit) selected.push(item.id);
  }
  return selected;
}

export interface LassoItems {
  readonly strokes: string[];
  readonly blocks: string[];
}

export interface LassoAllOptions extends LassoOptions {
  readonly filter: LassoFilter;
}

function blockAccepted(filter: LassoFilter, kind: BlockKind): boolean {
  return kind === 'text' ? filter.text : kind === 'image' ? filter.images : true;
}

/** Everything a lasso picks up: strokes by the filter, and blocks by the filter. */
export function lassoAll(
  index: StrokeIndex,
  blocks: readonly BlockItem[],
  path: readonly Vec[],
  options: LassoAllOptions,
): LassoItems {
  const { filter, ...rest } = options;
  const strokes = lassoSelect(index, path, { ...rest, skip: lassoSkip(filter, options.skip) });
  const accepted = blocks.filter((block) => blockAccepted(filter, block.kind));
  return { strokes, blocks: lassoBlocks(path, accepted, rest) };
}

/** The box that selection handles hug: the strokes' centerlines and the blocks' frames. Null for an empty selection. */
export function selectionFrame(strokes: readonly Stroke[], blocks: readonly BlockItem[]): Bounds | null {
  let box = selectionBounds(strokes);
  for (const block of blocks) box = box ? union(box, block.frame) : block.frame;
  return box;
}
