// Where the tool windows go. They dock beside the page when the page keeps its least width; otherwise they float over
// it from the right, clear of the page's scroll bar, and never past an edge of the window. Floating windows sit side
// by side while they fit. When they don't, each shrinks toward SHRINK_FLOOR first. Only when they still don't fit do
// they overlap, each newer one a title bar lower than the one before, so no window covers another's title.

/** The gap a floating window keeps from the window's edges and from the page's scroll bar (--space-3). */
export const FLOAT_GAP = 8;

export interface PlacementInput {
  /** The width each open window asks for, in opening order. */
  widths: readonly number[];
  /** The window's width. */
  viewport: number;
  /** The space the page keeps for panels beside it: what is left of the window after the panes and the page's least width. */
  room: number;
  /** For floating windows: the space at the window's right edge to keep clear, the page's scroll bar and anything beyond it. */
  edge: number;
}

export interface Placed {
  width: number;
  /** The space between the window's right edge and this window's. */
  right: number;
  /** How far below the first window's top this one starts: 0 unless windows had to overlap, then a title bar per window. */
  down: number;
}

export interface Placement {
  overlay: boolean;
  /** The width the docked windows take from the page (0 when they float). */
  docked: number;
  windows: Placed[];
}

/** The narrowest a floating window gets for the room at the page's edge; past that it covers what is there instead. */
export const MIN_FLOAT = 280;

/** How narrow floating windows get so that they sit side by side before any of them overlaps another. */
export const SHRINK_FLOOR = 360;

/** The height of a tool window's title bar: the step by which overlapping windows cascade down. */
export const TITLE_STEP = 40;

/** Shrinks widths that overflow the span, widest first by share, none below its floor. Returns them and whether they fit. */
function shrinkToFit(asked: readonly number[], span: number): { widths: number[]; fits: boolean } {
  const floors = asked.map((one) => Math.min(one, SHRINK_FLOOR, span));
  const excess = asked.reduce((sum, one) => sum + one, 0) - span;
  if (excess <= 0) return { widths: [...asked], fits: true };
  const room = asked.map((one, index) => Math.max(0, one - floors[index]!));
  const total = room.reduce((sum, one) => sum + one, 0);
  if (total < excess) return { widths: floors, fits: floors.reduce((sum, one) => sum + one, 0) <= span };
  const widths = asked.map((one, index) => Math.floor(one - (room[index]! * excess) / total));
  // Rounding down can leave a pixel over; take it from the widest.
  let over = widths.reduce((sum, one) => sum + one, 0) - span;
  while (over > 0) {
    const widest = widths.indexOf(Math.max(...widths));
    widths[widest] = widths[widest]! - 1;
    over -= 1;
  }
  return { widths, fits: true };
}

export function placeWindows({ widths, viewport, room, edge }: PlacementInput): Placement {
  const total = widths.reduce((sum, one) => sum + one, 0);
  // Docked windows must also fit inside the window itself, whatever room the page claims (a stale or off-screen page box).
  if (total <= Math.max(Math.min(room, viewport - 2 * FLOAT_GAP), 0)) {
    let right = total;
    const windows = widths.map((width) => {
      right -= width;
      return { width, right, down: 0 };
    });
    return { overlay: false, docked: total, windows };
  }
  const start = Math.min(edge + FLOAT_GAP, Math.max(FLOAT_GAP, viewport - FLOAT_GAP - MIN_FLOAT));
  const span = Math.max(0, viewport - start - FLOAT_GAP);
  const fitted = shrinkToFit(widths, span);
  const windows: Placed[] = new Array<Placed>(widths.length);
  let right = start;
  for (let index = widths.length - 1; index >= 0; index -= 1) {
    const width = Math.min(fitted.widths[index]!, span, Math.max(0, viewport - 2 * FLOAT_GAP));
    // Past the left edge, the window stops at it and overlaps the windows to its right instead.
    const place = Math.max(start, Math.min(right, viewport - FLOAT_GAP - width));
    windows[index] = { width, right: place, down: fitted.fits ? 0 : index * TITLE_STEP };
    right += width;
  }
  return { overlay: true, docked: 0, windows };
}
