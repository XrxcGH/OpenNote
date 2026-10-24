// Where the tool windows go. They dock beside the page when the page keeps its least width; otherwise they float over
// it from the right, clear of the page's scroll bar, and never past an edge of the window. Floating windows sit side
// by side while they fit. When they don't, each is clamped inside the window and they overlap, the most recently used
// on top, so every window's title stays in reach.

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
}

export interface Placement {
  overlay: boolean;
  /** The width the docked windows take from the page (0 when they float). */
  docked: number;
  windows: Placed[];
}

export function placeWindows({ widths, viewport, room, edge }: PlacementInput): Placement {
  const total = widths.reduce((sum, one) => sum + one, 0);
  if (total <= Math.max(room, 0)) {
    let right = total;
    const windows = widths.map((width) => {
      right -= width;
      return { width, right };
    });
    return { overlay: false, docked: total, windows };
  }
  const start = edge + FLOAT_GAP;
  const span = Math.max(0, viewport - start - FLOAT_GAP);
  const windows: Placed[] = new Array<Placed>(widths.length);
  let right = start;
  for (let index = widths.length - 1; index >= 0; index -= 1) {
    const width = Math.min(widths[index]!, span);
    // Past the left edge, the window stops at it and overlaps the windows to its right instead.
    const place = Math.max(start, Math.min(right, viewport - FLOAT_GAP - width));
    windows[index] = { width, right: place };
    right += width;
  }
  return { overlay: true, docked: 0, windows };
}
