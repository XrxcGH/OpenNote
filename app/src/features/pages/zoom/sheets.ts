// Sheet navigation in the paginated view: which sheet the window is on, which sheets it shows, and the view that
// goes to a sheet. These feed the sheet navigator strip, the "Go to sheet" command, and the sheet counter.

import { sheetAt, type SheetGeometry } from '../pagination/geometry';
import { clampZoom, FIT_PADDING, type Viewport } from './zoom';
import { clampView, type Bounds, type View } from './transform';

export interface SheetRange {
  readonly first: number;
  readonly last: number;
}

/** The sheet at the middle of the window, which the counter shows ("Sheet 3 of 7"). */
export function currentSheet(g: SheetGeometry, view: View, viewport: Viewport, sheets: number): number {
  const middle = view.top + viewport.height / view.zoom / 2;
  return Math.min(Math.max(0, sheetAt(g, middle)), Math.max(0, sheets - 1));
}

/** The sheets the window touches, widened by `overscan` sheets each way so scrolling shows no blank. */
export function visibleSheets(
  g: SheetGeometry,
  view: View,
  viewport: Viewport,
  sheets: number,
  overscan = 0,
): SheetRange {
  const top = view.top;
  const bottom = view.top + viewport.height / view.zoom;
  return {
    first: Math.max(0, sheetAt(g, top) - overscan),
    last: Math.min(Math.max(0, sheets - 1), sheetAt(g, bottom - 0.02) + overscan),
  };
}

export type Align = 'top' | 'center';

/**
 * The view that goes to a sheet, keeping the zoom and the sideways position. With `top`, the sheet's top edge sits
 * a little below the top of the window. With `center`, the sheet's middle sits in the middle of the window.
 */
export function viewOfSheet(
  g: SheetGeometry,
  view: View,
  viewport: Viewport,
  sheet: number,
  bounds: Bounds,
  align: Align = 'top',
): View {
  const k = Math.max(0, sheet);
  const visible = viewport.height / view.zoom;
  const top = align === 'top' ? k * g.height - FIT_PADDING / view.zoom : k * g.height + g.height / 2 - visible / 2;
  return clampView({ ...view, top }, viewport, bounds);
}

/**
 * The view that shows one sheet whole, for flipping sideways from sheet to sheet. The sheet is centered and the zoom is
 * given by the caller, usually `fitSheet`.
 */
export function viewOfWholeSheet(g: SheetGeometry, viewport: Viewport, sheet: number, zoom: number): View {
  const z = clampZoom(zoom);
  return {
    zoom: z,
    left: g.width / 2 - viewport.width / z / 2,
    top: Math.max(0, sheet) * g.height + g.height / 2 - viewport.height / z / 2,
  };
}

/** The sheet a flip lands on, one step in a direction, kept within the page. */
export function flipTarget(current: number, direction: 1 | -1, sheets: number): number {
  return Math.min(Math.max(0, current + direction), Math.max(0, sheets - 1));
}
