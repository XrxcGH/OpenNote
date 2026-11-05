// Where the properties chip's right edge sits: at the page area's end edge, left of any pane that opens over the page
// as a drawer (Reading order, Contents), and always inside the window. Pure, so a test can set the numbers.

export interface ChipArea {
  /** The page area: its left edge, and its right edge inside the scroll bar. */
  left: number;
  right: number;
  /** The boxes of panes that open over the page, as measured. */
  panes: readonly { left: number; right: number; width: number }[];
  windowWidth: number;
  /** The chip's width: the least room it needs beside the area's start edge. */
  chip: number;
}

/** The inset of the chip and the room kept between it and the area's start edge. */
export const CHIP_INSET = 16;

/** The x of the chip's right-hand limit (before its inset), never past the window and never so far left that the chip would leave it. */
export function chipLimit(area: ChipArea): number {
  const start = Math.max(area.left, 0);
  let right = Math.min(area.right, area.windowWidth);
  for (const pane of area.panes) {
    if (pane.width > 0 && pane.left < right && pane.right > area.left) right = Math.max(area.left, pane.left);
  }
  // A pane edge at or past the window's start (the source view's drawer) would put the chip outside the window.
  const least = start + Math.min(area.chip + 2 * CHIP_INSET, Math.max(0, area.windowWidth - start));
  return Math.min(area.windowWidth, Math.max(right, least));
}
