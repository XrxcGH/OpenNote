// Insert space (architecture 12.1). A line across the page splits it. Dragging down pushes everything below the line
// down. Dragging up closes a gap but never moves content above the line. A stroke that crosses the line stays, as in
// OneNote, and so do locked items. The plan says what moves and by how much. The caller commits one transaction:
// `transformStrokes` with a translation for the strokes, and `moveBlock` for each block, coalesced as one drag.

import { strokeBounds } from '../geometry/bounds';
import { translation } from '../geometry/matrix';
import { PAGE_UNITS_PER_MM } from '../geometry/stabilizer';
import type { StrokeIndex } from '../geometry/strokeIndex';
import type { Matrix, Stroke } from '../geometry/types';

/** A block with a frame on the page, such as a floating text box or an image. */
export interface BlockFrame {
  readonly id: string;
  /** The top edge in page units. */
  readonly top: number;
  readonly locked?: boolean;
}

export interface InsertSpaceOptions {
  /** Floating blocks to consider. */
  readonly blocks?: readonly BlockFrame[];
  /** Strokes this returns true for stay put, such as strokes in locked ink blocks. */
  readonly locked?: (stroke: Stroke) => boolean;
}

export interface InsertSpacePlan {
  /** The strokes that move. */
  readonly strokes: string[];
  /** The blocks that move. */
  readonly blocks: string[];
  /** The distance they move, after limiting an upward drag so nothing rises above the line. */
  readonly dy: number;
  /** How many locked items stayed, for the announcement "1 locked item stays in place". */
  readonly lockedStay: number;
  /** The translation to apply to the strokes. */
  readonly matrix: Matrix;
}

const EVERYWHERE = 1e9;

/** What moves when space is inserted at page height `y` by `dy` (positive pushes down, negative closes a gap). */
export function planInsertSpace(
  index: StrokeIndex,
  y: number,
  dy: number,
  options: InsertSpaceOptions = {},
): InsertSpacePlan {
  const strokes: string[] = [];
  const blocks: string[] = [];
  let lockedStay = 0;
  let highest = Infinity;
  const below = { minX: -EVERYWHERE, minY: y, maxX: EVERYWHERE, maxY: EVERYWHERE };
  for (const stroke of index.query(below)) {
    const top = strokeBounds(stroke).minY;
    if (top < y) continue;
    if (options.locked?.(stroke)) {
      lockedStay++;
      continue;
    }
    strokes.push(stroke.id);
    highest = Math.min(highest, top);
  }
  for (const block of options.blocks ?? []) {
    if (block.top < y) continue;
    if (block.locked) {
      lockedStay++;
      continue;
    }
    blocks.push(block.id);
    highest = Math.min(highest, block.top);
  }
  const moved = strokes.length + blocks.length > 0;
  const applied = !moved ? 0 : dy < 0 ? Math.max(dy, y - highest) : dy;
  return { strokes, blocks, dy: applied, lockedStay, matrix: translation(0, applied) };
}

export type SpaceUnit = 'mm' | 'in' | 'lines';

const PAGE_UNITS_PER_INCH = 96;

/** An amount from the "Insert space" dialog in page units. `lineHeight` is the page's ruling for the unit "lines". */
export function spaceAmount(value: number, unit: SpaceUnit, lineHeight: number): number {
  if (!Number.isFinite(value)) return 0;
  if (unit === 'mm') return value * PAGE_UNITS_PER_MM;
  return unit === 'in' ? value * PAGE_UNITS_PER_INCH : value * lineHeight;
}
