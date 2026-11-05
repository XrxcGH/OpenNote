// Where the slash menu goes: under the "/" when it fits, else above it, and always inside the window (a 300 px window
// at 200 percent text is the narrowest). Pure, so a test can set the numbers.

export interface Anchor {
  left: number;
  top: number;
  bottom: number;
}
export interface Size {
  width: number;
  height: number;
}

export interface MenuPosition {
  left: number;
  top: number;
  /** The tallest the menu may be where it stands; a longer list scrolls. */
  maxHeight: number;
}

const GAP = 4;
const MARGIN = 8;

export function menuPosition(anchor: Anchor, menu: Size, win: Size): MenuPosition {
  const below = win.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const left = Math.max(MARGIN, Math.min(anchor.left, win.width - menu.width - MARGIN));
  if (menu.height <= below || below >= above) {
    return { left, top: anchor.bottom + GAP, maxHeight: Math.max(0, below) };
  }
  const height = Math.min(menu.height, above);
  return { left, top: anchor.top - GAP - height, maxHeight: Math.max(0, above) };
}
