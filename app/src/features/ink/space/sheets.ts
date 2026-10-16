// Insert space in paginated view: coordinates run down all the sheets, so content pushed across a break would land on the
// gap between two sheets. Instead it goes to the top of the next sheet's writing area, and nothing is lost.

/** The sheets of a paginated page, in page units. */
export interface Sheets {
  /** The height of one sheet. */
  readonly height: number;
  /** The margin at the top and bottom of each sheet, where nothing sits. */
  readonly margin: number;
}

/**
 * How much farther down an item must move so it sits wholly on a sheet. An item that fits on a sheet but would cross the
 * bottom margin goes to the top of the next sheet's writing area. One taller than a sheet stays where it is.
 */
export function sheetPush(top: number, height: number, sheets: Sheets): number {
  const area = sheets.height - 2 * sheets.margin;
  if (!(sheets.height > 0) || area <= 0 || height > area) return 0;
  const sheet = Math.floor(Math.max(0, top) / sheets.height);
  const bottomEdge = sheet * sheets.height + sheets.height - sheets.margin;
  if (top + height <= bottomEdge) return 0;
  const nextTop = (sheet + 1) * sheets.height + sheets.margin;
  return nextTop - top;
}
