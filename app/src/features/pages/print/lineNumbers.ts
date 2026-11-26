// Line numbers in print (R-VIEW-2). The numbers go in the left margin beside each line of text. Only lines of text
// count: tables, images, and drawings do not. The count restarts on each sheet, or runs on through the page.

import type { LineNumberSettings } from './headerFooter';

/** One line of text as the paginator placed it: its sheet, and its top and bottom in page units from the page's top. */
export interface LinePiece {
  readonly sheet: number;
  readonly top: number;
  readonly bottom: number;
}

/** A number to draw: its text, and its box in sheet units from the sheet's top. */
export interface LineMark {
  readonly label: string;
  readonly top: number;
  readonly height: number;
}

/**
 * The numbers to draw on each sheet, by sheet index. `lines` are in reading order. A line shows its number when the
 * number is a multiple of `countBy`, so every fifth line shows 5, 10, and 15.
 */
export function lineNumberMarks(
  settings: LineNumberSettings,
  lines: readonly LinePiece[],
  sheetHeight: number,
): Map<number, LineMark[]> {
  const marks = new Map<number, LineMark[]>();
  let sheet = -1;
  let value = settings.start;
  for (const line of lines) {
    if (line.sheet !== sheet) {
      sheet = line.sheet;
      if (settings.restart === 'page') value = settings.start;
    }
    if (value % settings.countBy === 0) {
      const list = marks.get(sheet) ?? [];
      list.push({ label: String(value), top: line.top - sheet * sheetHeight, height: line.bottom - line.top });
      marks.set(sheet, list);
    }
    value += 1;
  }
  return marks;
}
